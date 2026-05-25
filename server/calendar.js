// ─── server/calendar.js ───────────────────────────────────────────────────────
// Calendar events: custom events (with client sharing) + GoodsIn + order volume.

const { query, queryOne } = require('./db');

// ── Schema bootstrap ──────────────────────────────────────────────────────────

async function ensureSchema() {
  // Core events table
  await query(`
    CREATE TABLE IF NOT EXISTS calendar_events (
      id           SERIAL PRIMARY KEY,
      account_id   INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      title        TEXT    NOT NULL,
      description  TEXT,
      event_type   TEXT    NOT NULL DEFAULT 'meeting',
      event_date   DATE    NOT NULL,
      event_time   TIME,
      end_date     DATE,
      end_time     TIME,
      color        TEXT    NOT NULL DEFAULT 'blue',
      all_day      BOOLEAN NOT NULL DEFAULT true,
      created_by   TEXT,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await query(`
    CREATE INDEX IF NOT EXISTS calendar_events_account_date_idx
    ON calendar_events (account_id, event_date)
  `);

  // Which clients a warehouse event is shared with
  await query(`
    CREATE TABLE IF NOT EXISTS calendar_event_shares (
      event_id  INTEGER NOT NULL REFERENCES calendar_events(id) ON DELETE CASCADE,
      client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      PRIMARY KEY (event_id, client_id)
    )
  `);

  // Synced GoodsIn / ASN records from Mintsoft
  await query(`
    CREATE TABLE IF NOT EXISTS goods_in_records (
      id             SERIAL PRIMARY KEY,
      account_id     INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      warehouse_id   INTEGER NOT NULL REFERENCES warehouses(id),
      client_id      INTEGER REFERENCES clients(id),
      mintsoft_id    INTEGER NOT NULL,
      reference      TEXT,
      status         TEXT,
      expected_date  DATE,
      received_date  DATE,
      total_items    INTEGER NOT NULL DEFAULT 0,
      notes          TEXT,
      synced_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (account_id, mintsoft_id)
    )
  `);
  await query(`
    CREATE INDEX IF NOT EXISTS goods_in_account_date_idx
    ON goods_in_records (account_id, COALESCE(expected_date, received_date))
  `);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function pad(n) { return String(n).padStart(2, '0'); }

function fmtDate(val) {
  if (!val) return null;
  if (val instanceof Date) return `${val.getFullYear()}-${pad(val.getMonth()+1)}-${pad(val.getDate())}`;
  return String(val).split('T')[0];
}

function toEventShape(r) {
  return {
    id:          r.id,
    title:       r.title,
    description: r.description || '',
    type:        r.event_type,
    date:        fmtDate(r.event_date),
    time:        r.event_time || null,
    endDate:     fmtDate(r.end_date),
    endTime:     r.end_time || null,
    color:       r.color,
    allDay:      r.all_day,
    createdBy:   r.created_by || null,
    isShared:    r.is_shared  || false,
  };
}

// ── Custom events CRUD ────────────────────────────────────────────────────────

// List own events, plus (for client users) warehouse events shared with them.
async function listEvents(accountId, from, to, clientMsId) {
  const ownRows = await query(
    `SELECT *, false AS is_shared FROM calendar_events
     WHERE account_id = $1
       AND event_date >= $2
       AND event_date <= $3
     ORDER BY event_date, event_time NULLS LAST`,
    [accountId, from, to]
  );

  if (!clientMsId) return ownRows.map(toEventShape);

  // Warehouse events shared with this client (any warehouse account)
  const sharedRows = await query(
    `SELECT ce.*, true AS is_shared
     FROM calendar_events ce
     JOIN calendar_event_shares ces ON ces.event_id = ce.id
     JOIN clients c ON c.id = ces.client_id AND c.mintsoft_id = $1
     WHERE ce.event_date >= $2
       AND ce.event_date <= $3
     ORDER BY ce.event_date, ce.event_time NULLS LAST`,
    [parseInt(clientMsId), from, to]
  );

  const seen   = new Set(ownRows.map(r => r.id));
  const merged = [...ownRows, ...sharedRows.filter(r => !seen.has(r.id))];
  return merged.sort((a, b) => {
    const d = fmtDate(a.event_date).localeCompare(fmtDate(b.event_date));
    return d !== 0 ? d : (a.event_time || '').localeCompare(b.event_time || '');
  }).map(toEventShape);
}

async function createEvent(accountId, username, body) {
  const { title, description, type, date, time, endDate, endTime, color, allDay, sharedClientIds } = body;
  if (!title?.trim()) throw new Error('title is required');
  if (!date)          throw new Error('date is required');

  const row = await queryOne(
    `INSERT INTO calendar_events
       (account_id, title, description, event_type, event_date, event_time,
        end_date, end_time, color, all_day, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     RETURNING *`,
    [
      accountId,
      title.trim(),
      description?.trim() || null,
      type || 'meeting',
      date,
      time || null,
      endDate || null,
      endTime || null,
      color || 'blue',
      allDay !== false,
      username,
    ]
  );

  // Share with selected clients (warehouse events only)
  const confirmedShared = [];
  if (Array.isArray(sharedClientIds) && sharedClientIds.length > 0) {
    for (const msId of sharedClientIds) {
      const client = await queryOne(
        `SELECT id FROM clients WHERE account_id = $1 AND mintsoft_id = $2`,
        [accountId, parseInt(msId)]
      );
      if (client) {
        await query(
          `INSERT INTO calendar_event_shares (event_id, client_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [row.id, client.id]
        );
        confirmedShared.push(parseInt(msId));
      }
    }
  }

  return { ...toEventShape(row), sharedClientIds: confirmedShared };
}

async function deleteEvent(accountId, eventId) {
  const row = await queryOne(
    `DELETE FROM calendar_events WHERE id = $1 AND account_id = $2 RETURNING id`,
    [eventId, accountId]
  );
  if (!row) throw new Error('Event not found');
  return { deleted: true };
}

async function updateEvent(accountId, eventId, body) {
  const { title, description, type, date, time, endDate, endTime, color, allDay } = body;
  const row = await queryOne(
    `UPDATE calendar_events SET
       title       = COALESCE($3, title),
       description = COALESCE($4, description),
       event_type  = COALESCE($5, event_type),
       event_date  = COALESCE($6, event_date),
       event_time  = COALESCE($7::time, event_time),
       end_date    = COALESCE($8, end_date),
       end_time    = COALESCE($9::time, end_time),
       color       = COALESCE($10, color),
       all_day     = COALESCE($11, all_day)
     WHERE id = $1 AND account_id = $2
     RETURNING *`,
    [
      eventId, accountId,
      title?.trim() || null,
      description?.trim() || null,
      type || null,
      date || null,
      time || null,
      endDate || null,
      endTime || null,
      color || null,
      allDay != null ? allDay : null,
    ]
  );
  if (!row) throw new Error('Event not found');
  return toEventShape(row);
}

// ── Auto-events from DB ───────────────────────────────────────────────────────

// High-volume despatch days (warehouse-only)
async function getOrderEvents(accountId, from, to) {
  const rows = await query(
    `SELECT
       o.despatch_date::date AS date,
       COUNT(*) AS order_count,
       COUNT(DISTINCT o.client_id) AS client_count
     FROM orders o
     WHERE o.account_id = $1
       AND o.despatch_date::date >= $2
       AND o.despatch_date::date <= $3
     GROUP BY o.despatch_date::date
     HAVING COUNT(*) >= 5
     ORDER BY o.despatch_date::date`,
    [accountId, from, to]
  );
  return rows.map(r => ({
    id:          `order-${r.date}`,
    title:       `${r.order_count} orders despatched`,
    description: `${r.client_count} client(s)`,
    type:        'orders',
    date:        String(r.date).split('T')[0],
    time:        null,
    endDate:     null,
    endTime:     null,
    color:       'indigo',
    allDay:      true,
    createdBy:   null,
    auto:        true,
  }));
}

// GoodsIn events from synced goods_in_records table.
// For warehouse users (clientMsId=null): all records.
// For client users: only their own records (resolved from warehouseAccountId).
async function getGoodsInEvents(accountId, from, to, clientMsId) {
  let rows;

  // Filter on expected_date (EstimatedDelivery) as the canonical calendar date.
  // Fall back to received_date only when expected_date is absent.
  if (clientMsId) {
    rows = await query(
      `SELECT g.*, c.name AS client_name
       FROM goods_in_records g
       JOIN clients c ON c.id = g.client_id AND c.mintsoft_id = $2
       WHERE g.account_id = $1
         AND COALESCE(g.expected_date, g.received_date) >= $3
         AND COALESCE(g.expected_date, g.received_date) <= $4
       ORDER BY COALESCE(g.expected_date, g.received_date)`,
      [accountId, parseInt(clientMsId), from, to]
    );
  } else {
    rows = await query(
      `SELECT g.*, c.name AS client_name
       FROM goods_in_records g
       LEFT JOIN clients c ON c.id = g.client_id
       WHERE g.account_id = $1
         AND COALESCE(g.expected_date, g.received_date) >= $2
         AND COALESCE(g.expected_date, g.received_date) <= $3
       ORDER BY COALESCE(g.expected_date, g.received_date)`,
      [accountId, from, to]
    );
  }

  return rows.map(r => {
    const date    = fmtDate(r.expected_date) || fmtDate(r.received_date);
    const endDate = (r.received_date && r.expected_date && fmtDate(r.expected_date) !== fmtDate(r.received_date))
      ? fmtDate(r.received_date) : null;

    const parts = [
      r.status      ? `Status: ${r.status}`   : null,
      r.total_items ? `${r.total_items} items` : null,
      r.notes       || null,
    ].filter(Boolean);

    return {
      id:          `goodsin-${r.id}`,
      title:       `Goods In — ${r.client_name || 'Unknown'}${r.reference ? ` (${r.reference})` : ''}`,
      description: parts.join(' · '),
      type:        'asn',
      date,
      endDate,
      time:        null,
      endTime:     null,
      color:       'green',
      allDay:      true,
      createdBy:   null,
      auto:        true,
    };
  });
}

// ── Route handler ─────────────────────────────────────────────────────────────

async function handle(req, res, url, session, method, eventId) {
  const { getAccountId } = require('./sync');
  const accountId = await getAccountId(session.username);
  if (!accountId) return res.json(400, { error: 'Account not found — log in again' });

  if (method === 'GET') {
    const from = url.searchParams.get('from') || new Date().toISOString().split('T')[0];
    const to   = url.searchParams.get('to')   || from;

    // Client users: find which warehouse account holds their GoodsIn data
    const clientMsId       = session.isWarehouse ? null : (session.clientId ? String(session.clientId) : null);
    let goodsInAccountId   = accountId;

    if (clientMsId) {
      const whAcc = await queryOne(
        `SELECT a.id FROM accounts a
         JOIN clients c ON c.account_id = a.id AND c.mintsoft_id = $1
         WHERE a.is_warehouse = true AND a.last_sync_at IS NOT NULL
         LIMIT 1`,
        [parseInt(clientMsId)]
      );
      if (whAcc) goodsInAccountId = whAcc.id;
    }

    const [custom, orders, goodsIn] = await Promise.all([
      listEvents(accountId, from, to, clientMsId),
      session.isWarehouse ? getOrderEvents(accountId, from, to) : [],
      getGoodsInEvents(goodsInAccountId, from, to, clientMsId),
    ]);

    return res.json(200, { events: [...custom, ...orders, ...goodsIn] });
  }

  if (method === 'POST') {
    const body  = await req.json();
    const event = await createEvent(accountId, session.username, body);
    return res.json(201, event);
  }

  if (method === 'PUT' && eventId) {
    const body  = await req.json();
    const event = await updateEvent(accountId, parseInt(eventId), body);
    return res.json(200, event);
  }

  if (method === 'DELETE' && eventId) {
    const result = await deleteEvent(accountId, parseInt(eventId));
    return res.json(200, result);
  }

  return res.json(405, { error: 'Method not allowed' });
}

module.exports = { ensureSchema, handle };
