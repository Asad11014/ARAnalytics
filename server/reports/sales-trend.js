// ─── server/reports/sales-trend.js ───────────────────────────────────────────
// Compares sales velocity in two periods (e.g. last 30 days vs prior 30 days)
// to identify SKUs that are growing fast, declining, or newly active.

const { fetchOrders, fetchProductNames, startSSE, parseReportParams } = require('./base');

const meta = {
  title:       'Sales Trend Report',
  description: 'Compare recent sales against the previous period to spot growing SKUs, declining lines, and sudden changes.',
  icon:        '📊',
  params: [
    { id: 'days', label: 'Period to compare (days)', type: 'number', default: 30 },
  ]
};

async function run(req, res, url, session) {
  const { apiKey } = session;
  const { warehouseId, clientId } = parseReportParams(url, session);
  const days = parseInt(url.searchParams.get('days') || '30');

  const send = startSSE(res);

  try {
    // Fetch two periods: recent (last N days) and prior (N days before that)
    const now        = new Date();
    const recentFrom = new Date(now); recentFrom.setDate(now.getDate() - days);
    const priorFrom  = new Date(now); priorFrom.setDate(now.getDate() - days * 2);
    const priorTo    = new Date(now); priorTo.setDate(now.getDate() - days - 1);

    const fmt = d => d.toISOString().split('T')[0];

    send({ type: 'progress', message: `Fetching recent orders (last ${days} days)…` });
    const recentOrders = await fetchOrders(apiKey, warehouseId, clientId, fmt(recentFrom), fmt(now),
      (p) => send({ type: 'progress', ...p, message: p.stage === 'items' ? `Recent orders: items ${p.done}/${p.total}` : `Recent orders: page ${p.page}` })
    );

    send({ type: 'progress', message: `Fetching prior orders (${days} days before that)…` });
    const priorOrders = await fetchOrders(apiKey, warehouseId, clientId, fmt(priorFrom), fmt(priorTo),
      (p) => send({ type: 'progress', ...p, message: p.stage === 'items' ? `Prior orders: items ${p.done}/${p.total}` : `Prior orders: page ${p.page}` })
    );

    send({ type: 'progress', message: 'Fetching product names…' });
    const skuNameMap = await fetchProductNames(apiKey, warehouseId, clientId);

    send({ type: 'progress', message: 'Calculating trends…' });
    const rows = calculate(recentOrders, priorOrders, skuNameMap, days);

    send({ type: 'done', rows, meta: {
      recentPeriod: `${fmt(recentFrom)} → ${fmt(now)}`,
      priorPeriod:  `${fmt(priorFrom)} → ${fmt(priorTo)}`,
      totalSkus:    rows.length,
      growing:      rows.filter(r => r.trend === 'growing').length,
      declining:    rows.filter(r => r.trend === 'declining').length,
      new:          rows.filter(r => r.trend === 'new').length,
    }});
  } catch (err) {
    send({ type: 'error', message: err.message });
  }
  res.end();
}

function calculate(recentOrders, priorOrders, skuNameMap, days) {
  const recentSales = buildSales(recentOrders);
  const priorSales  = buildSales(priorOrders);

  const allSkus = new Set([...Object.keys(recentSales), ...Object.keys(priorSales)]);

  return Array.from(allSkus)
    .map(sku => {
      const recent = recentSales[sku] || { units: 0 };
      const prior  = priorSales[sku]  || { units: 0 };
      const name   = skuNameMap[sku] || '';

      const recentVel = recent.units / days;
      const priorVel  = prior.units  / days;

      // % change in velocity
      let changePct = null;
      if (priorVel > 0) changePct = Math.round(((recentVel - priorVel) / priorVel) * 100);

      // Classify trend
      let trend;
      if (prior.units === 0 && recent.units > 0)    trend = 'new';       // no prior sales
      else if (recent.units === 0 && prior.units > 0) trend = 'stopped';  // sold before, not now
      else if (changePct !== null && changePct >= 20)  trend = 'growing';
      else if (changePct !== null && changePct <= -20) trend = 'declining';
      else                                              trend = 'stable';

      return {
        sku,
        name,
        recentUnits: recent.units,
        priorUnits:  prior.units,
        recentVel:   round(recentVel),
        priorVel:    round(priorVel),
        changePct,
        trend,
      };
    })
    .sort((a, b) => {
      // Sort: growing first, then stable, declining, new, stopped
      const order = { growing: 0, stable: 1, declining: 2, new: 3, stopped: 4 };
      if (order[a.trend] !== order[b.trend]) return order[a.trend] - order[b.trend];
      return (b.changePct || 0) - (a.changePct || 0);
    });
}

function buildSales(orders) {
  const sales = {};
  for (const order of orders) {
    for (const item of (order.OrderItems || [])) {
      const sku = item.SKU || item.Sku || '';
      const qty = item.Quantity || 0;
      if (!sku || !qty) continue;
      if (!sales[sku]) sales[sku] = { units: 0 };
      sales[sku].units += qty;
    }
  }
  return sales;
}

const round = (n, dp = 2) => Math.round(n * 10 ** dp) / 10 ** dp;

module.exports = { meta, run, calculate };
