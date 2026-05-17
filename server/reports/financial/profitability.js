// Customer Profitability / Client Cost Breakdown
// Warehouse view: revenue per client from invoice accruals.
// Client view: their own cost breakdown, split between 3PL service fees and courier pass-throughs.

const { fetchInvoiceSummary, fetchInvoiceList, fetchUnconfirmedInvoiceSummary, fetchStock, startSSE, parseReportParams } = require('../base');

const meta = {
  title:       'Profitability',
  description: 'Warehouse: revenue breakdown per client. Client: your cost breakdown split by service type.',
  icon:        '💹',
  category:    'financial',
  params: []
};

async function run(req, res, url, session) {
  const { apiKey } = session;
  const { warehouseId } = parseReportParams(url, session);
  const from = url.searchParams.get('from') || null;
  const to   = url.searchParams.get('to')   || null;
  const mode = url.searchParams.get('mode') || null;
  const send = startSSE(res);

  try {
    if (session.isWarehouse) {
      await runWarehouseView(send, apiKey, session, from, to);
    } else if (mode === 'totals') {
      await runClientTotals(send, apiKey, { ...session, _lastWarehouseId: warehouseId });
    } else {
      await runClientView(send, apiKey, { ...session, _lastWarehouseId: warehouseId }, from, to);
    }
  } catch (err) {
    send({ type: 'error', message: err.message });
  }
  res.end();
}

// ── Warehouse: revenue per client ─────────────────────────────────────────────

async function runWarehouseView(send, apiKey, session, fromParam, toParam) {
  const clients = session.clients || [];
  if (!clients.length) {
    send({ type: 'done', viewType: 'warehouse', rows: [], meta: { totalRevenue: 0, totalClients: 0 } });
    return;
  }

  const now  = new Date();
  const from = fromParam || new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
  const to   = toParam   || now.toISOString().split('T')[0];

  const rows = [];
  for (let i = 0; i < clients.length; i++) {
    const client   = clients[i];
    const clientId = String(client.ID || client.id);
    const name     = client.Name || client.name || clientId;
    send({ type: 'progress', message: `Fetching billing for ${name} (${i + 1}/${clients.length})…` });

    const inv = await fetchInvoiceSummary(apiKey, clientId, from, to);
    if (!inv) continue;

    const picking = inv.PickingCost  || 0;
    const postage = (inv.PostageCost || 0) + (inv.VatFreePostageCost || 0);
    const storage = inv.StorageCost  || 0;
    const goodsIn = inv.GoodsInCost  || 0;
    const returns = inv.ReturnsCost  || 0;
    const other   = (inv.ReworkCost || 0) + (inv.PackagingCost || 0) +
                    (inv.GenericInvoiceItemsCost || 0) + (inv.CollectionsCost || 0) + (inv.AdminFee || 0);
    const revenue = picking + postage + storage + goodsIn + returns + other;

    if (revenue === 0) continue;
    rows.push({ clientId, name, picking, postage, storage, goodsIn, returns, other, revenue });
  }

  rows.sort((a, b) => b.revenue - a.revenue);

  const totalRevenue = rows.reduce((s, r) => s + r.revenue, 0);
  send({ type: 'done', viewType: 'warehouse', rows, meta: { totalRevenue, totalClients: rows.length, period: `${from} → ${to}` } });
}

// ── Client: own cost breakdown ────────────────────────────────────────────────

async function runClientView(send, apiKey, session, fromParam, toParam) {
  let clientId = session.clientId;

  if (!clientId) {
    const warehouseId = session._lastWarehouseId;
    if (warehouseId) {
      send({ type: 'progress', message: 'Resolving account…' });
      const stock = await fetchStock(apiKey, warehouseId, null);
      if (stock.length > 0) clientId = String(stock[0].ClientId || stock[0].clientId || '');
    }
  }

  if (!clientId) {
    send({ type: 'error', message: 'Could not determine your client account. Please contact your warehouse.' });
    return;
  }

  const now  = new Date();
  const from = fromParam || new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
  const to   = toParam   || now.toISOString().split('T')[0];

  console.log(`  runClientView: from=${from} to=${to}`);
  send({ type: 'progress', message: 'Fetching your billing data…' });
  const inv = await fetchInvoiceSummary(apiKey, clientId, from, to);

  if (!inv) {
    send({ type: 'done', viewType: 'client', breakdown: null, meta: { period: `${from} → ${to}` } });
    return;
  }

  // 3PL service fees — what the warehouse charges for its own labour and services
  const picking = inv.PickingCost  || 0;
  const storage = inv.StorageCost  || 0;
  const goodsIn = inv.GoodsInCost  || 0;
  const returns = inv.ReturnsCost  || 0;
  const other   = (inv.ReworkCost || 0) + (inv.PackagingCost || 0) +
                  (inv.GenericInvoiceItemsCost || 0) + (inv.CollectionsCost || 0) + (inv.AdminFee || 0);
  const serviceFees = picking + storage + goodsIn + returns + other;

  // Courier costs — carrier charges passed through at cost, not a 3PL margin
  const postage = (inv.PostageCost || 0) + (inv.VatFreePostageCost || 0);

  const total = serviceFees + postage;

  send({
    type: 'done',
    viewType: 'client',
    breakdown: { picking, storage, goodsIn, returns, other, serviceFees, postage, total },
    meta: { total, serviceFees, postage, period: `${from} → ${to}` },
  });
}

// ── Client: all invoice totals for the periods table ─────────────────────────

function sumInvoice(inv) {
  return (inv.PickingCost || 0) + (inv.PostageCost || 0) + (inv.VatFreePostageCost || 0) +
         (inv.StorageCost || 0) + (inv.GoodsInCost || 0) + (inv.ReturnsCost || 0) +
         (inv.ReworkCost  || 0) + (inv.PackagingCost || 0) + (inv.GenericInvoiceItemsCost || 0) +
         (inv.CollectionsCost || 0) + (inv.AdminFee || 0);
}

async function runClientTotals(send, apiKey, session) {
  let clientId = session.clientId;

  if (!clientId) {
    const warehouseId = session._lastWarehouseId;
    if (warehouseId) {
      const stock = await fetchStock(apiKey, warehouseId, null);
      if (stock.length > 0) clientId = String(stock[0].ClientId || stock[0].clientId || '');
    }
  }

  if (!clientId) {
    send({ type: 'done', viewType: 'client-totals', totals: {} });
    return;
  }

  const totals = {};

  // Past confirmed invoices
  const invoices = await fetchInvoiceList(apiKey, clientId);
  for (const inv of invoices) {
    const d    = new Date(inv.Date || inv.InvoiceDate || 0);
    const yymm = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    totals[yymm] = sumInvoice(inv);
  }

  // Current month unconfirmed accruals
  const now  = new Date();
  const y    = now.getFullYear();
  const m    = String(now.getMonth() + 1).padStart(2, '0');
  const day  = String(now.getDate()).padStart(2, '0');
  const currentYYMM = `${y}-${m}`;
  const unconfirmed = await fetchUnconfirmedInvoiceSummary(apiKey, clientId, `${y}-${m}-01`, `${y}-${m}-${day}`);
  if (unconfirmed) totals[currentYYMM] = sumInvoice(unconfirmed);

  send({ type: 'done', viewType: 'client-totals', totals });
}

module.exports = { meta, run };
