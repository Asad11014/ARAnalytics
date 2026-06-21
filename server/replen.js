// ─── server/replen.js ───────────────────────────────────────────────────────
// Two replenishment lists, both driven by per-SKU replen points (/api/ReplenPoints)
// and live stock-in-location (/api/Reports/ProductsInLocationReport).
//
// 1. Off-Hand Storage Replen — for each SKU, total units across ALL warehouse
//    locations (PICK + PALLET + BULK). If below the SKU's replen point, replen
//    from off-hand storage (STORE / REPLEN — the "ST…" ones). For large items kept off-site.
//
// 2. Pick Face Replen — each PICK face at/below its replen point (or zero),
//    replenished from BULK locations in the warehouse. For smaller items.
//
// Location types: warehouse = PICK*/PALLET/BULK; off-hand = STORE/REPLEN.

const { mintsoftGet } = require('./mintsoft');

const PAGE_LIMIT = 100;

const norm      = lt => (lt || '').toUpperCase();
const isPick    = lt => norm(lt).startsWith('PICK');
const isPallet  = lt => norm(lt) === 'PALLET';
const isBulk    = lt => norm(lt) === 'BULK';
const isOffhand = lt => norm(lt) === 'STORE' || norm(lt) === 'REPLEN';

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
      if (!isPick(rp.LocationTypeName)) continue;
      const sku = rp.ProductSKU;
      if (!sku) continue;
      const exact = norm(rp.LocationTypeName) === 'PICK';
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

const bestSource = list => (list || []).filter(s => s.qty > 0).sort((a, b) => b.qty - a.qty)[0] || null;

// Location directory for a warehouse: LocationId → { name, type }.
async function fetchLocationDirectory(apiKey, warehouseId) {
  const typeById = {};
  const lt = await mintsoftGet('/api/Warehouse/LocationTypes', apiKey);
  if (lt.status === 200 && Array.isArray(lt.body)) {
    for (const t of lt.body) typeById[t.ID] = norm(t.Name || t.TypeName || '');
  }
  const dir = {};
  const la = await mintsoftGet(`/api/Warehouse/${encodeURIComponent(warehouseId)}/Location/All`, apiKey);
  if (la.status === 200 && Array.isArray(la.body)) {
    for (const l of la.body) {
      dir[l.ID] = { name: l.Name || l.LocationName || String(l.ID), type: typeById[l.LocationTypeId] || '' };
    }
  }
  return dir;
}

// Products in orders currently "Awaiting Replen" (Mintsoft status 21), aggregated
// by SKU with total quantity required and the physical location the stock is
// allocated from. Locations come from each order's Allocations (the authoritative
// per-order stock location — bundles are already exploded into their component
// allocations by Mintsoft, e.g. cot-bed boxes sitting in an "ST…" STORE location).
async function fetchAwaitingReplen(apiKey, warehouseId, clientId) {
  const locDir = await fetchLocationDirectory(apiKey, warehouseId);

  // 1. List awaiting orders with their line items.
  const orders = []; // { id, ref, items:[{ sku, productId, qty }] }
  let pageNo = 1;
  while (true) {
    const path = `/api/Order/List?WarehouseId=${encodeURIComponent(warehouseId)}&OrderStatusId=21&IncludeOrderItems=true`
      + (clientId ? `&ClientId=${encodeURIComponent(clientId)}` : '')
      + `&Limit=${PAGE_LIMIT}&PageNo=${pageNo}`;
    const r = await mintsoftGet(path, apiKey);
    if (r.status !== 200 || !Array.isArray(r.body) || !r.body.length) break;
    for (const o of r.body) {
      orders.push({
        id:    o.ID || o.OrderId,
        ref:   o.OrderNumber || o.ID,
        items: (o.OrderItems || []).filter(it => it.SKU)
          .map(it => ({ sku: it.SKU, productId: it.ProductId || null, qty: it.Quantity || 0 })),
      });
    }
    if (r.body.length < PAGE_LIMIT) break;
    pageNo++;
    if (pageNo > 100) break;
  }

  // 2. Resolve each order's allocations into physical locations.
  const items = {};      // sku → { qty, name, orders:Set, via:Set, locations:{ name → { type, qty } } }
  const prodCache = {};  // productId → { sku, name }
  const resolveProduct = async (pid) => {
    if (prodCache[pid] === undefined) {
      const d = await mintsoftGet(`/api/Product/${encodeURIComponent(pid)}`, apiKey);
      prodCache[pid] = (d.status === 200 && d.body) ? { sku: d.body.SKU, name: d.body.Name || '' } : { sku: String(pid), name: '' };
    }
    return prodCache[pid];
  };
  const bump = (sku, name, qty, ref, via, loc) => {
    if (!items[sku]) items[sku] = { qty: 0, name: '', orders: new Set(), via: new Set(), locations: {} };
    const e = items[sku];
    e.qty += qty;
    if (name && !e.name) e.name = name;
    e.orders.add(ref);
    if (via) e.via.add(via);
    if (loc) {
      if (!e.locations[loc.name]) e.locations[loc.name] = { type: loc.type || '', qty: 0 };
      e.locations[loc.name].qty += qty;
    }
  };

  for (const o of orders) {
    // SKU is already known for order-line products.
    for (const it of o.items) if (it.productId && prodCache[it.productId] === undefined) prodCache[it.productId] = { sku: it.sku, name: '' };
    const orderItemPids = new Set(o.items.map(it => it.productId).filter(Boolean));
    const a = await mintsoftGet(`/api/Order/${encodeURIComponent(o.id)}/Allocations`, apiKey);
    const allocs = Array.isArray(a.body) ? a.body : [];
    const allocPids = new Set(allocs.map(al => al.ProductId));
    const bundleParents = o.items.filter(it => it.productId && !allocPids.has(it.productId)).map(it => it.sku);
    const covered = {}; // productId → allocated qty

    for (const al of allocs) {
      const pid = al.ProductId;
      const qty = al.Quantity || 0;
      if (!pid || qty <= 0) continue;
      const p   = await resolveProduct(pid);
      const loc = locDir[al.LocationId] || { name: `Loc#${al.LocationId}`, type: '' };
      const via = orderItemPids.has(pid) ? null : (bundleParents[0] || null);
      bump(p.sku, p.name, qty, o.ref, via, loc);
      covered[pid] = (covered[pid] || 0) + qty;
    }

    // Any order-line quantity not covered by an allocation → needed but unlocated.
    for (const it of o.items) {
      const need = it.qty - (covered[it.productId] || 0);
      if (need > 0) bump(it.sku, '', need, o.ref, null, null);
    }
  }

  return items;
}

// GET /api/replen?warehouseId=X&clientId=Y
async function handle(req, res, url, session) {
  if (!session.isWarehouse) return res.json(403, { error: 'Warehouse users only' });

  const warehouseId = url.searchParams.get('warehouseId');
  if (!warehouseId) return res.json(400, { error: 'warehouseId is required' });
  const clientId = url.searchParams.get('clientId') || null;

  const [rows, replenMap, awaitingItems] = await Promise.all([
    fetchLocationRows(session.apiKey, warehouseId, clientId),
    fetchReplenMap(session.apiKey),
    fetchAwaitingReplen(session.apiKey, warehouseId, clientId),
  ]);

  // Aggregate stock by SKU and location type.
  const pickFaces    = {};  // `${sku}|${loc}` → { sku, location, locationType, name, qty }
  const warehouseQty = {};  // sku → total units in PICK* + PALLET + BULK
  const bulkBySku    = {};  // sku → [{ location, qty }]
  const offhandBySku = {};  // sku → [{ location, type, qty }]
  const allLocBySku  = {};  // sku → [{ location, type, qty }] (any location with stock)
  const nameBySku    = {};

  for (const r of rows) {
    const sku = r.ProductSKU;
    const loc = r.Location;
    if (!sku || !loc || loc === 'UNASSIGNED') continue;
    const lt  = norm(r.LocationType);
    const qty = parseInt(r.Quantity, 10) || 0;
    if (r.ProductName) nameBySku[sku] = r.ProductName;
    if (qty > 0) (allLocBySku[sku] = allLocBySku[sku] || []).push({ location: loc, type: lt, qty });

    if (isPick(lt)) {
      const key = `${sku}|${loc}`;
      if (!pickFaces[key]) pickFaces[key] = { sku, location: loc, locationType: lt, name: r.ProductName || '', qty: 0 };
      pickFaces[key].qty += qty;
      warehouseQty[sku] = (warehouseQty[sku] || 0) + qty;
    } else if (isPallet(lt)) {
      warehouseQty[sku] = (warehouseQty[sku] || 0) + qty;
    } else if (isBulk(lt)) {
      // BULK is at the warehouse, so it counts toward warehouse stock for List 1,
      // and is also a replen source for List 2 (pick faces).
      warehouseQty[sku] = (warehouseQty[sku] || 0) + qty;
      (bulkBySku[sku] = bulkBySku[sku] || []).push({ location: loc, qty });
    } else if (isOffhand(lt)) {
      (offhandBySku[sku] = offhandBySku[sku] || []).push({ location: loc, type: lt, qty });
    }
  }

  // ── List 1: Off-Hand Storage Replen ──────────────────────────────────────
  // Warehouse stock (PICK+PALLET+BULK) below replen point, with off-hand stock to draw from.
  const offhandReplen = [];
  for (const sku of Object.keys(replenMap)) {
    const cfg   = replenMap[sku];
    const whQty = warehouseQty[sku] || 0;
    if (whQty >= cfg.replenPoint) continue;          // not running low
    const src = bestSource(offhandBySku[sku]);
    if (!src) continue;                              // nothing in off-hand storage to replen from
    const qtyToReplen = Math.max(0, cfg.size - whQty);
    offhandReplen.push({
      sku, name: cfg.name || nameBySku[sku] || '',
      warehouseQty: whQty, replenPoint: cfg.replenPoint, size: cfg.size, qtyToReplen,
      replenFrom: src.location, replenFromType: src.type, replenFromQty: src.qty,
      shortfall: Math.max(0, qtyToReplen - src.qty),
    });
  }

  // ── List 2: Pick Face Replen (from BULK) ─────────────────────────────────
  const pickReplen = [];
  for (const key of Object.keys(pickFaces)) {
    const face = pickFaces[key];
    const cfg  = replenMap[face.sku];
    if (!cfg) continue;
    if (face.qty > cfg.replenPoint) continue;        // pick face still above replen point
    const src = bestSource(bulkBySku[face.sku]);
    const qtyToReplen = Math.max(0, cfg.size - face.qty);
    pickReplen.push({
      sku: face.sku, name: face.name || cfg.name || '',
      pickLocation: face.location, pickType: face.locationType,
      currentQty: face.qty, replenPoint: cfg.replenPoint, size: cfg.size, qtyToReplen,
      replenFrom: src ? src.location : null, replenFromQty: src ? src.qty : 0,
      shortfall: src ? Math.max(0, qtyToReplen - src.qty) : qtyToReplen,
    });
  }

  // ── List 3: Awaiting Replen orders ───────────────────────────────────────
  // Products in orders with status "Awaiting Replen". Locations are the SPECIFIC
  // locations the order's stock is allocated from (from order Allocations) — not
  // every location that happens to hold the SKU.
  const awaitingReplen = Object.entries(awaitingItems).map(([sku, info]) => ({
    sku,
    name:       info.name || nameBySku[sku] || '',
    quantity:   info.qty,
    orderCount: info.orders.size,
    via:        Array.from(info.via || []),   // parent bundle SKU(s) this was expanded from
    locations:  Object.entries(info.locations || {})
      .map(([location, v]) => ({ location, type: v.type, qty: v.qty }))
      .sort((a, b) => b.qty - a.qty),
  })).sort((a, b) => a.sku.localeCompare(b.sku));

  offhandReplen.sort((a, b) => a.sku.localeCompare(b.sku));
  pickReplen.sort((a, b) => a.pickLocation.localeCompare(b.pickLocation));

  return res.json(200, {
    offhandReplen,
    pickReplen,
    awaitingReplen,
    meta: {
      offhand: { total: offhandReplen.length, shortfalls: offhandReplen.filter(t => t.shortfall > 0).length },
      pick: {
        total:      pickReplen.length,
        withSource: pickReplen.filter(t => t.replenFrom).length,
        noSource:   pickReplen.filter(t => !t.replenFrom).length,
      },
      awaiting: { total: awaitingReplen.length },
    },
  });
}

module.exports = { handle };
