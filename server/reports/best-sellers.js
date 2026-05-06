// ─── server/reports/best-sellers.js ──────────────────────────────────────────
// Ranks SKUs by units sold and order frequency over a configurable period.
// Helps clients identify their top performers and worst performers.

const { fetchOrders, buildSkuSales, startSSE, parseReportParams } = require('./base');

const meta = {
  title:       'Best & Worst Sellers',
  description: 'See which SKUs are driving your business and which are underperforming over any time period.',
  icon:        '🏆',
  params: [
    { id: 'days',  label: 'Period (days)', type: 'number', default: 30 },
    { id: 'limit', label: 'Show top/bottom N SKUs', type: 'number', default: 20 },
  ]
};

async function run(req, res, url, session) {
  const { apiKey } = session;
  const { warehouseId, clientId, dateFrom, dateTo } = parseReportParams(url, session);
  const limit = parseInt(url.searchParams.get('limit') || '20');

  const send = startSSE(res);

  try {
    const orders = await fetchOrders(apiKey, warehouseId, clientId, dateFrom, dateTo,
      (p) => send({ type: 'progress', ...p,
        message: p.stage === 'items'
          ? `Fetching order items… ${p.done}/${p.total}`
          : `Fetching orders… page ${p.page} (${p.total} so far)`
      })
    );

    send({ type: 'progress', message: 'Ranking SKUs…' });
    const { topSellers, worstSellers, all } = calculate(orders, { limit });

    send({ type: 'done', topSellers, worstSellers, all,
      meta: { totalOrders: orders.length, totalSkus: all.length }
    });
  } catch (err) {
    send({ type: 'error', message: err.message });
  }
  res.end();
}

function calculate(orders, { limit }) {
  // Build richer per-SKU stats: units sold, order count, unique order dates
  const skuStats = {};

  for (const order of orders) {
    const date = (order.DespatchDate || order.OrderDate || '').split('T')[0];
    for (const item of (order.OrderItems || [])) {
      const sku  = item.SKU || item.Sku || '';
      const qty  = item.Quantity || 0;
      const name = item.ProductDescription || item.Name || '';
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

  // Add rank
  all.forEach((r, i) => { r.rank = i + 1; });

  return {
    topSellers:   all.slice(0, limit),
    worstSellers: [...all].sort((a, b) => a.totalSold - b.totalSold).slice(0, limit),
    all
  };
}

module.exports = { meta, run, calculate };
