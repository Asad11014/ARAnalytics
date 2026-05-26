// ─── server/schema.js ─────────────────────────────────────────────────────────
// Creates all core tables on startup (idempotent — safe to run on every boot).
// Must run before calendar.ensureSchema() and quotations.ensureSchema()
// since those tables have foreign keys into accounts/clients/warehouses.

const { query } = require('./db');

async function ensureCoreSchema() {
  // ── Tenants ──────────────────────────────────────────────────────────────────
  await query(`
    CREATE TABLE IF NOT EXISTS accounts (
      id           SERIAL PRIMARY KEY,
      username     TEXT        NOT NULL UNIQUE,
      api_key      TEXT        NOT NULL,
      is_warehouse BOOLEAN     NOT NULL DEFAULT TRUE,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_sync_at TIMESTAMPTZ
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS warehouses (
      id           SERIAL  PRIMARY KEY,
      account_id   INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      mintsoft_id  INTEGER NOT NULL,
      name         TEXT    NOT NULL,
      code         TEXT,
      UNIQUE (account_id, mintsoft_id)
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS clients (
      id           SERIAL  PRIMARY KEY,
      account_id   INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      mintsoft_id  INTEGER NOT NULL,
      name         TEXT    NOT NULL,
      UNIQUE (account_id, mintsoft_id)
    )
  `);

  // ── Stock ─────────────────────────────────────────────────────────────────────
  await query(`
    CREATE TABLE IF NOT EXISTS stock_levels (
      id             SERIAL  PRIMARY KEY,
      account_id     INTEGER NOT NULL REFERENCES accounts(id)   ON DELETE CASCADE,
      warehouse_id   INTEGER NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
      client_id      INTEGER NOT NULL REFERENCES clients(id)    ON DELETE CASCADE,
      sku            TEXT    NOT NULL,
      product_name   TEXT,
      qty_on_hand    INTEGER NOT NULL DEFAULT 0,
      qty_allocated  INTEGER NOT NULL DEFAULT 0,
      qty_available  INTEGER NOT NULL DEFAULT 0,
      updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (account_id, warehouse_id, client_id, sku)
    )
  `);

  // ── Orders ────────────────────────────────────────────────────────────────────
  await query(`
    CREATE TABLE IF NOT EXISTS orders (
      id              SERIAL  PRIMARY KEY,
      account_id      INTEGER NOT NULL REFERENCES accounts(id)   ON DELETE CASCADE,
      warehouse_id    INTEGER NOT NULL REFERENCES warehouses(id),
      client_id       INTEGER          REFERENCES clients(id),
      mintsoft_id     INTEGER NOT NULL,
      reference       TEXT,
      channel         TEXT,
      order_date      DATE,
      despatch_date   DATE,
      status          TEXT,
      courier_name    TEXT,
      tracking_number TEXT,
      UNIQUE (account_id, mintsoft_id)
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS order_items (
      id           SERIAL  PRIMARY KEY,
      order_id     INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      sku          TEXT    NOT NULL,
      product_name TEXT,
      quantity     INTEGER NOT NULL DEFAULT 0
    )
  `);

  // ── Financial ─────────────────────────────────────────────────────────────────
  await query(`
    CREATE TABLE IF NOT EXISTS invoices (
      id                    SERIAL  PRIMARY KEY,
      account_id            INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      client_id             INTEGER NOT NULL REFERENCES clients(id),
      mintsoft_id           INTEGER NOT NULL,
      period_month          DATE    NOT NULL,
      picking_cost          NUMERIC(12,2) NOT NULL DEFAULT 0,
      postage_cost          NUMERIC(12,2) NOT NULL DEFAULT 0,
      vat_free_postage_cost NUMERIC(12,2) NOT NULL DEFAULT 0,
      storage_cost          NUMERIC(12,2) NOT NULL DEFAULT 0,
      goods_in_cost         NUMERIC(12,2) NOT NULL DEFAULT 0,
      returns_cost          NUMERIC(12,2) NOT NULL DEFAULT 0,
      rework_cost           NUMERIC(12,2) NOT NULL DEFAULT 0,
      packaging_cost        NUMERIC(12,2) NOT NULL DEFAULT 0,
      generic_items_cost    NUMERIC(12,2) NOT NULL DEFAULT 0,
      collections_cost      NUMERIC(12,2) NOT NULL DEFAULT 0,
      admin_fee             NUMERIC(12,2) NOT NULL DEFAULT 0,
      number_of_parcels     INTEGER NOT NULL DEFAULT 0,
      number_of_items       INTEGER NOT NULL DEFAULT 0,
      synced_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (account_id, mintsoft_id),
      UNIQUE (account_id, client_id, period_month)
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS invoice_accruals (
      account_id            INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      client_id             INTEGER NOT NULL REFERENCES clients(id),
      period_month          DATE    NOT NULL,
      picking_cost          NUMERIC(12,2) NOT NULL DEFAULT 0,
      postage_cost          NUMERIC(12,2) NOT NULL DEFAULT 0,
      vat_free_postage_cost NUMERIC(12,2) NOT NULL DEFAULT 0,
      storage_cost          NUMERIC(12,2) NOT NULL DEFAULT 0,
      goods_in_cost         NUMERIC(12,2) NOT NULL DEFAULT 0,
      returns_cost          NUMERIC(12,2) NOT NULL DEFAULT 0,
      rework_cost           NUMERIC(12,2) NOT NULL DEFAULT 0,
      packaging_cost        NUMERIC(12,2) NOT NULL DEFAULT 0,
      generic_items_cost    NUMERIC(12,2) NOT NULL DEFAULT 0,
      collections_cost      NUMERIC(12,2) NOT NULL DEFAULT 0,
      admin_fee             NUMERIC(12,2) NOT NULL DEFAULT 0,
      number_of_parcels     INTEGER NOT NULL DEFAULT 0,
      number_of_items       INTEGER NOT NULL DEFAULT 0,
      updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (account_id, client_id, period_month)
    )
  `);

  // ── Sync tracking ─────────────────────────────────────────────────────────────
  await query(`
    CREATE TABLE IF NOT EXISTS sync_jobs (
      id             SERIAL  PRIMARY KEY,
      account_id     INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      entity         TEXT    NOT NULL,
      triggered_by   TEXT    NOT NULL DEFAULT 'cron',
      status         TEXT    NOT NULL DEFAULT 'running',
      records_synced INTEGER NOT NULL DEFAULT 0,
      current_step   TEXT,
      error          TEXT,
      started_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at   TIMESTAMPTZ
    )
  `);
  await query(`ALTER TABLE sync_jobs ADD COLUMN IF NOT EXISTS current_step TEXT`);

  // ── Indexes (IF NOT EXISTS requires Postgres 9.5+, safe to re-run) ────────────
  await query(`CREATE INDEX IF NOT EXISTS orders_account_wh_date_idx     ON orders (account_id, warehouse_id, despatch_date DESC)`);
  await query(`CREATE INDEX IF NOT EXISTS orders_account_client_date_idx  ON orders (account_id, client_id,    despatch_date DESC)`);
  await query(`CREATE INDEX IF NOT EXISTS orders_account_wh_odate_idx     ON orders (account_id, warehouse_id, order_date DESC)`);
  await query(`CREATE INDEX IF NOT EXISTS orders_account_client_odate_idx ON orders (account_id, client_id,    order_date DESC)`);
  await query(`CREATE INDEX IF NOT EXISTS order_items_order_idx         ON order_items (order_id)`);
  await query(`CREATE INDEX IF NOT EXISTS order_items_sku_idx           ON order_items (sku)`);
  await query(`CREATE INDEX IF NOT EXISTS stock_levels_account_idx      ON stock_levels(account_id, warehouse_id, client_id)`);
  await query(`CREATE INDEX IF NOT EXISTS invoices_account_client_idx   ON invoices    (account_id, client_id, period_month DESC)`);
  await query(`CREATE INDEX IF NOT EXISTS sync_jobs_account_idx         ON sync_jobs   (account_id, started_at DESC)`);
}

module.exports = { ensureCoreSchema };
