// ─── server/returns.js ────────────────────────────────────────────────────────
// Returns workflow. A client books a return (status 'pending'); the warehouse is
// emailed and actions it in the Returns Hub, booking a courier collection and
// moving the status forward. Status lives in one shared row, so any change by any
// user is reflected for everyone with access.

const { query, queryOne } = require('./db');

// Status lifecycle (extensible). 'pending' = warehouse notified, action required.
const RETURN_STATUSES = ['pending', 'booked', 'collected', 'completed', 'cancelled'];

// ── Email notification ──────────────────────────────────────────────────────
// Sends the return details to warehouse staff. Until an email transport +
// recipients are configured (RETURNS_NOTIFY_EMAILS + SMTP/API creds), this logs
// the notification instead of sending, so the flow is fully functional in dev.
async function notifyWarehouseOfReturn(record) {
  const recipients = (process.env.RETURNS_NOTIFY_EMAILS || '')
    .split(',').map(s => s.trim()).filter(Boolean);

  const summary = [
    `New return request #${record.id}`,
    `Client: ${record.customer_name || record.client_id || '—'}`,
    `Reference: ${record.reference || '—'}`,
    `Raised by: ${record.created_by || '—'}`,
    `Details: ${JSON.stringify(record.form_data)}`,
  ].join('\n');

  // TODO: plug in real transport (nodemailer SMTP or transactional API) once
  // recipients + credentials are provided.
  if (!recipients.length || !process.env.SMTP_HOST) {
    console.log(`[returns] (email not configured) would notify warehouse:\n${summary}`);
    return;
  }
  console.log(`[returns] notifying ${recipients.join(', ')} of return #${record.id}`);
  // Real send goes here.
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
  setImmediate(() => notifyWarehouseOfReturn(row).catch(e => console.error('[returns] notify error:', e.message)));

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
