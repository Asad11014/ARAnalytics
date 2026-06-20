// Best & Worst Sellers
// Ranks SKUs by units sold and order frequency over a configurable period.

const { resolveIds, resolveClientDbIds, getOrders, getSkuNames } = require('../db-base');
const { startSSE, parseReportParams } = require('../base');

const meta = {
  title:       'Best & Worst Sellers',
  description: 'See which SKUs are driving your business and which are underperforming over any time period.',
  icon:        '🏆',
  params: [
    { id: 'days',  label: 'Period (days)',         type: 'number', default: 30 },
    { id: 'limit', label: 'Show top/bottom N SKUs', type: 'number', default: 20 },
  ]
};

async function run(req, res, url, session) {
  const { warehouseId: msWarehouseId, clientId: msClientId, clientIds: msClientIds, statuses, dateFrom, dateTo } = parseReportParams(url, session);
  const limit = parseInt(url.searchParams.get('limit') || '20');
  const send  = startSSE(res);

  try {
    const { warehouseId, clientId } = resolveIds(session, msWarehouseId, msClientIds.length ? null : msClientId);
    if (!warehouseId) throw new Error('warehouseId is required');
    const clientDbIds = msClientIds.length ? resolveClientDbIds(msClientIds) : null;

    send({ type: 'progress', message: 'Fetching order history…' });
    const orders = await getOrders(warehouseId, clientId, dateFrom, dateTo, { clientIds: clientDbIds, statuses });

    send({ type: 'progress', message: 'Fetching product names…' });
    const skuNameMap = await getSkuNames(warehouseId, clientId);

    send({ type: 'progress', message: 'Ranking SKUs…' });
    const { topSellers, worstSellers, all } = calculate(orders, skuNameMap, { limit });

    send({ type: 'done', topSellers, worstSellers, all,
      meta: { totalOrders: orders.length, totalSkus: all.length }
    });
  } catch (err) {
    send({ type: 'error', message: err.message });
  }
  res.end();
}

function calculate(orders, skuNameMap, { limit }) {
  const skuStats = {};

  for (const order of orders) {
    const date = (order.DespatchDate || order.OrderDate || '').slice(0, 10);
    for (const item of (order.OrderItems || [])) {
      const sku  = item.SKU || item.Sku || '';
      const qty  = item.Quantity || 0;
      const name = skuNameMap[sku] || '';
      if (!sku || !qty) continue;

      if (!skuStats[sku]) skuStats[sku] = { sku, name, totalSold: 0, orderCount: 0, dates: new Set() };
      skuStats[sku].totalSold  += qty;
      skuStats[sku].orderCount += 1;
      if (date) skuStats[sku].dates.add(date);
    }
  }

  const all = Object.values(skuStats)
    .map(s => ({
      sku:        s.sku,
      name:       s.name,
      totalSold:  s.totalSold,
      orderCount: s.orderCount,
      activeDays: s.dates.size,
    }))
    .sort((a, b) => b.totalSold - a.totalSold);

  all.forEach((r, i) => { r.rank = i + 1; });

  return {
    topSellers:   all.slice(0, limit),
    worstSellers: [...all].sort((a, b) => a.totalSold - b.totalSold).slice(0, limit),
    all
  };
}

module.exports = { meta, run, calculate };
