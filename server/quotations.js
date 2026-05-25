// ─── server/quotations.js ─────────────────────────────────────────────────────
// Quote creation and retrieval with 20% client surcharge.

const { query, queryOne } = require('./db');

async function ensureSchema() {
  await query(`
    CREATE TABLE IF NOT EXISTS quotes (
      id                   SERIAL PRIMARY KEY,
      warehouse_account_id INTEGER      NOT NULL REFERENCES accounts(id),
      reference            TEXT         UNIQUE,
      created_by           TEXT         NOT NULL,
      is_client            BOOLEAN      NOT NULL DEFAULT false,
      client_mintsoft_id   INTEGER,

      length_cm            NUMERIC(8,2) NOT NULL,
      width_cm             NUMERIC(8,2) NOT NULL,
      depth_cm             NUMERIC(8,2) NOT NULL,
      weight_g             INTEGER      NOT NULL,
      country              TEXT         NOT NULL,
      zone                 TEXT         NOT NULL,
      quantity             INTEGER      NOT NULL DEFAULT 1,

      carrier              TEXT         NOT NULL DEFAULT 'royal_mail',
      format_name          TEXT,
      service              TEXT,

      base_rate            NUMERIC(10,2),
      surcharge_pct        NUMERIC(5,2) NOT NULL DEFAULT 20,
      client_rate          NUMERIC(10,2),
      total_base           NUMERIC(10,2),
      total_client         NUMERIC(10,2),

      notes                TEXT,
      created_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    )
  `);
  await query(`
    CREATE INDEX IF NOT EXISTS quotes_warehouse_created_idx
    ON quotes (warehouse_account_id, created_at DESC)
  `);
}

// Return only the fields the caller is allowed to see.
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
  // Warehouse users also see the pre-surcharge figures
  if (isWarehouse) {
    q.baseRate    = r.base_rate   != null ? parseFloat(r.base_rate)   : null;
    q.totalBase   = r.total_base  != null ? parseFloat(r.total_base)  : null;
    q.surchargePct = parseFloat(r.surcharge_pct);
  }
  return q;
}

function round2(n) { return Math.round(n * 100) / 100; }

async function createQuote(warehouseAccountId, session, body) {
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
       (warehouse_account_id, created_by, is_client, client_mintsoft_id,
        length_cm, width_cm, depth_cm, weight_g, country, zone, quantity,
        carrier, format_name, service,
        base_rate, surcharge_pct, client_rate, total_base, total_client)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
     RETURNING *`,
    [
      warehouseAccountId,
      session.username,
      !session.isWarehouse,
      session.isWarehouse ? null : (session.clientId || null),
      lengthCm, widthCm, depthCm, weightG,
      country, zone, quantity,
      carrier || 'royal_mail',
      formatName || null,
      service    || null,
      baseRate   || null,
      surchargeP,
      clientRate,
      totalBase,
      totalClient,
    ]
  );

  // Human-readable reference: Q-YYYY-NNNN
  const ref = `Q-${new Date().getFullYear()}-${String(row.id).padStart(4, '0')}`;
  await query(`UPDATE quotes SET reference = $1 WHERE id = $2`, [ref, row.id]);
  row.reference = ref;

  return toShape(row, session.isWarehouse);
}

async function listQuotes(warehouseAccountId, session) {
  let rows;
  if (session.isWarehouse) {
    rows = await query(
      `SELECT * FROM quotes WHERE warehouse_account_id = $1 ORDER BY created_at DESC`,
      [warehouseAccountId]
    );
  } else {
    rows = await query(
      `SELECT * FROM quotes WHERE warehouse_account_id = $1 AND created_by = $2 ORDER BY created_at DESC`,
      [warehouseAccountId, session.username]
    );
  }
  return rows.map(r => toShape(r, session.isWarehouse));
}

async function resolveWarehouseAccount(session) {
  const { getAccountId } = require('./sync');
  if (session.isWarehouse) return getAccountId(session.username);

  const msId = session.clientId ? parseInt(session.clientId) : null;
  if (!msId) throw new Error('Client ID not found in session');

  const whAcc = await queryOne(
    `SELECT a.id FROM accounts a
     JOIN clients c ON c.account_id = a.id AND c.mintsoft_id = $1
     WHERE a.is_warehouse = true AND a.last_sync_at IS NOT NULL
     LIMIT 1`,
    [msId]
  );
  if (!whAcc) throw new Error('Warehouse account not found');
  return whAcc.id;
}

async function handle(req, res, url, session, method) {
  const warehouseAccountId = await resolveWarehouseAccount(session);

  if (method === 'GET') {
    const quotes = await listQuotes(warehouseAccountId, session);
    return res.json(200, { quotes });
  }

  if (method === 'POST') {
    const body  = await req.json();
    const quote = await createQuote(warehouseAccountId, session, body);
    return res.json(201, quote);
  }

  return res.json(405, { error: 'Method not allowed' });
}

module.exports = { ensureSchema, handle };
