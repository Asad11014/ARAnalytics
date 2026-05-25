-- PF Analytics — PostgreSQL schema
-- One account = one Mintsoft tenant (a warehouse company).
-- All data is scoped by account_id so multiple warehouse companies can share one DB.

-- ─── Tenants ───────────────────────────────────────────────────────────────────

CREATE TABLE accounts (
  id           SERIAL PRIMARY KEY,
  username     TEXT        NOT NULL UNIQUE,
  api_key      TEXT        NOT NULL,            -- Mintsoft session key (encrypt at rest in production)
  is_warehouse BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_sync_at TIMESTAMPTZ
);

-- ─── Reference data (synced once, refreshed on change) ─────────────────────────

CREATE TABLE warehouses (
  id           SERIAL  PRIMARY KEY,
  account_id   INTEGER NOT NULL REFERENCES accounts(id)   ON DELETE CASCADE,
  mintsoft_id  INTEGER NOT NULL,
  name         TEXT    NOT NULL,
  code         TEXT,
  UNIQUE (account_id, mintsoft_id)
);

CREATE TABLE clients (
  id           SERIAL  PRIMARY KEY,
  account_id   INTEGER NOT NULL REFERENCES accounts(id)   ON DELETE CASCADE,
  mintsoft_id  INTEGER NOT NULL,
  name         TEXT    NOT NULL,
  UNIQUE (account_id, mintsoft_id)
);

-- ─── Stock ─────────────────────────────────────────────────────────────────────
-- One row per (account, warehouse, client, sku). Fully replaced on each sync.

CREATE TABLE stock_levels (
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
);

-- ─── Orders ────────────────────────────────────────────────────────────────────

CREATE TABLE orders (
  id              SERIAL  PRIMARY KEY,
  account_id      INTEGER NOT NULL REFERENCES accounts(id)   ON DELETE CASCADE,
  warehouse_id    INTEGER NOT NULL REFERENCES warehouses(id),
  client_id       INTEGER          REFERENCES clients(id),   -- nullable: client user orders
  mintsoft_id     INTEGER NOT NULL,
  reference       TEXT,
  channel         TEXT,                                       -- sales channel (Shopify, eBay…)
  order_date      DATE,
  despatch_date   DATE,
  status          TEXT,
  courier_name    TEXT,
  tracking_number TEXT,
  UNIQUE (account_id, mintsoft_id)
);

CREATE TABLE order_items (
  id           SERIAL  PRIMARY KEY,
  order_id     INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  sku          TEXT    NOT NULL,
  product_name TEXT,
  quantity     INTEGER NOT NULL DEFAULT 0
);

-- ─── Financial ─────────────────────────────────────────────────────────────────
-- Confirmed monthly invoices — one per client per calendar month.

CREATE TABLE invoices (
  id                    SERIAL  PRIMARY KEY,
  account_id            INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  client_id             INTEGER NOT NULL REFERENCES clients(id),
  mintsoft_id           INTEGER NOT NULL,
  period_month          DATE    NOT NULL,   -- first day of billing month, e.g. 2026-04-01
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
);

-- Current-month running accruals (unconfirmed). Upserted on every sync.
CREATE TABLE invoice_accruals (
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
);

-- ─── Sync tracking ─────────────────────────────────────────────────────────────

CREATE TABLE sync_jobs (
  id             SERIAL  PRIMARY KEY,
  account_id     INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  entity         TEXT    NOT NULL,              -- 'stock' | 'orders' | 'invoices' | 'full'
  triggered_by   TEXT    NOT NULL DEFAULT 'cron', -- 'cron' | 'manual'
  status         TEXT    NOT NULL DEFAULT 'running', -- 'running' | 'success' | 'error'
  records_synced INTEGER NOT NULL DEFAULT 0,
  error          TEXT,
  started_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at   TIMESTAMPTZ
);

-- ─── Indexes ───────────────────────────────────────────────────────────────────

-- Orders: date-range and client-filtered report queries
CREATE INDEX ON orders (account_id, warehouse_id, despatch_date DESC);
CREATE INDEX ON orders (account_id, client_id,    despatch_date DESC);

-- Order items: SKU-level aggregation (best sellers, velocity, trend)
CREATE INDEX ON order_items (order_id);
CREATE INDEX ON order_items (sku);

-- Stock: dashboard and snapshot queries
CREATE INDEX ON stock_levels (account_id, warehouse_id, client_id);

-- Invoices: financial report queries
CREATE INDEX ON invoices (account_id, client_id, period_month DESC);

-- Sync job history
CREATE INDEX ON sync_jobs (account_id, started_at DESC);
