// Customer Profitability / Client Cost Breakdown
// Warehouse view: revenue per client from invoice data.
// Client view: own cost breakdown, split between 3PL service fees and courier costs.

const { resolveIds, getInvoiceForClient, getInvoicesForMonth, getAllClientInvoices } = require('../db-base');
const { startSSE, parseReportParams } = require('../base');
const { query } = require('../../db');

const meta = {
  title:       'Profitability',
  description: 'Warehouse: revenue breakdown per client. Client: your cost breakdown split by service type.',
  icon:        '💹',
  category:    'financial',
  params: []
};

async function run(req, res, url, session) {
  const { warehouseId: msWarehouseId } = parseReportParams(url, session);
  const from = url.searchParams.get('from') || null;
  const to   = url.searchParams.get('to')   || null;
  const mode = url.searchParams.get('mode') || null;
  const send = startSSE(res);

  try {
    const { clientId } = resolveIds(session, msWarehouseId, session.isWarehouse ? null : session.clientId);

    if (session.isWarehouse) {
      await runWarehouseView(send, session, from, to);
    } else if (mode === 'totals') {
      await runClientTotals(send, clientId, session);
    } else {
      await runClientView(send, clientId, session, from, to);
    }
  } catch (err) {
    send({ type: 'error', message: err.message });
  }
  res.end();
}

// ── Warehouse: revenue per client ─────────────────────────────────────────────

async function runWarehouseView(send, session, fromParam, toParam) {
  const clients = session.clients || [];
  if (!clients.length) {
    send({ type: 'done', viewType: 'warehouse', rows: [], meta: { totalRevenue: 0, totalClients: 0 } });
    return;
  }

  const now  = new Date();
  const from = fromParam || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  const to   = toParam   || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

  send({ type: 'progress', message: 'Fetching billing data…' });
  const invRows = await getInvoicesForMonth(from);

  const invMap = {};
  for (const inv of invRows) invMap[String(inv.ClientId)] = inv;

  const rows = [];
  for (const client of clients) {
    const msClientId = String(client.ID || client.id);
    const name       = client.Name || client.name || msClientId;
    const inv        = invMap[msClientId];
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
    rows.push({ clientId: msClientId, name, picking, postage, storage, goodsIn, returns, other, revenue });
  }

  rows.sort((a, b) => b.revenue - a.revenue);
  const totalRevenue = rows.reduce((s, r) => s + r.revenue, 0);
  send({ type: 'done', viewType: 'warehouse', rows, meta: { totalRevenue, totalClients: rows.length, period: `${from} → ${to}` } });
}

// ── Client: own cost breakdown ────────────────────────────────────────────────

async function runClientView(send, clientId, session, fromParam, toParam) {
  if (!clientId) {
    send({ type: 'error', message: 'Could not determine your client account. Please contact your warehouse.' });
    return;
  }

  const now  = new Date();
  const from = fromParam || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  const to   = toParam   || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

  send({ type: 'progress', message: 'Fetching your billing data…' });
  const inv = await getInvoiceForClient(clientId, from);

  if (!inv) {
    send({ type: 'done', viewType: 'client', breakdown: null, meta: { period: `${from} → ${to}` } });
    return;
  }

  // Individual line items, matching the descriptions used on the client invoice.
  const lines = {
    pickingCost:      inv.PickingCost              || 0,
    postageCost:      inv.PostageCost              || 0,
    vatFreePostage:   inv.VatFreePostageCost       || 0,
    reworkCost:       inv.ReworkCost               || 0,
    packagingCost:    inv.PackagingCost            || 0,
    genericAdminCost: inv.GenericInvoiceItemsCost  || 0,
    invoiceAdminCost: inv.AdminFee                 || 0,
    goodsInCost:      inv.GoodsInCost              || 0,
    returnsCost:      inv.ReturnsCost              || 0,
    collectionsCost:  inv.CollectionsCost          || 0,
    storageCost:      inv.StorageCost              || 0,
  };

  const subtotal = Object.values(lines).reduce((s, v) => s + v, 0); // net
  const vat      = (subtotal - lines.vatFreePostage) * 0.20;        // VAT-free postage isn't VAT-rated
  const grand    = subtotal + vat;

  // Per-order detail for the period (orders despatched within the billing month).
  send({ type: 'progress', message: 'Fetching order detail…' });
  const orderRows = await query(
    `SELECT o.order_number, o.despatch_date::date AS date,
            NULLIF(TRIM(CONCAT_WS(' ', o.recipient_first_name, o.recipient_last_name)), '') AS customer,
            o.number_of_parcels, o.courier_service_name, o.total_order_gross AS order_value,
            COALESCE((SELECT SUM(quantity) FROM order_items oi WHERE oi.order_id = o.id), 0)::int AS units
     FROM orders o
     WHERE o.client_id = $1 AND o.despatch_date::date >= $2 AND o.despatch_date::date <= $3
     ORDER BY o.despatch_date`,
    [clientId, from, to]
  );

  const totalUnits   = orderRows.reduce((s, o) => s + (o.units || 0), 0);
  const totalParcels = orderRows.reduce((s, o) => s + (o.number_of_parcels || 0), 0);
  // Picking is billed per pick, so allocate it across orders by unit share.
  const pickingPerUnit = totalUnits > 0 ? lines.pickingCost / totalUnits : 0;

  const orders = orderRows.map(o => ({
    orderNumber: o.order_number,
    date:        o.date,
    customer:    o.customer || '—',
    units:       o.units || 0,
    parcels:     o.number_of_parcels || 0,
    courier:     o.courier_service_name || '—',
    orderValue:  Number(o.order_value || 0),
    pickingEst:  Math.round((o.units || 0) * pickingPerUnit * 100) / 100,
  }));

  send({
    type: 'done',
    viewType: 'client',
    breakdown: { ...lines, subtotal, vat, grand },
    orders,
    stats: { orderCount: orders.length, totalUnits, totalParcels },
    meta:  { subtotal, vat, grand, period: `${from} → ${to}` },
  });
}

// ── Client: all invoice totals for the billing periods table ─────────────────

async function runClientTotals(send, clientId, session) {
  if (!clientId) {
    send({ type: 'done', viewType: 'client-totals', totals: {} });
    return;
  }

  // Clients only see confirmed invoices — the unconfirmed current-month accrual
  // is deliberately excluded.
  const { confirmed } = await getAllClientInvoices(clientId);
  const totals = {};

  for (const inv of confirmed) {
    const d    = new Date(inv.Date);
    const yymm = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    totals[yymm] = sumInvoice(inv);
  }

  send({ type: 'done', viewType: 'client-totals', totals });
}

function sumInvoice(inv) {
  return (inv.PickingCost || 0) + (inv.PostageCost || 0) + (inv.VatFreePostageCost || 0) +
         (inv.StorageCost || 0) + (inv.GoodsInCost || 0) + (inv.ReturnsCost || 0) +
         (inv.ReworkCost  || 0) + (inv.PackagingCost || 0) + (inv.GenericInvoiceItemsCost || 0) +
         (inv.CollectionsCost || 0) + (inv.AdminFee || 0);
}

module.exports = { meta, run };
