// ─── server/quotations.js ─────────────────────────────────────────────────────
// Shipping quote creation and retrieval with 20% client surcharge.
// Schema lives in schema.js — ensureSchema() here is a no-op kept for compat.

const { query, queryOne } = require('./db');

async function ensureSchema() {
  // Tables are created by schema.js — nothing to do here.
}

function toShape(r, isWarehouse) {
  const q = {
    id:          r.id,
    reference:   r.reference,
    createdBy:   r.created_by,
    isClient:    r.is_client,
    country:     r.country,
    zone:        r.zone,
    lengthCm:    parseFloat(r.length_cm),
    widthCm:     parseFloat(r.width_cm),
    depthCm:     parseFloat(r.depth_cm),
    weightG:     r.weight_g,
    quantity:    r.quantity,
    carrier:     r.carrier,
    formatName:  r.format_name,
    service:     r.service,
    clientRate:  r.client_rate  != null ? parseFloat(r.client_rate)  : null,
    totalClient: r.total_client != null ? parseFloat(r.total_client) : null,
    createdAt:   r.created_at,
  };
  if (isWarehouse) {
    q.baseRate     = r.base_rate  != null ? parseFloat(r.base_rate)  : null;
    q.totalBase    = r.total_base != null ? parseFloat(r.total_base) : null;
    q.surchargePct = parseFloat(r.surcharge_pct);
  }
  return q;
}

function round2(n) { return Math.round(n * 100) / 100; }

async function createQuote(warehouseId, session, body) {
  const {
    lengthCm, widthCm, depthCm, weightG,
    country, zone, quantity,
    carrier, formatName, service, baseRate,
  } = body;

  const surchargeP  = 20;
  const clientRate  = baseRate != null ? round2(baseRate * 1.20) : null;
  const totalBase   = baseRate != null ? round2(baseRate * quantity) : null;
  const totalClient = clientRate != null ? round2(clientRate * quantity) : null;

  const row = await queryOne(
    `INSERT INTO quotes
       (warehouse_id, client_name, client_email, status,
        line_items, total_monthly, total_setup,
        notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      warehouseId || null,
      session.username,
      null,
      'draft',
      JSON.stringify([{
        carrier: carrier || 'royal_mail',
        formatName: formatName || null,
        service: service || null,
        lengthCm, widthCm, depthCm, weightG,
        country, zone, quantity,
        baseRate: baseRate || null,
        surchargeP,
        clientRate,
        totalBase,
        totalClient,
      }]),
      totalClient,
      null,
      null,
    ]
  );

  return {
    id:          row.id,
    reference:   `Q-${new Date().getFullYear()}-${String(row.id).padStart(4, '0')}`,
    createdBy:   session.username,
    isClient:    !session.isWarehouse,
    country, zone,
    lengthCm:    parseFloat(lengthCm),
    widthCm:     parseFloat(widthCm),
    depthCm:     parseFloat(depthCm),
    weightG:     parseInt(weightG),
    quantity:    parseInt(quantity),
    carrier:     carrier || 'royal_mail',
    formatName:  formatName || null,
    service:     service || null,
    clientRate,
    totalClient,
    createdAt:   row.created_at,
    ...(session.isWarehouse ? {
      baseRate:     baseRate || null,
      totalBase,
      surchargePct: surchargeP,
    } : {}),
  };
}

async function listQuotes(warehouseId, session) {
  const conditions = [];
  const p = [];
  if (warehouseId) conditions.push(`warehouse_id = $${p.push(warehouseId)}`);
  if (!session.isWarehouse) conditions.push(`client_name = $${p.push(session.username)}`);

  const sql = `SELECT * FROM quotes
    ${conditions.length ? 'WHERE ' + conditions.join(' AND ') : ''}
    ORDER BY created_at DESC`;
  const rows = await query(sql, p);

  return rows.map(r => {
    const items = Array.isArray(r.line_items) ? r.line_items : (r.line_items || []);
    const item  = items[0] || {};
    return {
      id:          r.id,
      reference:   `Q-${new Date(r.created_at).getFullYear()}-${String(r.id).padStart(4, '0')}`,
      createdBy:   r.client_name,
      country:     item.country,
      zone:        item.zone,
      lengthCm:    parseFloat(item.lengthCm) || 0,
      widthCm:     parseFloat(item.widthCm)  || 0,
      depthCm:     parseFloat(item.depthCm)  || 0,
      weightG:     parseInt(item.weightG)    || 0,
      quantity:    parseInt(item.quantity)   || 1,
      carrier:     item.carrier,
      formatName:  item.formatName,
      service:     item.service,
      clientRate:  item.clientRate,
      totalClient: item.totalClient,
      createdAt:   r.created_at,
      ...(session.isWarehouse ? {
        baseRate:     item.baseRate,
        totalBase:    item.totalBase,
        surchargePct: item.surchargeP || 20,
      } : {}),
    };
  });
}

async function handle(req, res, url, session, method) {
  const warehouseId = session.warehouses?.[0]?.ID
    ? parseInt(session.warehouses[0].ID) : null;

  if (method === 'GET') {
    const quotes = await listQuotes(warehouseId, session);
    return res.json(200, { quotes });
  }

  if (method === 'POST') {
    const body  = await req.json();
    const quote = await createQuote(warehouseId, session, body);
    return res.json(201, quote);
  }

  return res.json(405, { error: 'Method not allowed' });
}

module.exports = { ensureSchema, handle };
