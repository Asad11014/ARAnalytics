// Inventory Aging Report
// Buckets each SKU's stock by days since last sale: 0-30 / 31-60 / 61-90 / 90+

const { resolveIds, getStock, getOrders, getSkuNames } = require('../db-base');
const { startSSE, parseReportParams } = require('../base');

const meta = {
  title:       'Inventory Aging',
  description: 'See how long stock has been sitting by bucketing SKUs into aging bands based on days since last sale.',
  icon:        '⏳',
  category:    'inventory',
  params: [
    { id: 'days', label: 'Order history window (days)', type: 'number', default: 90 },
  ]
};

async function run(req, res, url, session) {
  const { warehouseId: msWarehouseId, clientId: msClientId, dateFrom, dateTo } = parseReportParams(url, session);
  const send = startSSE(res);

  try {
    const { accountId, warehouseId, clientId } = await resolveIds(session, msWarehouseId, msClientId);
    if (!warehouseId) throw new Error('Warehouse not in database — trigger a sync first');

    send({ type: 'progress', message: 'Fetching stock levels…' });
    const stock = await getStock(accountId, warehouseId, clientId);

    send({ type: 'progress', message: 'Fetching order history…' });
    const orders = await getOrders(accountId, warehouseId, clientId, dateFrom, dateTo);

    send({ type: 'progress', message: 'Fetching product names…' });
    const skuNameMap = await getSkuNames(accountId, warehouseId, clientId);

    send({ type: 'progress', message: 'Calculating aging…' });
    const rows = calculate(stock, orders, skuNameMap);

    const summary = {
      active:    rows.filter(r => r.bucket === '0–30d').length,
      watch:     rows.filter(r => r.bucket === '31–60d').length,
      atRisk:    rows.filter(r => r.bucket === '61–90d').length,
      dead:      rows.filter(r => r.bucket === '90d+').length,
      totalSkus: rows.length,
    };

    send({ type: 'done', rows, meta: summary });
  } catch (err) {
    send({ type: 'error', message: err.message });
  }
  res.end();
}

function calculate(stock, orders, skuNameMap) {
  const lastSaleDate = {};
  for (const order of orders) {
    const date = order.DespatchDate || order.OrderDate || '';
    if (!date) continue;
    const d = new Date(date);
    for (const item of (order.OrderItems || [])) {
      const sku = item.SKU || item.Sku || '';
      if (!sku) continue;
      if (!lastSaleDate[sku] || d > lastSaleDate[sku]) lastSaleDate[sku] = d;
    }
  }

  const now = new Date();

  return stock
    .filter(item => (item.Level || 0) > 0)
    .map(item => {
      const sku      = item.SKU || item.Sku || '';
      const stockQty = item.Level || 0;
      const name     = item.ProductName || skuNameMap[sku] || '';
      const lastSale = lastSaleDate[sku];
      const daysSince = lastSale ? Math.floor((now - lastSale) / 86400000) : 999;

      let bucket, severity;
      if (daysSince <= 30)      { bucket = '0–30d';  severity = 'active'; }
      else if (daysSince <= 60) { bucket = '31–60d'; severity = 'watch'; }
      else if (daysSince <= 90) { bucket = '61–90d'; severity = 'at-risk'; }
      else                      { bucket = '90d+';   severity = 'dead'; }

      return {
        sku, name, stock: stockQty,
        daysSince:    daysSince === 999 ? null : daysSince,
        bucket, severity,
        lastSaleDate: lastSale ? lastSale.toISOString().split('T')[0] : null
      };
    })
    .sort((a, b) => (b.daysSince ?? 9999) - (a.daysSince ?? 9999));
}

module.exports = { meta, run };
