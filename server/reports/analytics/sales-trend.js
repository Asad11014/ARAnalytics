// Sales Trend Report
// Compares sales velocity in two periods to identify growing, declining, or new SKUs.

const { resolveIds, resolveClientDbIds, getOrders, getSkuNames } = require('../db-base');
const { startSSE, parseReportParams, fmt, daysAgo } = require('../base');

const meta = {
  title:       'Sales Trend Report',
  description: 'Compare recent sales against the previous period to spot growing SKUs, declining lines, and sudden changes.',
  icon:        '📊',
  params: [
    { id: 'days', label: 'Period to compare (days)', type: 'number', default: 30 },
  ]
};

async function run(req, res, url, session) {
  const { warehouseId: msWarehouseId, clientId: msClientId, clientIds: msClientIds, statuses } = parseReportParams(url, session);
  const days = parseInt(url.searchParams.get('days') || '30');
  const send = startSSE(res);

  try {
    const { accountId, warehouseId, clientId } = await resolveIds(session, msWarehouseId, msClientIds.length ? null : msClientId);
    if (!warehouseId) throw new Error('Warehouse not in database — trigger a sync first');
    const clientDbIds = msClientIds.length ? await resolveClientDbIds(accountId, msClientIds) : null;

    const now       = new Date();
    const recentFrom = fmt(daysAgo(days));
    const priorFrom  = fmt(daysAgo(days * 2));
    const priorTo    = fmt(daysAgo(days + 1));
    const toDate     = fmt(now);

    send({ type: 'progress', message: `Fetching recent orders (last ${days} days)…` });
    const recentOrders = await getOrders(accountId, warehouseId, clientId, recentFrom, toDate, { clientIds: clientDbIds, statuses });

    send({ type: 'progress', message: `Fetching prior orders (${days} days before that)…` });
    const priorOrders = await getOrders(accountId, warehouseId, clientId, priorFrom, priorTo, { clientIds: clientDbIds, statuses });

    send({ type: 'progress', message: 'Fetching product names…' });
    const skuNameMap = await getSkuNames(accountId, warehouseId, clientId);

    send({ type: 'progress', message: 'Calculating trends…' });
    const rows = calculate(recentOrders, priorOrders, skuNameMap, days);

    send({ type: 'done', rows, meta: {
      recentPeriod: `${recentFrom} → ${toDate}`,
      priorPeriod:  `${priorFrom} → ${priorTo}`,
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
      const name   = skuNameMap[sku]  || '';

      const recentVel = recent.units / days;
      const priorVel  = prior.units  / days;

      let changePct = null;
      if (priorVel > 0) changePct = Math.round(((recentVel - priorVel) / priorVel) * 100);

      let trend;
      if (prior.units === 0 && recent.units > 0)     trend = 'new';
      else if (recent.units === 0 && prior.units > 0) trend = 'stopped';
      else if (changePct !== null && changePct >= 20)  trend = 'growing';
      else if (changePct !== null && changePct <= -20) trend = 'declining';
      else                                             trend = 'stable';

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
