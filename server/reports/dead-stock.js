// ─── server/reports/dead-stock.js ────────────────────────────────────────────
// Identifies SKUs with zero or near-zero sales velocity over a configurable period.
// These SKUs are occupying paid warehouse space without generating revenue.

const { fetchStock, fetchOrders, fetchProductNames, buildSkuSales, startSSE, parseReportParams } = require('./base');

const meta = {
  title:       'Dead Stock Report',
  description: 'Identify SKUs that haven\'t sold in a given period — freeing up warehouse space and tied-up capital.',
  icon:        '🪦',
  params: [
    { id: 'days',        label: 'Lookback Period (days)',        type: 'number', default: 90 },
    { id: 'threshold',   label: 'Max Units Sold (dead = below)', type: 'number', default: 1  },
  ]
};

async function run(req, res, url, session) {
  const { apiKey } = session;
  const { warehouseId, clientId, dateFrom, dateTo } = parseReportParams(url, session);
  const threshold = parseInt(url.searchParams.get('threshold') || '1');

  const send = startSSE(res);

  try {
    send({ type: 'progress', message: 'Fetching stock levels…' });
    const stock = await fetchStock(apiKey, warehouseId, clientId);

    const orders = await fetchOrders(apiKey, warehouseId, clientId, dateFrom, dateTo,
      (p) => send({ type: 'progress', ...p,
        message: p.stage === 'items'
          ? `Fetching order items… ${p.done}/${p.total}`
          : `Fetching orders… page ${p.page} (${p.total} so far)`
      })
    );

    send({ type: 'progress', message: 'Fetching product names…' });
    const skuNameMap = await fetchProductNames(apiKey, warehouseId, clientId);

    send({ type: 'progress', message: 'Identifying dead stock…' });
    const rows = calculate(stock, orders, skuNameMap, { threshold });

    const totalUnits = rows.reduce((s, r) => s + r.stock, 0);
    send({ type: 'done', rows, meta: { total: rows.length, totalUnits } });
  } catch (err) {
    send({ type: 'error', message: err.message });
  }
  res.end();
}

function calculate(stock, orders, skuNameMap, { threshold }) {
  const skuSales = buildSkuSales(orders);

  return stock
    .filter(item => {
      const stockQty  = item.Level || 0;
      if (stockQty === 0) return false; // no point flagging empty SKUs
      const sku       = item.SKU || item.Sku || '';
      const totalSold = skuSales[sku] || 0;
      return totalSold < threshold; // sold less than threshold = dead
    })
    .map(item => {
      const sku      = item.SKU || item.Sku || '';
      const stockQty = item.Level || 0;
      const name     = skuNameMap[sku] || item.Name || '';
      const sold     = skuSales[sku] || 0;

      return {
        sku,
        name,
        stock:     stockQty,
        totalSold: sold,
        // Urgency based on how long the stock has been sitting
        // (we can't know exact age without goods-in data, so we flag by volume)
        severity: stockQty > 100 ? 'high' : stockQty > 20 ? 'medium' : 'low'
      };
    })
    .sort((a, b) => {
      // Sort by severity then stock quantity
      const order = { high: 0, medium: 1, low: 2 };
      if (order[a.severity] !== order[b.severity]) return order[a.severity] - order[b.severity];
      return b.stock - a.stock;
    });
}

module.exports = { meta, run, calculate };
