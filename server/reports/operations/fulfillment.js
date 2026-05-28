// Order Fulfillment Performance
// Measures how quickly orders are fulfilled and how consistently SLAs are met.

const { resolveIds, resolveClientDbIds, getOrderHeaders } = require('../db-base');
const { startSSE, parseReportParams } = require('../base');

const meta = {
  title:       'Fulfillment Performance',
  description: 'Measure order-to-despatch times, same-day shipping rates, and SLA compliance across all clients.',
  icon:        '📤',
  category:    'operations',
  params: [
    { id: 'days',    label: 'Period (days)',     type: 'number', default: 30 },
    { id: 'slaDays', label: 'SLA target (days)', type: 'number', default: 2  },
  ]
};

async function run(req, res, url, session) {
  const { warehouseId: msWarehouseId, clientId: msClientId, clientIds: msClientIds, statuses, dateFrom, dateTo } = parseReportParams(url, session);
  const slaDays = parseInt(url.searchParams.get('slaDays') || '2');
  const send = startSSE(res);

  try {
    const { warehouseId, clientId } = resolveIds(session, msWarehouseId, msClientIds.length ? null : msClientId);
    if (!warehouseId) throw new Error('warehouseId is required');
    const clientDbIds = msClientIds.length ? resolveClientDbIds(msClientIds) : null;

    const clientMap = {};
    for (const c of (session.clients || [])) {
      const id   = String(c.ID || c.Id || c.id || '');
      const name = c.Name || c.ClientName || c.ShortName || id;
      if (id) clientMap[id] = name;
    }

    send({ type: 'progress', message: 'Fetching orders…' });
    const orders = await getOrderHeaders(warehouseId, clientId, dateFrom, dateTo, { clientIds: clientDbIds, statuses });

    send({ type: 'progress', message: 'Calculating fulfillment metrics…' });
    const { rows, kpis } = calculate(orders, slaDays, clientMap, msClientId);

    send({ type: 'done', rows, meta: kpis });
  } catch (err) {
    send({ type: 'error', message: err.message });
  }
  res.end();
}

function calculate(orders, slaDays, clientMap, filterClientId) {
  const byClient = {};

  for (const order of orders) {
    const orderDate    = order.OrderDate    ? new Date(order.OrderDate)    : null;
    const despatchDate = order.DespatchDate ? new Date(order.DespatchDate) : null;

    const ordClientId = String(order.ClientId || order.ClientID || '');
    const clientName  = filterClientId
      ? (clientMap[String(filterClientId)] || 'My Account')
      : (clientMap[ordClientId] || ordClientId || 'Unknown');
    const key = (filterClientId ? String(filterClientId) : ordClientId) || 'unknown';

    if (!byClient[key]) byClient[key] = { clientName, orders: 0, despatched: 0, sameDay: 0, withinSla: 0, totalDays: 0, late: 0 };
    const c = byClient[key];
    c.orders += 1;

    if (despatchDate) {
      c.despatched += 1;
      if (orderDate) {
        const diffDays = Math.max(0, Math.floor((despatchDate - orderDate) / 86400000));
        c.totalDays += diffDays;
        if (diffDays === 0)         c.sameDay += 1;
        if (diffDays <= slaDays)    c.withinSla += 1;
        else                        c.late += 1;
      }
    }
  }

  const rows = Object.values(byClient).map(c => ({
    clientName:  c.clientName,
    orders:      c.orders,
    despatched:  c.despatched,
    sameDayPct:  c.despatched ? Math.round((c.sameDay    / c.despatched) * 100) : null,
    slaPct:      c.despatched ? Math.round((c.withinSla  / c.despatched) * 100) : null,
    avgDays:     c.despatched ? round(c.totalDays / c.despatched) : null,
    lateOrders:  c.late,
  })).sort((a, b) => (a.slaPct ?? -1) - (b.slaPct ?? -1));

  const total      = orders.length;
  const despatched = rows.reduce((s, r) => s + r.despatched, 0);
  const sameDay    = rows.reduce((s, r) => s + (r.sameDayPct != null ? Math.round(r.sameDayPct / 100 * r.despatched) : 0), 0);
  const withinSla  = rows.reduce((s, r) => s + (r.slaPct    != null ? Math.round(r.slaPct    / 100 * r.despatched) : 0), 0);
  const totalDays  = rows.reduce((s, r) => s + (r.avgDays   != null ? r.avgDays * r.despatched : 0), 0);

  const kpis = {
    totalOrders:    total,
    despatched,
    sameDayPct:     despatched ? Math.round((sameDay    / despatched) * 100) : 0,
    slaPct:         despatched ? Math.round((withinSla  / despatched) * 100) : 0,
    avgFulfillDays: despatched ? round(totalDays / despatched) : 0,
    lateOrders:     rows.reduce((s, r) => s + r.lateOrders, 0),
  };

  return { rows, kpis };
}

const round = (n, dp = 1) => Math.round(n * 10 ** dp) / 10 ** dp;

module.exports = { meta, run };
