// Inventory Health Score
// Composite health score per SKU combining stockout risk, overstock, and sell-through.

const { resolveIds, getStock, getOrders, getSkuNames } = require('../db-base');
const { startSSE, parseReportParams } = require('../base');

const meta = {
  title:       'Inventory Health Score',
  description: 'A composite health score per SKU — combines stockout risk, overstock, and sell-through into one actionable view.',
  icon:        '❤️',
  category:    'inventory',
  params: [
    { id: 'days', label: 'Velocity window (days)', type: 'number', default: 30 },
  ]
};

async function run(req, res, url, session) {
  const { warehouseId: msWarehouseId, clientId: msClientId, dateFrom, dateTo } = parseReportParams(url, session);
  const send = startSSE(res);

  try {
    const { accountId, warehouseId, clientId } = await resolveIds(session, msWarehouseId, msClientId);
    if (!warehouseId) throw new Error('Warehouse not in database — trigger a sync first');

    send({ type: 'progress', message: 'Fetching stock…' });
    const stock = await getStock(accountId, warehouseId, clientId);

    send({ type: 'progress', message: 'Fetching order history…' });
    const orders = await getOrders(accountId, warehouseId, clientId, dateFrom, dateTo);

    send({ type: 'progress', message: 'Fetching product names…' });
    const skuNameMap = await getSkuNames(accountId, warehouseId, clientId);

    const days = parseInt(url.searchParams.get('days') || '30');
    send({ type: 'progress', message: 'Calculating health scores…' });
    const { rows, overall } = calculate(stock, orders, skuNameMap, days);

    send({ type: 'done', rows, meta: overall });
  } catch (err) {
    send({ type: 'error', message: err.message });
  }
  res.end();
}

function calculate(stock, orders, skuNameMap, days) {
  const velocity = {};
  for (const order of orders) {
    for (const item of (order.OrderItems || [])) {
      const sku = item.SKU || item.Sku || '';
      const qty = item.Quantity || 0;
      if (!sku || !qty) continue;
      velocity[sku] = (velocity[sku] || 0) + qty;
    }
  }

  const rows = stock
    .filter(item => (item.Level || 0) > 0)
    .map(item => {
      const sku      = item.SKU || item.Sku || '';
      const stockQty = item.Level || 0;
      const name     = item.ProductName || skuNameMap[sku] || '';
      const sold     = velocity[sku] || 0;
      const dailyVel = sold / days;

      const daysOfCover = dailyVel > 0 ? Math.round(stockQty / dailyVel) : null;
      const sellThrough = sold > 0 ? round((sold / (sold + stockQty)) * 100) : 0;

      let stockoutScore = 100;
      if (daysOfCover !== null) {
        if (daysOfCover < 7)       stockoutScore = 10;
        else if (daysOfCover < 14) stockoutScore = 40;
        else if (daysOfCover < 30) stockoutScore = 70;
      } else if (sold === 0)       stockoutScore = 50;

      let overstockScore = 100;
      if (daysOfCover !== null && daysOfCover > 180) overstockScore = 20;
      else if (daysOfCover !== null && daysOfCover > 90) overstockScore = 60;

      const velocityScore = dailyVel > 0 ? Math.min(100, Math.round(dailyVel * 20)) : 20;
      const score = Math.round((stockoutScore * 0.4) + (overstockScore * 0.35) + (velocityScore * 0.25));

      let status;
      if (score >= 70)      status = 'healthy';
      else if (score >= 40) status = 'watchlist';
      else                  status = 'critical';

      return { sku, name, stock: stockQty, sold, dailyVel: round(dailyVel, 3), daysOfCover, sellThrough, score, status };
    })
    .sort((a, b) => a.score - b.score);

  const overall = {
    healthy:   rows.filter(r => r.status === 'healthy').length,
    watchlist: rows.filter(r => r.status === 'watchlist').length,
    critical:  rows.filter(r => r.status === 'critical').length,
    avgScore:  rows.length ? Math.round(rows.reduce((s, r) => s + r.score, 0) / rows.length) : 0,
  };

  return { rows, overall };
}

const round = (n, dp = 2) => Math.round(n * 10 ** dp) / 10 ** dp;

module.exports = { meta, run };
