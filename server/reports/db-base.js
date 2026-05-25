// ─── server/reports/db-base.js ────────────────────────────────────────────────
// DB-backed equivalents of the Mintsoft API fetchers in base.js.
// All functions return Mintsoft-shaped objects so computation functions in
// each report can run unchanged.

const { query, queryOne } = require('../db');

// ── ID resolution ─────────────────────────────────────────────────────────────

// Convert Mintsoft warehouse/client IDs (from URL params) to DB surrogate IDs.
// For warehouse users: use their own account.
// For client users: prefer a warehouse account that holds their data, falling back
// to their own account. This handles the common case where the warehouse synced all
// client data and the client's own sync didn't fully populate their account.
async function resolveIds(session, msWarehouseId, msClientId) {
  const ownAcc = await queryOne(`SELECT id FROM accounts WHERE username = $1`, [session.username]);
  if (!ownAcc) throw new Error('Account not synced yet — log in again to trigger the initial sync');

  // Warehouse users always use their own account
  if (session.isWarehouse) {
    const accountId = ownAcc.id;
    let warehouseId = null;
    if (msWarehouseId) {
      const wh = await queryOne(
        `SELECT id FROM warehouses WHERE account_id = $1 AND mintsoft_id = $2`,
        [accountId, parseInt(msWarehouseId)]
      );
      warehouseId = wh?.id ?? null;
    }
    let clientId = null;
    if (msClientId) {
      const cl = await queryOne(
        `SELECT id FROM clients WHERE account_id = $1 AND mintsoft_id = $2`,
        [accountId, parseInt(msClientId)]
      );
      clientId = cl?.id ?? null;
    }
    return { accountId, warehouseId, clientId };
  }

  // Client users: prefer a warehouse account that has synced their data (the canonical source).
  // Fall back to the client's own account only if no warehouse account covers them.
  const effectiveMsClientId = msClientId || session.clientId;

  if (effectiveMsClientId && msWarehouseId) {
    const warehouseAccount = await queryOne(
      `SELECT a.id AS account_id, w.id AS warehouse_id, c.id AS client_id
       FROM accounts a
       JOIN warehouses w ON w.account_id = a.id AND w.mintsoft_id = $1
       JOIN clients   c ON c.account_id = a.id AND c.mintsoft_id = $2
       WHERE a.is_warehouse = true AND a.last_sync_at IS NOT NULL
       LIMIT 1`,
      [parseInt(msWarehouseId), parseInt(effectiveMsClientId)]
    );
    if (warehouseAccount) {
      return {
        accountId:   warehouseAccount.account_id,
        warehouseId: warehouseAccount.warehouse_id,
        clientId:    warehouseAccount.client_id,
      };
    }
  }

  // Fallback: use the client's own account
  const accountId = ownAcc.id;
  let warehouseId = null;
  if (msWarehouseId) {
    const wh = await queryOne(
      `SELECT id FROM warehouses WHERE account_id = $1 AND mintsoft_id = $2`,
      [accountId, parseInt(msWarehouseId)]
    );
    warehouseId = wh?.id ?? null;
  }
  let clientId = null;
  if (effectiveMsClientId) {
    const cl = await queryOne(
      `SELECT id FROM clients WHERE account_id = $1 AND mintsoft_id = $2`,
      [accountId, parseInt(effectiveMsClientId)]
    );
    clientId = cl?.id ?? null;
  }
  return { accountId, warehouseId, clientId };
}

// For client users whose clientId may be null in session — find the single client record for their account.
// Also checks warehouse accounts that may hold their data.
async function getClientIdForAccount(accountId) {
  const row = await queryOne(
    `SELECT id FROM clients WHERE account_id = $1 ORDER BY id LIMIT 1`,
    [accountId]
  );
  return row?.id ?? null;
}

// ── Stock ─────────────────────────────────────────────────────────────────────

// Returns Mintsoft-shaped stock: [{ SKU, Level, ProductName, ClientId(mintsoft) }]
async function getStock(accountId, warehouseId, clientId) {
  let sql = `
    SELECT sl.sku AS "SKU", sl.qty_on_hand AS "Level",
           sl.product_name AS "ProductName", c.mintsoft_id AS "ClientId"
    FROM stock_levels sl
    JOIN clients c ON sl.client_id = c.id
    WHERE sl.account_id = $1`;
  const p = [accountId];
  if (warehouseId) sql += ` AND sl.warehouse_id = $${p.push(warehouseId)}`;
  if (clientId)    sql += ` AND sl.client_id = $${p.push(clientId)}`;
  return query(sql, p);
}

// ── Orders ────────────────────────────────────────────────────────────────────

// Returns orders with nested items:
// [{ OrderId, OrderDate, DespatchDate, ClientId(mintsoft), OrderItems: [{ SKU, Quantity }] }]
async function getOrders(accountId, warehouseId, clientId, fromDate, toDate) {
  let sql = `
    SELECT o.mintsoft_id AS "OrderId",
           o.order_date::text    AS "OrderDate",
           o.despatch_date::text AS "DespatchDate",
           c.mintsoft_id AS "ClientId",
           COALESCE(json_agg(json_build_object('SKU', oi.sku, 'Quantity', oi.quantity))
             FILTER (WHERE oi.id IS NOT NULL), '[]') AS "OrderItems"
    FROM orders o
    LEFT JOIN clients c ON o.client_id = c.id
    LEFT JOIN order_items oi ON oi.order_id = o.id
    WHERE o.account_id = $1`;
  const p = [accountId];
  if (warehouseId) sql += ` AND o.warehouse_id = $${p.push(warehouseId)}`;
  if (clientId)    sql += ` AND o.client_id = $${p.push(clientId)}`;
  if (fromDate)    sql += ` AND o.despatch_date >= $${p.push(fromDate)}`;
  if (toDate)      sql += ` AND o.despatch_date <= $${p.push(toDate)}`;
  sql += ` GROUP BY o.id, c.mintsoft_id ORDER BY o.despatch_date DESC NULLS LAST`;
  return query(sql, p);
}

// Returns order headers only (no items) — fast path for counts and date aggregations.
// [{ OrderId, OrderDate, DespatchDate, ClientId(mintsoft) }]
async function getOrderHeaders(accountId, warehouseId, clientId, fromDate, toDate) {
  let sql = `
    SELECT o.mintsoft_id AS "OrderId",
           o.order_date::text    AS "OrderDate",
           o.despatch_date::text AS "DespatchDate",
           c.mintsoft_id AS "ClientId"
    FROM orders o
    LEFT JOIN clients c ON o.client_id = c.id
    WHERE o.account_id = $1`;
  const p = [accountId];
  if (warehouseId) sql += ` AND o.warehouse_id = $${p.push(warehouseId)}`;
  if (clientId)    sql += ` AND o.client_id = $${p.push(clientId)}`;
  if (fromDate)    sql += ` AND o.despatch_date >= $${p.push(fromDate)}`;
  if (toDate)      sql += ` AND o.despatch_date <= $${p.push(toDate)}`;
  sql += ` ORDER BY o.despatch_date DESC NULLS LAST`;
  return query(sql, p);
}

// ── SKU names ─────────────────────────────────────────────────────────────────

// Returns { sku: name } from stock_levels (product names are persisted during sync).
async function getSkuNames(accountId, warehouseId, clientId) {
  let sql = `
    SELECT DISTINCT ON (sl.sku) sl.sku, sl.product_name
    FROM stock_levels sl
    WHERE sl.account_id = $1 AND sl.product_name IS NOT NULL`;
  const p = [accountId];
  if (warehouseId) sql += ` AND sl.warehouse_id = $${p.push(warehouseId)}`;
  if (clientId)    sql += ` AND sl.client_id = $${p.push(clientId)}`;
  sql += ` ORDER BY sl.sku`;
  const rows = await query(sql, p);
  const map = {};
  for (const r of rows) if (r.product_name) map[r.sku] = r.product_name;
  return map;
}

// ── Invoices / accruals ───────────────────────────────────────────────────────

function toInvShape(r) {
  return {
    ClientId:                r.ClientId,
    PickingCost:             parseFloat(r.picking_cost           || 0),
    PostageCost:             parseFloat(r.postage_cost           || 0),
    VatFreePostageCost:      parseFloat(r.vat_free_postage_cost  || 0),
    StorageCost:             parseFloat(r.storage_cost           || 0),
    GoodsInCost:             parseFloat(r.goods_in_cost          || 0),
    ReturnsCost:             parseFloat(r.returns_cost           || 0),
    ReworkCost:              parseFloat(r.rework_cost            || 0),
    PackagingCost:           parseFloat(r.packaging_cost         || 0),
    GenericInvoiceItemsCost: parseFloat(r.generic_items_cost     || 0),
    CollectionsCost:         parseFloat(r.collections_cost       || 0),
    AdminFee:                parseFloat(r.admin_fee              || 0),
  };
}

function periodMonthStr(dateStr) {
  return dateStr.substring(0, 7) + '-01';
}

function isCurrentOrFutureMonth(dateStr) {
  const today = new Date();
  const todayPM = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`;
  return periodMonthStr(dateStr) >= todayPM;
}

// Single client invoice for a given month — SUMs across multiple Mintsoft invoices for the same month.
// Uses invoice_accruals for the current month, invoices table for past months.
async function getInvoiceForClient(accountId, dbClientId, fromDate) {
  const pm = periodMonthStr(fromDate);

  if (isCurrentOrFutureMonth(fromDate)) {
    const row = await queryOne(
      `SELECT ia.*, c.mintsoft_id AS "ClientId"
       FROM invoice_accruals ia JOIN clients c ON ia.client_id = c.id
       WHERE ia.account_id = $1 AND ia.client_id = $2 AND ia.period_month = $3`,
      [accountId, dbClientId, pm]
    );
    return row ? toInvShape(row) : null;
  }

  // SUM in case Mintsoft issued multiple invoices for the same month
  const row = await queryOne(
    `SELECT
       c.mintsoft_id AS "ClientId",
       SUM(picking_cost)          AS picking_cost,
       SUM(postage_cost)          AS postage_cost,
       SUM(vat_free_postage_cost) AS vat_free_postage_cost,
       SUM(storage_cost)          AS storage_cost,
       SUM(goods_in_cost)         AS goods_in_cost,
       SUM(returns_cost)          AS returns_cost,
       SUM(rework_cost)           AS rework_cost,
       SUM(packaging_cost)        AS packaging_cost,
       SUM(generic_items_cost)    AS generic_items_cost,
       SUM(collections_cost)      AS collections_cost,
       SUM(admin_fee)             AS admin_fee
     FROM invoices i JOIN clients c ON i.client_id = c.id
     WHERE i.account_id = $1 AND i.client_id = $2 AND i.period_month = $3
     GROUP BY c.mintsoft_id`,
    [accountId, dbClientId, pm]
  );
  return row ? toInvShape(row) : null;
}

// All clients' invoices for a given month, SUMmed per client (one query instead of N).
// Returns Mintsoft-shaped array [{ ClientId(mintsoft), PickingCost, ... }]
async function getInvoicesForMonth(accountId, fromDate) {
  const pm = periodMonthStr(fromDate);

  if (isCurrentOrFutureMonth(fromDate)) {
    const rows = await query(
      `SELECT ia.*, c.mintsoft_id AS "ClientId"
       FROM invoice_accruals ia JOIN clients c ON ia.client_id = c.id
       WHERE ia.account_id = $1 AND ia.period_month = $2`,
      [accountId, pm]
    );
    return rows.map(toInvShape);
  }

  const rows = await query(
    `SELECT
       c.mintsoft_id AS "ClientId",
       SUM(i.picking_cost)          AS picking_cost,
       SUM(i.postage_cost)          AS postage_cost,
       SUM(i.vat_free_postage_cost) AS vat_free_postage_cost,
       SUM(i.storage_cost)          AS storage_cost,
       SUM(i.goods_in_cost)         AS goods_in_cost,
       SUM(i.returns_cost)          AS returns_cost,
       SUM(i.rework_cost)           AS rework_cost,
       SUM(i.packaging_cost)        AS packaging_cost,
       SUM(i.generic_items_cost)    AS generic_items_cost,
       SUM(i.collections_cost)      AS collections_cost,
       SUM(i.admin_fee)             AS admin_fee
     FROM invoices i JOIN clients c ON i.client_id = c.id
     WHERE i.account_id = $1 AND i.period_month = $2
     GROUP BY c.mintsoft_id, c.id`,
    [accountId, pm]
  );
  return rows.map(toInvShape);
}

// All confirmed invoices (grouped by month) + current-month accrual for a single client.
// Returns { confirmed: [{ Date(period_month), ...invShape }], accrual: { period_month, ...invShape } | null }
async function getAllClientInvoices(accountId, dbClientId) {
  const confirmed = await query(
    `SELECT
       i.period_month AS "Date",
       c.mintsoft_id  AS "ClientId",
       SUM(i.picking_cost)          AS picking_cost,
       SUM(i.postage_cost)          AS postage_cost,
       SUM(i.vat_free_postage_cost) AS vat_free_postage_cost,
       SUM(i.storage_cost)          AS storage_cost,
       SUM(i.goods_in_cost)         AS goods_in_cost,
       SUM(i.returns_cost)          AS returns_cost,
       SUM(i.rework_cost)           AS rework_cost,
       SUM(i.packaging_cost)        AS packaging_cost,
       SUM(i.generic_items_cost)    AS generic_items_cost,
       SUM(i.collections_cost)      AS collections_cost,
       SUM(i.admin_fee)             AS admin_fee
     FROM invoices i JOIN clients c ON i.client_id = c.id
     WHERE i.account_id = $1 AND i.client_id = $2
     GROUP BY i.period_month, c.mintsoft_id
     ORDER BY i.period_month DESC`,
    [accountId, dbClientId]
  );
  const accrual = await queryOne(
    `SELECT ia.*, c.mintsoft_id AS "ClientId"
     FROM invoice_accruals ia JOIN clients c ON ia.client_id = c.id
     WHERE ia.account_id = $1 AND ia.client_id = $2`,
    [accountId, dbClientId]
  );
  return {
    confirmed: confirmed.map(r => ({ ...toInvShape(r), Date: r.Date })),
    accrual:   accrual ? { ...toInvShape(accrual), period_month: accrual.period_month } : null,
  };
}

// Current-month accruals for all clients → { map: { msClientId: Mintsoft-shaped }, source: 'accrual'|'confirmed' }
// Falls back to the most recent confirmed invoice per client when no current-month accruals exist.
async function getCurrentAccrualsMap(accountId) {
  const today = new Date();
  const pm    = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`;
  const rows  = await query(
    `SELECT ia.*, c.mintsoft_id AS "ClientId"
     FROM invoice_accruals ia
     JOIN clients c ON ia.client_id = c.id
     WHERE ia.account_id = $1 AND ia.period_month = $2`,
    [accountId, pm]
  );
  if (rows.length > 0) {
    const map = {};
    for (const r of rows) map[String(r.ClientId)] = toInvShape(r);
    return { map, source: 'accrual' };
  }

  // No current-month accruals — use most recent confirmed invoice per client
  const fallback = await query(
    `SELECT DISTINCT ON (i.client_id)
       c.mintsoft_id AS "ClientId",
       SUM(i.picking_cost)          OVER w AS picking_cost,
       SUM(i.postage_cost)          OVER w AS postage_cost,
       SUM(i.vat_free_postage_cost) OVER w AS vat_free_postage_cost,
       SUM(i.storage_cost)          OVER w AS storage_cost,
       SUM(i.goods_in_cost)         OVER w AS goods_in_cost,
       SUM(i.returns_cost)          OVER w AS returns_cost,
       SUM(i.rework_cost)           OVER w AS rework_cost,
       SUM(i.packaging_cost)        OVER w AS packaging_cost,
       SUM(i.generic_items_cost)    OVER w AS generic_items_cost,
       SUM(i.collections_cost)      OVER w AS collections_cost,
       SUM(i.admin_fee)             OVER w AS admin_fee
     FROM invoices i JOIN clients c ON i.client_id = c.id
     WHERE i.account_id = $1
     WINDOW w AS (PARTITION BY i.client_id, i.period_month)
     ORDER BY i.client_id, i.period_month DESC`,
    [accountId]
  );
  const map = {};
  for (const r of fallback) map[String(r.ClientId)] = toInvShape(r);
  return { map, source: 'confirmed' };
}

module.exports = {
  resolveIds,
  getClientIdForAccount,
  getStock,
  getOrders,
  getOrderHeaders,
  getSkuNames,
  getInvoiceForClient,
  getInvoicesForMonth,
  getAllClientInvoices,
  getCurrentAccrualsMap,
};
