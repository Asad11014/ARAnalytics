// ─── server/reports/overstock.js ─────────────────────────────────────────────
// Identifies SKUs where current stock significantly exceeds the recommended
// coverage level. Shows where capital is unnecessarily tied up in inventory.

const { fetchStock, fetchOrders, buildSkuSales, startSSE, parseReportParams } = require('./base');

const meta = {
  title:       'Overstock Report',
  description: 'Find SKUs where you\'re holding more stock than needed — freeing up cash and storage space.',
  icon:        '📈',
  params: [
    { id: 'days',         label: 'Velocity Window (days)',        type: 'number', default: 30  },
    { id: 'coverageDays', label: 'Target Coverage (days)',         type: 'number', default: 60  },
    { id: 'overstockPct', label: 'Overstock Threshold (% excess)', type: 'number', default: 50  },
  ]
};

async function run(req, res, url, session) {
  const { apiKey } = session;
  const { warehouseId, clientId, dateFrom, dateTo } = parseReportParams(url, session);
  const coverageDays = parseInt(url.searchParams.get('coverageDays') || '60');
  const days         = parseInt(url.searchParams.get('days')         || '30');
  const overstockPct = parseInt(url.searchParams.get('overstockPct') || '50');

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

    send({ type: 'progress', message: 'Calculating overstock…' });
    const rows = calculate(stock, orders, { days, coverageDays, overstockPct });

    const totalExcess = rows.reduce((s, r) => s + r.excessUnits, 0);
    send({ type: 'done', rows, meta: { total: rows.length, totalExcess } });
  } catch (err) {
    send({ type: 'error', message: err.message });
  }
  res.end();
}

function calculate(stock, orders, { days, coverageDays, overstockPct }) {
  const skuSales = buildSkuSales(orders);

  return stock
    .map(item => {
      const sku          = item.SKU || item.Sku || '';
      const stockQty     = item.Level || 0;
      const name         = item.Name || item.ProductName || '';
      const totalSold    = skuSales[sku] || 0;
      const dailyVel     = totalSold / days;

      // Target stock = what you'd want to hold for coverageDays
      const targetStock  = Math.ceil(coverageDays * dailyVel);
      const excessUnits  = stockQty - targetStock;
      // Excess as a % over target
      const excessPct    = targetStock > 0 ? Math.round((excessUnits / targetStock) * 100) : null;
      // Days of cover at current velocity
      const daysCover    = dailyVel > 0 ? Math.round(stockQty / dailyVel) : null;

      return { sku, name, stock: stockQty, totalSold, dailyVel: round(dailyVel), targetStock, excessUnits, excessPct, daysCover };
    })
    .filter(r => {
      if (r.stock === 0) return false;
      if (r.excessUnits <= 0) return false;
      // Only flag if excess is significant (above threshold %)
      if (r.excessPct !== null && r.excessPct < overstockPct) return false;
      // Also include zero-velocity SKUs with stock (they're infinitely overstocked)
      return true;
    })
    .sort((a, b) => b.excessUnits - a.excessUnits);
}

const round = (n, dp = 2) => Math.round(n * 10 ** dp) / 10 ** dp;

module.exports = { meta, run, calculate };
