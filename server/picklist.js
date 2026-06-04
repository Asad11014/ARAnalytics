// ─── server/picklist.js ───────────────────────────────────────────────────────
// Generates a pick list for ANY order, regardless of order status.
//
// Mintsoft refuses to produce a pick list for orders that aren't allocated
// (e.g. "Awaiting Replen"), because it relies on order→location allocations.
// We sidestep that by reading physical stock locations directly from the
// Products-In-Location report and matching them to the order's line items.
// This lets warehouse staff pick stock that physically exists even when
// Mintsoft won't allocate it.

const { mintsoftGet } = require('./mintsoft');

const PAGE_LIMIT = 100;

// Order location-types by picking preference (PICK bins first).
const LOCATION_TYPE_RANK = { 'PICK': 0, 'STORE': 1, 'BULK': 2, 'PALLET': 3, 'GOODS IN': 4 };

// Build a map of SKU → [{ location, locationType, quantity, batchNo, bestBefore }]
// for a warehouse + client, excluding unassigned/quarantine stock.
async function fetchLocationMap(apiKey, warehouseId, clientId) {
  const map = {};
  let pageNo = 1;
  while (true) {
    const path = `/api/Reports/ProductsInLocationReport`
      + `?warehouseId=${encodeURIComponent(warehouseId)}`
      + (clientId ? `&clientId=${encodeURIComponent(clientId)}` : '')
      + `&excludeQuarantine=true&limit=${PAGE_LIMIT}&pageNo=${pageNo}`;
    const r = await mintsoftGet(path, apiKey);
    if (r.status !== 200 || !Array.isArray(r.body)) break;
    const batch = r.body;

    for (const row of batch) {
      const sku = row.ProductSKU;
      const loc = row.Location;
      if (!sku || !loc || loc === 'UNASSIGNED') continue;
      if (!map[sku]) map[sku] = [];
      map[sku].push({
        location:     loc,
        locationType: row.LocationType || '',
        quantity:     parseInt(row.Quantity, 10) || 0,
        batchNo:      row.BatchNo || null,
        bestBefore:   row.BestBefore || null,
      });
    }

    if (batch.length < PAGE_LIMIT) break;
    pageNo++;
    if (pageNo > 200) break;
  }

  // Sort each SKU's locations: pick bins first, then by quantity descending.
  for (const sku of Object.keys(map)) {
    map[sku].sort((a, b) => {
      const ra = LOCATION_TYPE_RANK[a.locationType] ?? 9;
      const rb = LOCATION_TYPE_RANK[b.locationType] ?? 9;
      if (ra !== rb) return ra - rb;
      return b.quantity - a.quantity;
    });
  }
  return map;
}

// GET /api/picklist?orderNumber=XXXX
async function handle(req, res, url, session) {
  if (!session.isWarehouse) return res.json(403, { error: 'Warehouse users only' });

  const orderNumber = (url.searchParams.get('orderNumber') || '').trim();
  if (!orderNumber) return res.json(400, { error: 'orderNumber is required' });

  // 1. Look up the order (with items) by its number — exact match.
  const searchPath = `/api/Order/Search?OrderNumber=${encodeURIComponent(orderNumber)}`
    + `&exactMatch=true&includeOrderItems=true`;
  const searchRes = await mintsoftGet(searchPath, session.apiKey);
  if (searchRes.status !== 200) {
    return res.json(502, { error: `Mintsoft order search failed (${searchRes.status})` });
  }
  const orders = Array.isArray(searchRes.body) ? searchRes.body : [];
  const order  = orders.find(o => String(o.OrderNumber) === orderNumber) || orders[0];
  if (!order) return res.json(404, { error: `No order found with number "${orderNumber}"` });

  const warehouseId = order.WarehouseId;
  const clientId    = order.ClientId;
  const items       = order.OrderItems || [];

  // 2. Build the SKU → locations map for this order's warehouse + client.
  const locationMap = await fetchLocationMap(session.apiKey, warehouseId, clientId);

  // 3. Compose the pick list lines.
  const clientName = (session.clients || [])
    .find(c => String(c.ID || c.Id || c.id) === String(clientId))?.Name || '';

  const lines = items
    .filter(it => (it.Quantity || 0) > 0)
    .map(it => {
      const sku       = it.SKU || it.Sku || '';
      const locations = locationMap[sku] || [];
      return {
        sku,
        productId:    it.ProductId || null,
        name:         it.ProductName || it.Name || '',
        qtyRequired:  it.Quantity || 0,
        locations,                                   // [] when no physical stock found
        totalAvailable: locations.reduce((s, l) => s + l.quantity, 0),
      };
    })
    // Pickers walk the warehouse by location — order by primary bin.
    .sort((a, b) => {
      const la = a.locations[0]?.location || '~';
      const lb = b.locations[0]?.location || '~';
      return la.localeCompare(lb);
    });

  return res.json(200, {
    order: {
      id:           order.ID,
      orderNumber:  order.OrderNumber,
      statusId:     order.OrderStatusId,
      clientId,
      clientName,
      warehouseId,
      recipient:    [order.FirstName, order.LastName].filter(Boolean).join(' '),
      courier:      order.CourierServiceName || '',
      itemCount:    lines.length,
      totalUnits:   lines.reduce((s, l) => s + l.qtyRequired, 0),
    },
    lines,
  });
}

module.exports = { handle };
