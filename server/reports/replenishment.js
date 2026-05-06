// ─── server/reports/replenishment.js ─────────────────────────────────────────
// How much of each SKU does the client need to order?
// Formula: ((coverageDays + leadTime) × dailyVelocity) - currentStock

const { fetchStock, fetchOrders, buildSkuSales, startSSE, parseReportParams } = require('./base');

const meta = {
  title:       'Replenishment Planner',
  description: 'Calculate exactly how much of each SKU to order so you never run out of stock.',
  icon:        '📦',
  params: [
    { id: 'days',         label: 'Velocity Window (days)', type: 'number', default: 30 },
    { id: 'coverageDays', label: 'Coverage Target (days)', type: 'number', default: 60 },
    { id: 'leadTime',     label: 'Lead Time (days)',        type: 'number', default: 14 },
  ]
};

async function run(req, res, url, session) {
  const { apiKey }  = session;
  const { warehouseId, clientId, dateFrom, dateTo } = parseReportParams(url, session);
  const coverageDays = parseInt(url.searchParams.get('coverageDays') || '60');
  const leadTime     = parseInt(url.searchParams.get('leadTime')     || '14');
  const days         = parseInt(url.searchParams.get('days')         || '30');

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

    send({ type: 'progress', message: 'Calculating replenishment…' });
    const rows = calculate(stock, orders, { days, coverageDays, leadTime });

    send({ type: 'done', rows, meta: { total: rows.length, needsOrder: rows.filter(r => r.orderQty > 0).length } });
  } catch (err) {
    send({ type: 'error', message: err.message });
  }
  res.end();
}

function calculate(stock, orders, { days, coverageDays, leadTime }) {
  const skuSales = buildSkuSales(orders);

  return stock
    .map(item => {
      const sku       = item.SKU || item.Sku || '';
      const stockQty  = item.Level || 0;
      const name      = item.Name || item.ProductName || '';
      const totalSold = skuSales[sku] || 0;
      const dailyVel  = totalSold / days;
      const daysLeft  = dailyVel > 0 ? Math.round(stockQty / dailyVel) : null;
      const orderQty  = Math.max(0, Math.ceil((coverageDays + leadTime) * dailyVel - stockQty));

      return { sku, name, stock: stockQty, totalSold, dailyVel: round(dailyVel), daysLeft, leadTime, orderQty };
    })
    .filter(r => r.stock > 0 || r.totalSold > 0)
    .sort((a, b) => {
      if (a.orderQty > 0 && b.orderQty === 0) return -1;
      if (b.orderQty > 0 && a.orderQty === 0) return 1;
      if (a.daysLeft === null) return 1;
      if (b.daysLeft === null) return -1;
      return a.daysLeft - b.daysLeft;
    });
}

const round = (n, dp = 2) => Math.round(n * 10 ** dp) / 10 ** dp;

module.exports = { meta, run, calculate };
