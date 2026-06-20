// ─── server/returns.js ────────────────────────────────────────────────────────
// Returns workflow. A client books a return (status 'pending'); the warehouse is
// emailed and actions it in the Returns Hub, booking a courier collection and
// moving the status forward. Status lives in one shared row, so any change by any
// user is reflected for everyone with access.

const { query, queryOne } = require('./db');
const { sendEmail } = require('./email');

// Status lifecycle (extensible). 'pending' = warehouse notified, action required.
const RETURN_STATUSES = ['pending', 'booked', 'collected', 'completed', 'cancelled'];

const esc = s => String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

// ── Email notification ──────────────────────────────────────────────────────
// Emails the return details to warehouse staff so they can book the collection.
async function notifyWarehouseOfReturn(record, clientName) {
  const recipients = (process.env.RETURNS_NOTIFY_EMAILS || 'arizvi@premiumfulfilment.co.uk')
    .split(',').map(s => s.trim()).filter(Boolean);

  const f = record.form_data || {};
  const addr = f.address || {};
  const addressStr = [addr.line1, addr.line2, addr.line3, addr.town, addr.county, addr.postcode]
    .filter(Boolean).join(', ');
  const itemsRows = (f.items || [])
    .map(i => `<tr><td style="padding:4px 10px;border:1px solid #e2e8f0">${esc(i.sku)}</td><td style="padding:4px 10px;border:1px solid #e2e8f0">${esc(i.name)}</td><td style="padding:4px 10px;border:1px solid #e2e8f0;text-align:right">${esc(i.quantity)}</td></tr>`)
    .join('');

  const html = `
    <div style="font-family:Arial,sans-serif;color:#1a1c2e;max-width:640px">
      <h2 style="color:#2D4270;margin-bottom:4px">New return request #${record.id}</h2>
      <p style="color:#6b7280;margin-top:0">A client has requested a return collection. Action required: book the courier collection.</p>
      <table style="border-collapse:collapse;font-size:14px;margin:12px 0">
        <tr><td style="padding:4px 10px;color:#6b7280">Client</td><td style="padding:4px 10px;font-weight:bold">${esc(clientName || record.client_id || '—')}</td></tr>
        <tr><td style="padding:4px 10px;color:#6b7280">Order reference</td><td style="padding:4px 10px;font-weight:bold">${esc(record.reference || '—')}</td></tr>
        <tr><td style="padding:4px 10px;color:#6b7280">Customer</td><td style="padding:4px 10px">${esc(record.customer_name || '—')}</td></tr>
        <tr><td style="padding:4px 10px;color:#6b7280">Contact</td><td style="padding:4px 10px">${esc([f.customerEmail, f.customerPhone].filter(Boolean).join(' · ') || '—')}</td></tr>
        <tr><td style="padding:4px 10px;color:#6b7280">Collection address</td><td style="padding:4px 10px">${esc(addressStr || '—')}</td></tr>
        <tr><td style="padding:4px 10px;color:#6b7280">Preferred collection date</td><td style="padding:4px 10px;font-weight:bold">${esc(f.preferredCollectionDate || '—')}</td></tr>
        <tr><td style="padding:4px 10px;color:#6b7280">Raised by</td><td style="padding:4px 10px">${esc(record.created_by || '—')}</td></tr>
      </table>
      <h3 style="color:#2D4270;margin-bottom:6px">Items to return</h3>
      <table style="border-collapse:collapse;font-size:13px">
        <tr style="background:#f5f6fa"><th style="padding:4px 10px;border:1px solid #e2e8f0;text-align:left">SKU</th><th style="padding:4px 10px;border:1px solid #e2e8f0;text-align:left">Product</th><th style="padding:4px 10px;border:1px solid #e2e8f0">Qty</th></tr>
        ${itemsRows || '<tr><td colspan="3" style="padding:6px 10px;border:1px solid #e2e8f0;color:#6b7280">No items listed</td></tr>'}
      </table>
      ${f.notes ? `<p style="margin-top:12px"><strong>Notes:</strong> ${esc(f.notes)}</p>` : ''}
      <p style="color:#6b7280;font-size:12px;margin-top:16px">Manage this return in the Returns Hub.</p>
    </div>`;

  await sendEmail({
    to: recipients,
    subject: `Return request #${record.id} — ${record.reference || 'order'} (${clientName || 'client'})`,
    html,
    replyTo: f.customerEmail || undefined,
  });
}

// Shape a DB row for the client.
function toRecord(r) {
  return {
    id:           r.id,
    clientId:     r.client_id,
    status:       r.status,
    reference:    r.reference,
    customerName: r.customer_name,
    formData:     r.form_data,
    bookingData:  r.booking_data,
    createdBy:    r.created_by,
    bookedBy:     r.booked_by,
    createdAt:    r.created_at,
    updatedAt:    r.updated_at,
  };
}

// POST /api/returns — client raises a return request.
async function create(req, res, session) {
  const body = await req.json().catch(() => ({}));

  // Clients are locked to their own client; warehouse users may pass clientId.
  const clientId = session.isWarehouse
    ? (body.clientId ? parseInt(body.clientId) : null)
    : (session.clientId ? parseInt(session.clientId) : null);

  const reference    = body.reference || body.orderNumber || null;
  const customerName = body.customerName || body.customer || null;

  const row = await queryOne(
    `INSERT INTO returns (client_id, status, reference, customer_name, form_data, created_by)
     VALUES ((SELECT id FROM clients WHERE id=$1 LIMIT 1), 'pending', $2, $3, $4, $5)
     RETURNING *`,
    [clientId, reference, customerName, JSON.stringify(body), session.username || null]
  );

  // Fire-and-forget the warehouse notification.
  const client = clientId ? await queryOne(`SELECT name FROM clients WHERE id=$1`, [clientId]) : null;
  setImmediate(() => notifyWarehouseOfReturn(row, client?.name).catch(e => console.error('[returns] notify error:', e.message)));

  return res.json(201, { return: toRecord(row) });
}

// GET /api/returns — clients see their own; warehouse sees all (optional ?status=).
async function list(req, res, url, session) {
  const conditions = [];
  const params = [];

  if (!session.isWarehouse) {
    if (!session.clientId) return res.json(200, { returns: [] });
    conditions.push(`client_id = $${params.push(parseInt(session.clientId))}`);
  } else {
    const status = url.searchParams.get('status');
    if (status) conditions.push(`status = $${params.push(status)}`);
    const clientId = url.searchParams.get('clientId');
    if (clientId) conditions.push(`client_id = $${params.push(parseInt(clientId))}`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const rows = await query(
    `SELECT r.*, c.name AS client_name
     FROM returns r LEFT JOIN clients c ON c.id = r.client_id
     ${where} ORDER BY r.created_at DESC`,
    params
  );
  return res.json(200, {
    returns: rows.map(r => ({ ...toRecord(r), clientNameResolved: r.client_name })),
  });
}

// PATCH /api/returns/:id — warehouse updates status + booking details.
async function update(req, res, session, id) {
  if (!session.isWarehouse) return res.json(403, { error: 'Warehouse users only' });

  const body = await req.json().catch(() => ({}));
  const existing = await queryOne(`SELECT * FROM returns WHERE id = $1`, [parseInt(id)]);
  if (!existing) return res.json(404, { error: 'Return not found' });

  const sets = [];
  const params = [];

  if (body.status !== undefined) {
    if (!RETURN_STATUSES.includes(body.status)) {
      return res.json(400, { error: `Invalid status. Allowed: ${RETURN_STATUSES.join(', ')}` });
    }
    sets.push(`status = $${params.push(body.status)}`);
  }
  if (body.bookingData !== undefined) {
    // Merge onto existing booking_data so partial updates don't clobber.
    const merged = { ...(existing.booking_data || {}), ...body.bookingData };
    sets.push(`booking_data = $${params.push(JSON.stringify(merged))}`);
  }
  if (body.reference !== undefined)    sets.push(`reference = $${params.push(body.reference)}`);
  if (body.customerName !== undefined) sets.push(`customer_name = $${params.push(body.customerName)}`);

  // Stamp who actioned it once it moves beyond pending.
  sets.push(`booked_by = $${params.push(session.username || null)}`);
  sets.push(`updated_at = NOW()`);

  const row = await queryOne(
    `UPDATE returns SET ${sets.join(', ')} WHERE id = $${params.push(parseInt(id))} RETURNING *`,
    params
  );
  return res.json(200, { return: toRecord(row) });
}

module.exports = { create, list, update, RETURN_STATUSES };
