// ─── server/sync.js ───────────────────────────────────────────────────────────
// Pulls data from Mintsoft and persists it to PostgreSQL.
// All writes use ON CONFLICT DO UPDATE — safe to re-run any time.

const { query, queryOne } = require('./db');
const {
  fetchStock,
  fetchOrders,
  fetchOrderHeaders,
  fetchGoodsIn,
  fetchInvoiceList,
  fetchUnconfirmedInvoiceSummary,
} = require('./reports/base');

// ─── Account ──────────────────────────────────────────────────────────────────

async function upsertAccount(session) {
  const row = await queryOne(
    `INSERT INTO accounts (username, api_key, is_warehouse)
     VALUES ($1, $2, $3)
     ON CONFLICT (username) DO UPDATE
       SET api_key = EXCLUDED.api_key
     RETURNING id`,
    [session.username, session.apiKey, Boolean(session.isWarehouse)]
  );
  return row.id;
}

async function getAccountId(username) {
  const row = await queryOne(`SELECT id FROM accounts WHERE username = $1`, [username]);
  return row?.id ?? null;
}

// ─── Job tracking ─────────────────────────────────────────────────────────────

async function startJob(accountId, entity, triggeredBy) {
  const row = await queryOne(
    `INSERT INTO sync_jobs (account_id, entity, triggered_by, status)
     VALUES ($1, $2, $3, 'running') RETURNING id`,
    [accountId, entity, triggeredBy]
  );
  return row.id;
}

async function completeJob(jobId, count) {
  await query(
    `UPDATE sync_jobs SET status = 'success', records_synced = $2, current_step = NULL, completed_at = NOW() WHERE id = $1`,
    [jobId, count]
  );
}

async function updateJobStep(jobId, step) {
  await query(`UPDATE sync_jobs SET current_step = $2 WHERE id = $1`, [jobId, step]);
}

async function failJob(jobId, err) {
  await query(
    `UPDATE sync_jobs SET status = 'error', error = $2, completed_at = NOW() WHERE id = $1`,
    [jobId, err.message]
  );
}

// ─── Warehouses ───────────────────────────────────────────────────────────────

async function syncWarehouses(accountId, warehouses) {
  const map = {}; // mintsoft_id (string) → db id
  for (const wh of warehouses) {
    const mid = wh.ID || wh.Id;
    const row = await queryOne(
      `INSERT INTO warehouses (account_id, mintsoft_id, name, code)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (account_id, mintsoft_id) DO UPDATE SET name = EXCLUDED.name, code = EXCLUDED.code
       RETURNING id`,
      [accountId, mid, wh.Name || wh.name, wh.Code || wh.code || null]
    );
    map[String(mid)] = row.id;
  }
  return map;
}

// ─── Clients ──────────────────────────────────────────────────────────────────

async function syncClients(accountId, clients) {
  const map = {};
  for (const cl of clients) {
    const mid = cl.ID || cl.Id || cl.id;
    const name = cl.Name || cl.name || String(mid);
    const row = await queryOne(
      `INSERT INTO clients (account_id, mintsoft_id, name)
       VALUES ($1, $2, $3)
       ON CONFLICT (account_id, mintsoft_id) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      [accountId, mid, name]
    );
    map[String(mid)] = row.id;
  }
  return map;
}

// Ensure a client-user's own client record exists (name resolved later if possible)
async function ensureClientRecord(accountId, msClientId) {
  await query(
    `INSERT INTO clients (account_id, mintsoft_id, name)
     VALUES ($1, $2, 'Client Account')
     ON CONFLICT (account_id, mintsoft_id) DO NOTHING`,
    [accountId, msClientId]
  );
  const row = await queryOne(
    `SELECT id FROM clients WHERE account_id = $1 AND mintsoft_id = $2`,
    [accountId, msClientId]
  );
  return row?.id ?? null;
}

// ─── Stock ────────────────────────────────────────────────────────────────────

async function syncStock(accountId, warehouseMap, clientMap, apiKey) {
  let count = 0;
  for (const [msWhId, dbWhId] of Object.entries(warehouseMap)) {
    const items = await fetchStock(apiKey, msWhId, null);
    for (const item of items) {
      const msCl = String(item.ClientId || item.clientId || '');
      const dbCl = clientMap[msCl];
      if (!dbCl) continue;
      const sku = item.SKU || item.Sku || '';
      if (!sku) continue;

      await query(
        `INSERT INTO stock_levels
           (account_id, warehouse_id, client_id, sku, product_name,
            qty_on_hand, qty_allocated, qty_available, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())
         ON CONFLICT (account_id, warehouse_id, client_id, sku) DO UPDATE SET
           product_name  = EXCLUDED.product_name,
           qty_on_hand   = EXCLUDED.qty_on_hand,
           qty_allocated = EXCLUDED.qty_allocated,
           qty_available = EXCLUDED.qty_available,
           updated_at    = NOW()`,
        [
          accountId, dbWhId, dbCl, sku,
          item.ProductName || item.Name || null,
          item.Level || 0,
          item.AllocatedQuantity || item.Allocated || 0,
          item.AvailableQuantity || item.Available || item.Level || 0,
        ]
      );
      count++;
    }
  }
  return count;
}

// ─── Goods In / ASN ──────────────────────────────────────────────────────────

async function syncGoodsIn(accountId, warehouseMap, clientMap, apiKey) {
  let count = 0;
  // No date filter — fetch ALL ASNs (past and future) so upcoming deliveries are included.
  // The table uses ON CONFLICT DO UPDATE so re-syncing existing records is safe.
  for (const [msWhId, dbWhId] of Object.entries(warehouseMap)) {
    const records = await fetchGoodsIn(apiKey, msWhId, null, null, null);
    console.log(`[sync]   ASN warehouse ${msWhId}: ${records.length} records`);

    for (const r of records) {
      const msId = r.Id || r.ID || r.id;
      if (!msId) continue;

      const msCl    = String(r.ClientId || r.ClientID || '');
      const dbCl    = clientMap[msCl] || null;

      const ref     = r.POReference  || r.Reference     || r.CustomerReference || null;
      const status  = (typeof r.ASNStatus === 'object' ? r.ASNStatus?.Name : r.ASNStatus) || r.Status || r.StatusName || null;
      const expDate = (r.EstimatedDelivery || r.ExpectedDeliveryDate || r.ExpectedDate || r.DueDate || '').split('T')[0] || null;
      const recDate = (r.BookedInDate || r.DateReceived || r.ReceivedDate || r.DateBooked || '').split('T')[0] || null;
      const items   = r.Quantity || r.NumberOfItems || r.TotalItems || r.ExpectedItems || 0;
      const supplier = r.ProductSupplier || null;
      const notes    = [supplier ? `Supplier: ${supplier}` : null, r.Comments || r.Notes || null]
                         .filter(Boolean).join(' · ') || null;

      await query(
        `INSERT INTO goods_in_records
           (account_id, warehouse_id, client_id, mintsoft_id, reference,
            status, expected_date, received_date, total_items, notes, synced_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())
         ON CONFLICT (account_id, mintsoft_id) DO UPDATE SET
           reference     = EXCLUDED.reference,
           status        = EXCLUDED.status,
           expected_date = EXCLUDED.expected_date,
           received_date = EXCLUDED.received_date,
           total_items   = EXCLUDED.total_items,
           notes         = EXCLUDED.notes,
           synced_at     = NOW()`,
        [accountId, dbWhId, dbCl, msId, ref, status,
         expDate || null, recDate || null, items, notes]
      );
      count++;
    }
  }
  return count;
}

// ─── Orders + items ───────────────────────────────────────────────────────────

// Sync order headers + line items for a date window.
// withItems=false skips the per-order detail calls — use for large historical ranges.
async function syncOrders(accountId, warehouseMap, clientMap, apiKey, fromDate, toDate, withItems = true) {
  let count = 0;
  const to = toDate || new Date().toISOString().split('T')[0];

  for (const [msWhId, dbWhId] of Object.entries(warehouseMap)) {
    let orders;
    if (withItems) {
      orders = await fetchOrders(apiKey, msWhId, null, fromDate, to,
        p => {
          if (p.stage === 'orders') console.log(`[sync]   orders page ${p.page} (${p.total} headers)`);
          else if (p.done % 500 === 0 || p.done === p.total) console.log(`[sync]   items ${p.done}/${p.total}`);
        }
      );
    } else {
      orders = await fetchOrderHeaders(apiKey, msWhId, null, fromDate, to,
        p => { if (p.page % 10 === 0) console.log(`[sync]   order headers page ${p.page} (${p.total})`); }
      );
    }

    for (const order of orders) {
      const msOrdId = order.ID || order.Id;
      if (!msOrdId) continue;

      const msCl = String(order.ClientId || order.ClientID || '');
      const dbCl = clientMap[msCl] || null;

      const row = await queryOne(
        `INSERT INTO orders
           (account_id, warehouse_id, client_id, mintsoft_id,
            reference, channel, order_date, despatch_date, status, courier_name, tracking_number)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT (account_id, mintsoft_id) DO UPDATE SET
           status          = EXCLUDED.status,
           despatch_date   = EXCLUDED.despatch_date,
           tracking_number = EXCLUDED.tracking_number
         RETURNING id`,
        [
          accountId, dbWhId, dbCl, msOrdId,
          order.Reference    || order.OrderReference || null,
          order.Channel      || order.Source         || null,
          order.OrderDate    ? order.OrderDate.split('T')[0]    : null,
          order.DespatchDate ? order.DespatchDate.split('T')[0] : null,
          order.Status       || null,
          order.CourierName  || order.Courier        || null,
          order.TrackingNumber || order.Tracking     || null,
        ]
      );

      // Items — delete and reinsert so stale lines don't linger
      if (order.OrderItems?.length) {
        await query(`DELETE FROM order_items WHERE order_id = $1`, [row.id]);
        for (const item of order.OrderItems) {
          const sku = item.SKU || item.Sku || '';
          if (!sku) continue;
          await query(
            `INSERT INTO order_items (order_id, sku, product_name, quantity)
             VALUES ($1,$2,$3,$4)`,
            [row.id, sku, item.Name || item.ProductName || null, item.Quantity || 0]
          );
        }
      }
      count++;
    }
  }
  return count;
}

// ─── Confirmed invoices ───────────────────────────────────────────────────────

async function syncInvoices(accountId, clientMap, apiKey) {
  let count = 0;
  for (const [msCl, dbCl] of Object.entries(clientMap)) {
    const invoices = await fetchInvoiceList(apiKey, msCl);
    for (const inv of invoices) {
      const msId = inv.ID || inv.Id;
      if (!msId) continue;
      const d = new Date(inv.Date || inv.InvoiceDate || 0);
      const periodMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;

      await query(
        `INSERT INTO invoices
           (account_id, client_id, mintsoft_id, period_month,
            picking_cost, postage_cost, vat_free_postage_cost, storage_cost,
            goods_in_cost, returns_cost, rework_cost, packaging_cost,
            generic_items_cost, collections_cost, admin_fee,
            number_of_parcels, number_of_items, synced_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,NOW())
         ON CONFLICT (account_id, mintsoft_id) DO UPDATE SET
           picking_cost          = EXCLUDED.picking_cost,
           postage_cost          = EXCLUDED.postage_cost,
           vat_free_postage_cost = EXCLUDED.vat_free_postage_cost,
           storage_cost          = EXCLUDED.storage_cost,
           goods_in_cost         = EXCLUDED.goods_in_cost,
           returns_cost          = EXCLUDED.returns_cost,
           rework_cost           = EXCLUDED.rework_cost,
           packaging_cost        = EXCLUDED.packaging_cost,
           generic_items_cost    = EXCLUDED.generic_items_cost,
           collections_cost      = EXCLUDED.collections_cost,
           admin_fee             = EXCLUDED.admin_fee,
           number_of_parcels     = EXCLUDED.number_of_parcels,
           number_of_items       = EXCLUDED.number_of_items,
           synced_at             = NOW()`,
        [
          accountId, dbCl, msId, periodMonth,
          inv.PickingCost             || 0,
          inv.PostageCost             || 0,
          inv.VatFreePostageCost      || 0,
          inv.StorageCost             || 0,
          inv.GoodsInCost             || 0,
          inv.ReturnsCost             || 0,
          inv.ReworkCost              || 0,
          inv.PackagingCost           || 0,
          inv.GenericInvoiceItemsCost || 0,
          inv.CollectionsCost         || 0,
          inv.AdminFee                || 0,
          inv.NumberOfParcels || 0,
          inv.NumberOfItems   || 0,
        ]
      );
      count++;
    }
  }
  return count;
}

// ─── Current-month accruals ───────────────────────────────────────────────────

async function syncAccruals(accountId, clientMap, apiKey) {
  const now   = new Date();
  const y     = now.getFullYear();
  const m     = String(now.getMonth() + 1).padStart(2, '0');
  const day   = String(now.getDate()).padStart(2, '0');
  const periodMonth = `${y}-${m}-01`;
  const from  = `${y}-${m}-01`;
  const to    = `${y}-${m}-${day}`;
  let count = 0;

  const p = (obj, ...keys) => { for (const k of keys) { if (obj[k] != null) return Number(obj[k]); } return 0; };

  for (const [msCl, dbCl] of Object.entries(clientMap)) {
    const inv = await fetchUnconfirmedInvoiceSummary(apiKey, msCl, from, to);
    if (!inv) { console.log(`  [accruals] client ${msCl}: no data returned, skipping`); continue; }

    const picking  = p(inv, 'PickingCost', 'Picking', 'PickingTotal');
    const postage  = p(inv, 'PostageCost', 'Postage', 'PostageTotal');
    const vatPost  = p(inv, 'VatFreePostageCost', 'VatFreePostage');
    const storage  = p(inv, 'StorageCost', 'Storage', 'StorageTotal');
    const goodsIn  = p(inv, 'GoodsInCost', 'GoodsIn', 'GoodsInTotal');
    const returns  = p(inv, 'ReturnsCost', 'Returns', 'ReturnsTotal');
    const rework   = p(inv, 'ReworkCost', 'Rework');
    const packag   = p(inv, 'PackagingCost', 'Packaging');
    const generic  = p(inv, 'GenericInvoiceItemsCost', 'GenericItems', 'GenericInvoiceItems');
    const colls    = p(inv, 'CollectionsCost', 'Collections');
    const admin    = p(inv, 'AdminFee', 'Admin');
    const parcels  = p(inv, 'NumberOfParcels', 'Parcels');
    const items    = p(inv, 'NumberOfItems', 'Items');
    const total    = picking + postage + vatPost + storage + goodsIn + returns + rework + packag + generic + colls + admin;
    console.log(`  [accruals] client ${msCl}: total=£${total.toFixed(2)} (pick=${picking} post=${postage} stor=${storage})`);

    await query(
      `INSERT INTO invoice_accruals
         (account_id, client_id, period_month,
          picking_cost, postage_cost, vat_free_postage_cost, storage_cost,
          goods_in_cost, returns_cost, rework_cost, packaging_cost,
          generic_items_cost, collections_cost, admin_fee,
          number_of_parcels, number_of_items, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,NOW())
       ON CONFLICT (account_id, client_id, period_month) DO UPDATE SET
         picking_cost          = EXCLUDED.picking_cost,
         postage_cost          = EXCLUDED.postage_cost,
         vat_free_postage_cost = EXCLUDED.vat_free_postage_cost,
         storage_cost          = EXCLUDED.storage_cost,
         goods_in_cost         = EXCLUDED.goods_in_cost,
         returns_cost          = EXCLUDED.returns_cost,
         rework_cost           = EXCLUDED.rework_cost,
         packaging_cost        = EXCLUDED.packaging_cost,
         generic_items_cost    = EXCLUDED.generic_items_cost,
         collections_cost      = EXCLUDED.collections_cost,
         admin_fee             = EXCLUDED.admin_fee,
         number_of_parcels     = EXCLUDED.number_of_parcels,
         number_of_items       = EXCLUDED.number_of_items,
         updated_at            = NOW()`,
      [accountId, dbCl, periodMonth, picking, postage, vatPost, storage, goodsIn, returns, rework, packag, generic, colls, admin, parcels, items]
    );
    count++;
  }
  return count;
}

// ─── Orchestrators ────────────────────────────────────────────────────────────

// Full sync — all historical data. Used on first login and manual "Sync All".
async function runFullSync(session, { triggeredBy = 'manual' } = {}) {
  const accountId = await upsertAccount(session);
  const { apiKey, isWarehouse, warehouses = [], clients = [] } = session;

  const jobId = await startJob(accountId, 'full', triggeredBy);
  let total = 0;

  const errors = [];

  async function step(label, fn) {
    try {
      console.log(`[sync] ${label}…`);
      await updateJobStep(jobId, label).catch(() => {});
      const n = await fn();
      total += (n || 0);
    } catch (err) {
      console.error(`[sync] ${label} failed: ${err.message}`);
      errors.push(`${label}: ${err.message}`);
    }
  }

  try {
    console.log(`[sync] Full sync started — account ${accountId} (${session.username})`);

    const warehouseMap = await syncWarehouses(accountId, warehouses);

    let clientMap = {};
    if (isWarehouse) {
      clientMap = await syncClients(accountId, clients);
    } else if (session.clientId) {
      const dbCl = await ensureClientRecord(accountId, session.clientId);
      if (dbCl) clientMap[String(session.clientId)] = dbCl;
    }

    console.log(`[sync] ${Object.keys(warehouseMap).length} warehouse(s), ${Object.keys(clientMap).length} client(s)`);

    await step('Syncing stock', () => syncStock(accountId, warehouseMap, clientMap, apiKey));

    // Historical orders — headers only (no per-order API calls) for the 24-month window.
    // This keeps the full sync fast enough to complete.
    const from24m = (() => { const d = new Date(); d.setMonth(d.getMonth() - 24); return d.toISOString().split('T')[0]; })();
    await step(`Syncing order headers from ${from24m}`, () => syncOrders(accountId, warehouseMap, clientMap, apiKey, from24m, null, false));

    // Recent orders — with full line-item detail (last 60 days, ~few hundred orders max).
    const from60d = (() => { const d = new Date(); d.setDate(d.getDate() - 60); return d.toISOString().split('T')[0]; })();
    await step(`Syncing recent order items from ${from60d}`, () => syncOrders(accountId, warehouseMap, clientMap, apiKey, from60d, null, true));

    await step('Syncing invoices', () => syncInvoices(accountId, clientMap, apiKey));

    await step('Syncing accruals', () => syncAccruals(accountId, clientMap, apiKey));

    if (isWarehouse) {
      await step('Syncing goods-in records', () => syncGoodsIn(accountId, warehouseMap, clientMap, apiKey));
    }

    // Always mark sync complete so future logins use incremental sync
    await query(`UPDATE accounts SET last_sync_at = NOW() WHERE id = $1`, [accountId]);

    if (errors.length) {
      console.warn(`[sync] Done with ${errors.length} step error(s) — ${total} records`);
      await failJob(jobId, new Error(errors.join('; '))).catch(() => {});
      return { ok: false, records: total, errors };
    }

    await completeJob(jobId, total);
    console.log(`[sync] Done — ${total} records`);
    return { ok: true, records: total };

  } catch (err) {
    console.error('[sync] Fatal error:', err.message);
    await query(`UPDATE accounts SET last_sync_at = NOW() WHERE id = $1`, [accountId]).catch(() => {});
    await failJob(jobId, err).catch(() => {});
    return { ok: false, error: err.message };
  }
}

// Incremental sync — stock snapshot + recent orders + accruals. Used by daily cron.
async function runIncrementalSync(session, { triggeredBy = 'cron' } = {}) {
  const accountId = await upsertAccount(session);
  const { apiKey, isWarehouse, warehouses = [], clients = [] } = session;

  const jobId = await startJob(accountId, 'incremental', triggeredBy);
  let total = 0;

  try {
    console.log(`[sync] Incremental sync — account ${accountId}`);

    const warehouseMap = await syncWarehouses(accountId, warehouses);

    let clientMap = {};
    if (isWarehouse) {
      clientMap = await syncClients(accountId, clients);
    } else if (session.clientId) {
      const dbCl = await ensureClientRecord(accountId, session.clientId);
      if (dbCl) clientMap[String(session.clientId)] = dbCl;
    }

    // Stock — always a full refresh (small dataset, needs to be current)
    await updateJobStep(jobId, 'Syncing stock').catch(() => {});
    total += await syncStock(accountId, warehouseMap, clientMap, apiKey);

    // Orders — last 3 days only (catches new orders + despatch updates)
    const from = (() => { const d = new Date(); d.setDate(d.getDate() - 3); return d.toISOString().split('T')[0]; })();
    await updateJobStep(jobId, 'Syncing recent orders').catch(() => {});
    total += await syncOrders(accountId, warehouseMap, clientMap, apiKey, from);

    // Accruals — current month running total
    await updateJobStep(jobId, 'Syncing accruals').catch(() => {});
    total += await syncAccruals(accountId, clientMap, apiKey);

    // Goods-in — last 30 days (warehouse only)
    if (isWarehouse) {
      await updateJobStep(jobId, 'Syncing goods-in').catch(() => {});
      total += await syncGoodsIn(accountId, warehouseMap, clientMap, apiKey);
    }

    await completeJob(jobId, total);
    await query(`UPDATE accounts SET last_sync_at = NOW() WHERE id = $1`, [accountId]);
    console.log(`[sync] Incremental done — ${total} records`);
    return { ok: true, records: total };

  } catch (err) {
    console.error('[sync] Incremental error:', err.message);
    await failJob(jobId, err).catch(() => {});
    return { ok: false, error: err.message };
  }
}

// Lightweight GoodsIn-only sync — no stock/orders/invoices.
// Builds warehouse + client maps from the DB (already synced) so no extra API calls.
async function syncGoodsInOnly(session) {
  const accountId = await upsertAccount(session);
  if (!session.isWarehouse) throw new Error('GoodsIn sync is warehouse-only');

  const whRows = await query(`SELECT mintsoft_id, id FROM warehouses WHERE account_id = $1`, [accountId]);
  const clRows = await query(`SELECT mintsoft_id, id FROM clients   WHERE account_id = $1`, [accountId]);

  if (!whRows.length) throw new Error('No warehouses found — run a full sync first');

  const warehouseMap = {};
  for (const r of whRows) warehouseMap[String(r.mintsoft_id)] = r.id;

  const clientMap = {};
  for (const r of clRows) clientMap[String(r.mintsoft_id)] = r.id;

  const count = await syncGoodsIn(accountId, warehouseMap, clientMap, session.apiKey);
  return { ok: true, records: count };
}

module.exports = { upsertAccount, getAccountId, runFullSync, runIncrementalSync, syncGoodsInOnly };
