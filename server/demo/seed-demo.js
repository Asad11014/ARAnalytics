// ─── server/demo/seed-demo.js ─────────────────────────────────────────────────
// Seeds a self-contained, deterministic demo dataset into the CURRENT database.
//
// SAFETY: this is destructive within the reserved demo ID range and must never
// touch a production database. It refuses to run unless DEMO_MODE is truthy
// (the demo deployment points DATABASE_URL at its own isolated Postgres).
//
// Idempotent: every run deletes the reserved demo rows, then re-inserts a fresh
// dataset generated from a fixed seed — so the demo always looks identical.

const { pool } = require('../db');
const {
  DEMO_WAREHOUSE_ID,
  DEMO_WAREHOUSE,
  DEMO_CLIENTS,
  DEMO_CLIENT_IDS,
  DEMO_ID_BASE,
} = require('./constants');

// ── Deterministic PRNG (mulberry32) ───────────────────────────────────────────
function makeRng(seed) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = makeRng(20240611);
const rint  = (lo, hi) => lo + Math.floor(rng() * (hi - lo + 1));
const pick  = (arr) => arr[Math.floor(rng() * arr.length)];
const round2 = (n) => Math.round(n * 100) / 100;

// ── Date helpers ───────────────────────────────────────────────────────────────
const DAY = 86_400_000;
const now = () => new Date();
function daysAgo(n) { return new Date(Date.now() - n * DAY); }
function iso(d) { return d.toISOString(); }
function monthStart(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`; }

// ── Catalogue templates per client (theme-appropriate product names) ───────────
const CATALOGUE = {
  900101: ['Vitamin C Serum', 'Hydrating Moisturiser', 'Gentle Cleanser', 'Retinol Night Cream',
           'SPF 50 Day Fluid', 'Hyaluronic Mist', 'Clay Mask', 'Eye Recovery Gel'],
  900102: ['Whey Protein 1kg', 'Vegan Protein 1kg', 'Creatine 300g', 'Pre-Workout 400g',
           'BCAA Capsules', 'Omega-3 Softgels', 'Electrolyte Tabs', 'Recovery Shake'],
  900103: ['Linen Throw', 'Wool Blanket', 'Cotton Tea Towels', 'Cushion Cover',
           'Table Runner', 'Knit Pouffe', 'Bath Sheet', 'Napkin Set'],
  900104: ['Earl Grey 100g', 'English Breakfast 100g', 'Green Sencha 80g', 'Peppermint 60g',
           'Chamomile 60g', 'Rooibos 90g', 'Chai Blend 100g', 'Oolong 80g'],
  900105: ['Merino Base Layer', 'Trail Jacket', 'Quilted Gilet', 'Hiking Socks 3pk',
           'Beanie', 'Softshell Trousers', 'Insulated Vest', 'Packable Cagoule'],
};

const ORDER_STATUSES = [
  { name: 'Despatched', weight: 55, despatched: true },
  { name: 'Invoiced',   weight: 8,  despatched: true },
  { name: 'Processing', weight: 15, despatched: false },
  { name: 'Pending',    weight: 12, despatched: false },
  { name: 'On Hold',    weight: 5,  despatched: false },
  { name: 'Cancelled',  weight: 5,  despatched: false },
];
function pickStatus() {
  const total = ORDER_STATUSES.reduce((s, x) => s + x.weight, 0);
  let r = rng() * total;
  for (const s of ORDER_STATUSES) { if ((r -= s.weight) <= 0) return s; }
  return ORDER_STATUSES[0];
}

// ── Bulk insert helper (chunked, parameterised) ────────────────────────────────
async function bulkInsert(client, table, columns, rows, { conflict = '' } = {}) {
  if (!rows.length) return;
  const CHUNK = 400;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    const params = [];
    const values = slice.map((row, r) => {
      const ph = columns.map((_, c) => `$${r * columns.length + c + 1}`);
      params.push(...row);
      return `(${ph.join(', ')})`;
    });
    await client.query(
      `INSERT INTO ${table} (${columns.join(', ')}) VALUES ${values.join(', ')} ${conflict}`,
      params,
    );
  }
}

// ── Delete existing demo rows (reserved ID range only) ─────────────────────────
async function clearDemoData(client) {
  // Order matters only where ON DELETE behaviour could orphan; we scope each by
  // demo warehouse/client IDs. Cascades handle child rows (items, shipments).
  await client.query(`DELETE FROM orders   WHERE warehouse_id = $1 OR client_id = ANY($2)`, [DEMO_WAREHOUSE_ID, DEMO_CLIENT_IDS]);
  await client.query(`DELETE FROM asns     WHERE warehouse_id = $1 OR client_id = ANY($2)`, [DEMO_WAREHOUSE_ID, DEMO_CLIENT_IDS]);
  await client.query(`DELETE FROM invoices WHERE client_id = ANY($1)`, [DEMO_CLIENT_IDS]);
  await client.query(`DELETE FROM invoice_accruals WHERE client_id = ANY($1)`, [DEMO_CLIENT_IDS]);
  await client.query(`DELETE FROM product_stock_levels WHERE warehouse_id = $1`, [DEMO_WAREHOUSE_ID]);
  await client.query(`DELETE FROM products WHERE client_id = ANY($1)`, [DEMO_CLIENT_IDS]);
  await client.query(`DELETE FROM clients  WHERE id = ANY($1)`, [DEMO_CLIENT_IDS]);
  await client.query(`DELETE FROM warehouses WHERE id = $1`, [DEMO_WAREHOUSE_ID]);
}

// ── Main seed ──────────────────────────────────────────────────────────────────
async function seedDemo({ force = false } = {}) {
  if (!force && !process.env.DEMO_MODE) {
    console.log('[demo] seedDemo skipped — DEMO_MODE not set (refusing to seed a non-demo DB)');
    return { skipped: true };
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await clearDemoData(client);

    const nowTs = iso(now());

    // Warehouse + clients
    await bulkInsert(client, 'warehouses', ['id', 'name', 'code'],
      [[DEMO_WAREHOUSE.ID, DEMO_WAREHOUSE.Name, 'DEMO-BRS']]);

    await bulkInsert(client, 'clients', ['id', 'name', 'short_name', 'active', 'updated_at'],
      DEMO_CLIENTS.map(c => [c.ID, c.Name, c.Name.split(' ')[0], true, nowTs]));

    // Products + stock levels
    const products    = [];   // for orders
    const productRows = [];
    const stockRows   = [];
    let pid = DEMO_ID_BASE.product;

    for (const cl of DEMO_CLIENTS) {
      const names = CATALOGUE[cl.ID];
      names.forEach((name, idx) => {
        const id        = pid++;
        const sku       = `${cl.Name.split(' ')[0].toUpperCase().slice(0, 3)}-${String(idx + 1).padStart(3, '0')}`;
        const price     = round2(6 + rng() * 60);
        const costPrice = round2(price * (0.35 + rng() * 0.3));
        const lowAlert  = rint(10, 30);
        productRows.push([id, cl.ID, sku, name, price, costPrice, lowAlert, nowTs]);

        // Stock: spread across healthy / low / out-of-stock for report variety
        const roll = rng();
        const onHand = roll < 0.12 ? 0
                     : roll < 0.30 ? rint(1, lowAlert - 1)
                     : rint(lowAlert, 600);
        const allocated = Math.min(onHand, rint(0, 25));
        stockRows.push([id, DEMO_WAREHOUSE_ID, cl.ID, sku, onHand, allocated, Math.max(0, onHand - allocated), 0, nowTs]);

        products.push({ id, clientId: cl.ID, sku, price, costPrice });
      });
    }

    await bulkInsert(client, 'products',
      ['id', 'client_id', 'sku', 'name', 'price', 'cost_price', 'low_stock_alert_level', 'updated_at'],
      productRows);
    await bulkInsert(client, 'product_stock_levels',
      ['product_id', 'warehouse_id', 'client_id', 'sku', 'qty_on_hand', 'qty_allocated', 'qty_available', 'qty_pre_order', 'updated_at'],
      stockRows);

    // Orders + items over the last 90 days
    const orderRows = [];
    const itemRows  = [];
    let oid  = DEMO_ID_BASE.order;
    let oiid = DEMO_ID_BASE.orderItem;
    const DAYS = 90;

    for (let d = DAYS; d >= 0; d--) {
      const date = daysAgo(d);
      const dow  = date.getDay();
      const weekendFactor = (dow === 0 || dow === 6) ? 0.5 : 1;           // quieter weekends
      const trendFactor   = 0.7 + (1 - d / DAYS) * 0.6;                   // gentle growth toward today

      for (const cl of DEMO_CLIENTS) {
        const clientProducts = products.filter(p => p.clientId === cl.ID);
        const count = Math.round(rint(0, 6) * weekendFactor * trendFactor);

        for (let k = 0; k < count; k++) {
          const status = pickStatus();
          const id = oid++;
          const orderDate = new Date(date);
          orderDate.setHours(rint(7, 19), rint(0, 59), 0, 0);
          const despatchDate = status.despatched ? iso(new Date(orderDate.getTime() + rint(2, 36) * 3_600_000)) : null;

          // 1–4 line items
          const lineCount = rint(1, 4);
          let orderValue = 0;
          for (let li = 0; li < lineCount; li++) {
            const prod = pick(clientProducts);
            const qty  = rint(1, 6);
            const lineNet = round2(prod.price * qty);
            orderValue += lineNet;
            itemRows.push([oiid++, id, prod.id, prod.sku, qty, round2(prod.price), lineNet, round2(lineNet * 0.2)]);
          }

          orderRows.push([
            id, DEMO_WAREHOUSE_ID, cl.ID,
            `DMO-${id}`, status.name === 'Cancelled' ? 0 : null, status.name,
            iso(orderDate), despatchDate, round2(orderValue),
          ]);
        }
      }
    }

    await bulkInsert(client, 'orders',
      ['id', 'warehouse_id', 'client_id', 'order_number', 'status_id', 'status_name', 'order_date', 'despatch_date', 'order_value'],
      orderRows);
    await bulkInsert(client, 'order_items',
      ['id', 'order_id', 'product_id', 'sku', 'quantity', 'price', 'price_net', 'vat'],
      itemRows);

    // Invoices — last 3 completed months per client (cost breakdown scales w/ size)
    const invoiceRows = [];
    let invId = DEMO_ID_BASE.invoice;
    for (const cl of DEMO_CLIENTS) {
      for (let m = 3; m >= 1; m--) {
        const monthDate = new Date(now().getFullYear(), now().getMonth() - m + 1, 0); // end of that month
        const scale = 0.8 + rng() * 0.8;
        invoiceRows.push([
          invId++, cl.ID, `Invoice ${monthStart(monthDate)}`, iso(monthDate),
          round2(420 * scale),  // picking
          round2(380 * scale),  // postage
          round2(40 * scale),   // vat_free_postage
          round2(260 * scale),  // storage
          round2(150 * scale),  // goods_in
          round2(60 * scale),   // returns
          round2(30 * scale),   // packaging
          round2(75),           // admin_fee
          nowTs,
        ]);
      }
    }
    await bulkInsert(client, 'invoices',
      ['id', 'client_id', 'name', 'invoice_date',
       'picking_cost', 'postage_cost', 'vat_free_postage_cost', 'storage_cost',
       'goods_in_cost', 'returns_cost', 'packaging_cost', 'admin_fee', 'updated_at'],
      invoiceRows);

    // Current-month accruals per client
    const accrualRows = DEMO_CLIENTS.map(cl => {
      const scale = 0.5 + rng() * 0.6; // partial month
      return [
        cl.ID, monthStart(now()),
        round2(420 * scale), round2(380 * scale), round2(40 * scale), round2(260 * scale),
        round2(150 * scale), round2(60 * scale), round2(30 * scale), round2(75 * scale), nowTs,
      ];
    });
    await bulkInsert(client, 'invoice_accruals',
      ['client_id', 'period_month', 'picking_cost', 'postage_cost', 'vat_free_postage_cost',
       'storage_cost', 'goods_in_cost', 'returns_cost', 'packaging_cost', 'admin_fee', 'updated_at'],
      accrualRows,
      { conflict: 'ON CONFLICT (client_id, period_month) DO NOTHING' });

    // A handful of ASNs (goods-in) over the last 60 days
    const asnRows = [];
    let asnId = DEMO_ID_BASE.asn;
    const asnStatuses = ['Booked In', 'Expected', 'Part Received'];
    for (const cl of DEMO_CLIENTS) {
      for (let a = 0; a < rint(2, 4); a++) {
        const eta = daysAgo(rint(-10, 55));
        asnRows.push([
          asnId++, DEMO_WAREHOUSE_ID, cl.ID, `PO-${cl.ID}-${a + 1}`,
          pick(['Shenzhen Mfg', 'Lisbon Supply Co', 'Midlands Logistics', 'Atlas Imports']),
          rint(50, 800), pick(asnStatuses), iso(eta), nowTs,
        ]);
      }
    }
    await bulkInsert(client, 'asns',
      ['id', 'warehouse_id', 'client_id', 'po_reference', 'supplier_name', 'quantity', 'status_name', 'estimated_delivery', 'updated_at'],
      asnRows);

    // Mark a completed sync so the app treats data as ready (demo never syncs live)
    await client.query(
      `INSERT INTO sync_jobs (triggered_by, entity, status, records_synced, current_step, completed_at)
       VALUES ('demo-seed', 'full', 'success', $1, 'Demo data seeded', NOW())`,
      [orderRows.length + productRows.length],
    );

    await client.query('COMMIT');
    console.log(`[demo] Seed complete — ${DEMO_CLIENTS.length} clients, ${productRows.length} products, ${orderRows.length} orders, ${itemRows.length} items, ${invoiceRows.length} invoices`);
    return { ok: true, clients: DEMO_CLIENTS.length, products: productRows.length, orders: orderRows.length };
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[demo] Seed failed, rolled back:', err.message);
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { seedDemo };

// Allow `node server/demo/seed-demo.js --force` for manual seeding.
if (require.main === module) {
  require('dotenv').config();
  const force = process.argv.includes('--force');
  seedDemo({ force })
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}
