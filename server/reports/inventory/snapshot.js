// Real-Time Inventory Snapshot
// Current stock levels enriched with velocity, cover days, and health status.

const { resolveIds, getStock, getOrders, getSkuNames } = require('../db-base');
const { startSSE, parseReportParams } = require('../base');

const meta = {
  title:       'Inventory Snapshot',
  description: 'Live stock levels enriched with sell-through velocity and days of cover — your real-time inventory view.',
  icon:        '📷',
  category:    'inventory',
  params: [
    { id: 'days', label: 'Velocity window (days)', type: 'number', default: 30 },
  ]
};

async function run(req, res, url, session) {
  const { warehouseId: msWarehouseId, clientId: msClientId, dateFrom, dateTo } = parseReportParams(url, session);
  const send = startSSE(res);

  try {
    const { warehouseId, clientId } = resolveIds(session, msWarehouseId, msClientId);
    if (!warehouseId) throw new Error('warehouseId is required');

    send({ type: 'progress', message: 'Fetching live stock…' });
    const stock = await getStock(warehouseId, clientId);

    send({ type: 'progress', message: 'Fetching order history…' });
    const orders = await getOrders(warehouseId, clientId, dateFrom, dateTo);

    send({ type: 'progress', message: 'Fetching product names…' });
    const skuNameMap = await getSkuNames(warehouseId, clientId);

    const days = parseInt(url.searchParams.get('days') || '30');
    send({ type: 'progress', message: 'Building snapshot…' });
    const { rows, kpis } = calculate(stock, orders, skuNameMap, days);

    send({ type: 'done', rows, meta: kpis });
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

  const rows = stock.map(item => {
    const sku         = item.SKU || item.Sku || '';
    const stockQty    = item.Level || 0;
    const name        = item.ProductName || skuNameMap[sku] || '';
    const sold        = velocity[sku] || 0;
    const dailyVel    = sold / days;
    const daysOfCover = dailyVel > 0 ? Math.round(stockQty / dailyVel) : null;

    let status;
    if (stockQty === 0)                                  status = 'out-of-stock';
    else if (daysOfCover !== null && daysOfCover < 14)   status = 'low-stock';
    else if (daysOfCover !== null && daysOfCover > 120)  status = 'overstock';
    else if (sold === 0)                                 status = 'no-movement';
    else                                                 status = 'healthy';

    return { sku, name, stock: stockQty, sold, dailyVel: round(dailyVel, 3), daysOfCover, status };
  }).sort((a, b) => {
    const order = { 'out-of-stock': 0, 'low-stock': 1, 'no-movement': 2, 'overstock': 3, 'healthy': 4 };
    return (order[a.status] ?? 5) - (order[b.status] ?? 5);
  });

  const kpis = {
    total:      rows.length,
    outOfStock: rows.filter(r => r.status === 'out-of-stock').length,
    lowStock:   rows.filter(r => r.status === 'low-stock').length,
    overstock:  rows.filter(r => r.status === 'overstock').length,
    noMovement: rows.filter(r => r.status === 'no-movement').length,
    healthy:    rows.filter(r => r.status === 'healthy').length,
  };

  return { rows, kpis };
}

const round = (n, dp = 2) => Math.round(n * 10 ** dp) / 10 ** dp;

module.exports = { meta, run };
