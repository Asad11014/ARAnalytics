// End-of-Day Despatch Summary
// A snapshot of today's despatch activity — how busy the warehouse was.
// Counts orders despatched today per client, and consignments (parcels)
// per courier for the three carriers that matter operationally: Royal Mail,
// APC and FedEx. Royal Mail is almost always 1 parcel/order; APC and FedEx
// frequently split an order across multiple parcels, so their consignment
// total usually exceeds their order count.
//
// Data is fetched LIVE from Mintsoft (not the local DB) so the figures are
// accurate at the moment the report is run, regardless of last sync time.

const { mintsoftGet } = require('../../mintsoft');
const { startSSE }    = require('../base');

const meta = {
  title:       'End-of-Day Despatch',
  description: "Today's despatch activity — orders per client and consignments per courier.",
  icon:        '🚚',
  category:    'operations',
};

const PAGE_LIMIT = 100;

// Map a Mintsoft courier service name to one of the three tracked carriers.
// Returns null for couriers we don't report on.
function courierCategory(name) {
  if (!name) return null;
  const n = name.toLowerCase();
  if (n.startsWith('rm ') || n.includes('royal mail')) return 'Royal Mail';
  if (n.startsWith('apc'))                              return 'APC';
  if (n.includes('fedex'))                             return 'FedEx';
  return null;
}

// Local YYYY-MM-DD for "today" (server timezone).
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function run(req, res, url, session) {
  const send = startSSE(res);

  try {
    const warehouseId = url.searchParams.get('warehouseId');
    if (!warehouseId) throw new Error('warehouseId is required');

    const today = todayStr();

    // Client id → name map from the session
    const clientMap = {};
    for (const c of (session.clients || [])) {
      const id   = String(c.ID || c.Id || c.id || '');
      const name = c.Name || c.ClientName || c.ShortName || id;
      if (id) clientMap[id] = name;
    }

    // Fetch today's despatched orders live, paginated
    send({ type: 'progress', message: 'Fetching today’s despatched orders…' });
    const orders = [];
    let pageNo = 1;
    while (true) {
      const path = `/api/Order/List?WarehouseId=${encodeURIComponent(warehouseId)}`
        + `&SinceDespatchDate=${today}T00:00:00`
        + `&Limit=${PAGE_LIMIT}&PageNo=${pageNo}`;
      const r = await mintsoftGet(path, session.apiKey);
      if (r.status !== 200) throw new Error(`Mintsoft Order/List error: ${r.status}`);
      const batch = Array.isArray(r.body) ? r.body : [];
      orders.push(...batch);
      send({ type: 'progress', message: `Loaded ${orders.length} orders…` });
      if (batch.length < PAGE_LIMIT) break;
      pageNo++;
      if (pageNo > 200) break;
    }

    // Keep only orders actually despatched today (SinceDespatchDate is >=, so
    // guard against any edge rows whose despatch date isn't today).
    const despatchedToday = orders.filter(o => {
      const d = (o.DespatchDate || '').split('T')[0];
      return d === today;
    });

    // ── Aggregate by client ──────────────────────────────────────────────────
    const clientAgg = {};
    for (const o of despatchedToday) {
      const cid  = String(o.ClientId || o.ClientID || '');
      const name = clientMap[cid] || cid || 'Unknown';
      if (!clientAgg[cid]) clientAgg[cid] = { clientName: name, orders: 0, parcels: 0 };
      clientAgg[cid].orders  += 1;
      clientAgg[cid].parcels += (o.NumberOfParcels || 1);
    }
    const byClient = Object.values(clientAgg).sort((a, b) => b.orders - a.orders);

    // ── Aggregate by courier (Royal Mail / APC / FedEx only) ─────────────────
    const courierAgg = {
      'Royal Mail': { courier: 'Royal Mail', orders: 0, consignments: 0 },
      'APC':        { courier: 'APC',        orders: 0, consignments: 0 },
      'FedEx':      { courier: 'FedEx',      orders: 0, consignments: 0 },
    };
    let otherOrders = 0;
    for (const o of despatchedToday) {
      const cat = courierCategory(o.CourierServiceName);
      if (!cat) { otherOrders += 1; continue; }
      courierAgg[cat].orders       += 1;
      courierAgg[cat].consignments += (o.NumberOfParcels || 1);
    }
    const byCourier = Object.values(courierAgg);

    // ── ASNs booked in today ──────────────────────────────────────────────────
    send({ type: 'progress', message: 'Fetching ASNs booked in today…' });
    const asnRaw = [];
    let asnPage = 1;
    while (true) {
      const path = `/api/ASN/List?WarehouseId=${encodeURIComponent(warehouseId)}`
        + `&BookedInStartInterval=${today}T00:00:00`
        + `&BookedInEndInterval=${today}T23:59:59`
        + `&Limit=${PAGE_LIMIT}&PageNo=${asnPage}`;
      const r = await mintsoftGet(path, session.apiKey);
      if (r.status !== 200 || !Array.isArray(r.body)) break;
      asnRaw.push(...r.body);
      if (r.body.length < PAGE_LIMIT) break;
      asnPage++;
      if (asnPage > 100) break;
    }

    // Guard against any rows whose booked-in date isn't today.
    const bookedInToday = asnRaw.filter(a => (a.BookedInDate || '').split('T')[0] === today);
    const asns = bookedInToday.map(a => ({
      asnNumber:   a.ID,
      clientName:  clientMap[String(a.ClientId || '')] || a.CLIENTSHORTNAME || String(a.ClientId || ''),
      poReference: a.POReference || '',
      quantity:    a.Quantity || 0,
      status:      a.ASNStatus?.Name || '',
    })).sort((a, b) => a.clientName.localeCompare(b.clientName));

    // ── Totals ────────────────────────────────────────────────────────────────
    const totalOrders       = despatchedToday.length;
    const totalParcels       = despatchedToday.reduce((s, o) => s + (o.NumberOfParcels || 1), 0);
    const trackedConsignments = byCourier.reduce((s, c) => s + c.consignments, 0);

    send({
      type: 'done',
      date: today,
      byClient,
      byCourier,
      asns,
      meta: {
        totalOrders,
        totalParcels,
        activeClients: byClient.length,
        trackedConsignments,
        otherOrders,
        totalAsns: asns.length,
      },
    });
  } catch (err) {
    send({ type: 'error', message: err.message });
  }
  res.end();
}

module.exports = { meta, run };
