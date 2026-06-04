// ─── server/replen.js ───────────────────────────────────────────────────────
// Builds a replenishment task list: pick faces that have dropped to (or below)
// their replen point, and where to replen them from.
//
// Replen point and target size are configured PER SKU (not per location) in
// Mintsoft — two SKUs sharing the same pick bin each have their own values.
// So we key the replen config by SKU and apply it wherever that SKU sits in a
// pickable face.
//
// Both inputs are fetched LIVE: physical stock-in-location changes constantly
// through the day as orders are picked, so a synced/stale copy would produce a
// wrong replen list. Volumes are small (~840 location rows, ~244 replen points
// for this warehouse), so a live fetch is fast.

const { mintsoftGet } = require('./mintsoft');

const PAGE_LIMIT = 100;

// Location types we can replenish FROM, in preference order.
const SOURCE_TYPES = ['BULK', 'STORE', 'PALLET'];

const isPickType   = lt => (lt || '').toUpperCase().startsWith('PICK');
const isSourceType = lt => SOURCE_TYPES.includes((lt || '').toUpperCase());

async function fetchLocationRows(apiKey, warehouseId, clientId) {
  const rows = [];
  let pageNo = 1;
  while (true) {
    const path = `/api/Reports/ProductsInLocationReport?warehouseId=${encodeURIComponent(warehouseId)}`
      + (clientId ? `&clientId=${encodeURIComponent(clientId)}` : '')
      + `&excludeQuarantine=true&limit=${PAGE_LIMIT}&pageNo=${pageNo}`;
    const r = await mintsoftGet(path, apiKey);
    if (r.status !== 200 || !Array.isArray(r.body)) break;
    rows.push(...r.body);
    if (r.body.length < PAGE_LIMIT) break;
    pageNo++;
    if (pageNo > 300) break;
  }
  return rows;
}

// SKU → { replenPoint, size, name } using the PICK-type replen point per SKU.
async function fetchReplenMap(apiKey) {
  const map = {};
  let pageNo = 1;
  while (true) {
    const r = await mintsoftGet(`/api/ReplenPoints?Limit=${PAGE_LIMIT}&PageNo=${pageNo}`, apiKey);
    if (r.status !== 200 || !Array.isArray(r.body)) break;
    for (const rp of r.body) {
      if (!isPickType(rp.LocationTypeName)) continue;
      const sku = rp.ProductSKU;
      if (!sku) continue;
      // Prefer an exact "PICK" entry; otherwise keep the first PICK* entry seen.
      const exact = (rp.LocationTypeName || '').toUpperCase() === 'PICK';
      if (!map[sku] || exact) {
        map[sku] = { replenPoint: rp.ReplenPoint ?? 0, size: rp.Size ?? 0, name: rp.ProductName || '' };
      }
    }
    if (r.body.length < PAGE_LIMIT) break;
    pageNo++;
    if (pageNo > 300) break;
  }
  return map;
}

// GET /api/replen?warehouseId=X&clientId=Y
async function handle(req, res, url, session) {
  if (!session.isWarehouse) return res.json(403, { error: 'Warehouse users only' });

  const warehouseId = url.searchParams.get('warehouseId');
  if (!warehouseId) return res.json(400, { error: 'warehouseId is required' });
  const clientId = url.searchParams.get('clientId') || null;

  const [rows, replenMap] = await Promise.all([
    fetchLocationRows(session.apiKey, warehouseId, clientId),
    fetchReplenMap(session.apiKey),
  ]);

  // Aggregate physical stock: pick faces per (SKU, location), and replen sources per SKU.
  const pickFaces    = {};  // `${sku}|${location}` → { sku, location, locationType, name, client, qty }
  const sourcesBySku = {};  // sku → [{ location, type, qty }]

  for (const r of rows) {
    const sku = r.ProductSKU;
    const loc = r.Location;
    if (!sku || !loc || loc === 'UNASSIGNED') continue;
    const lt  = (r.LocationType || '').toUpperCase();
    const qty = parseInt(r.Quantity, 10) || 0;

    if (isPickType(lt)) {
      const key = `${sku}|${loc}`;
      if (!pickFaces[key]) {
        pickFaces[key] = { sku, location: loc, locationType: lt, name: r.ProductName || '', client: r.Client || '', qty: 0 };
      }
      pickFaces[key].qty += qty;
    } else if (isSourceType(lt)) {
      (sourcesBySku[sku] = sourcesBySku[sku] || []).push({ location: loc, type: lt, qty });
    }
  }

  // Build tasks: any pick face at or below its SKU's replen point.
  const tasks = [];
  for (const key of Object.keys(pickFaces)) {
    const face = pickFaces[key];
    const cfg  = replenMap[face.sku];
    if (!cfg) continue;                       // no replen point configured for this SKU
    if (face.qty > cfg.replenPoint) continue; // pick face still above replen point

    // Best source: prefer BULK > STORE > PALLET, then most stock.
    const sources = (sourcesBySku[face.sku] || [])
      .filter(s => s.qty > 0)
      .sort((a, b) => SOURCE_TYPES.indexOf(a.type) - SOURCE_TYPES.indexOf(b.type) || b.qty - a.qty);
    const best = sources[0] || null;

    const qtyToReplen = Math.max(0, cfg.size - face.qty);

    tasks.push({
      sku:            face.sku,
      name:           face.name || cfg.name || '',
      client:         face.client || '',
      pickLocation:   face.location,
      pickType:       face.locationType,
      currentQty:     face.qty,
      replenPoint:    cfg.replenPoint,
      size:           cfg.size,
      qtyToReplen,
      replenFrom:     best ? best.location : null,
      replenFromType: best ? best.type : null,
      replenFromQty:  best ? best.qty : 0,
      shortfall:      best ? Math.max(0, qtyToReplen - best.qty) : qtyToReplen,
    });
  }

  // Walking order — by pick location.
  tasks.sort((a, b) => a.pickLocation.localeCompare(b.pickLocation));

  return res.json(200, {
    tasks,
    meta: {
      totalTasks: tasks.length,
      withSource: tasks.filter(t => t.replenFrom).length,
      noSource:   tasks.filter(t => !t.replenFrom).length,
      shortfalls: tasks.filter(t => t.shortfall > 0).length,
    },
  });
}

module.exports = { handle };
