// ─── server/orders.js ─────────────────────────────────────────────────────────
// Fetches all orders for a date range using Mintsoft's Order/List endpoint.
// Handles pagination (max 100 per page) and order item fetching.

const { mintsoftGet } = require('./mintsoft');

const PAGE_LIMIT = 100;  // Mintsoft hard cap per page
const ITEM_BATCH = 10;   // Concurrent order item fetches

// ── Main export ───────────────────────────────────────────────────────────────

async function fetchAll(req, res, url, session) {
  const { apiKey, clientId: sessionClientId } = session;
  const warehouseId = url.searchParams.get('warehouseId');
  const fromDate    = url.searchParams.get('dateFrom');
  const toDate      = url.searchParams.get('dateTo');
  // Warehouse users pass clientId as query param; client users use session clientId
  const clientId    = url.searchParams.get('clientId') || sessionClientId;

  if (!warehouseId || !fromDate || !toDate) {
    return res.json(400, { error: 'Missing required params: warehouseId, dateFrom, dateTo' });
  }

  console.log(`\nFetching orders: ${fromDate} → ${toDate} | ClientId: ${clientId}`);

  // Use Server-Sent Events for live progress
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*'
  });

  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  try {
    const orders = await fetchAllOrders(apiKey, warehouseId, clientId, fromDate, toDate, send);
    send({ type: 'done', orders });
    res.end();
  } catch (err) {
    console.error('Orders error:', err.message);
    send({ type: 'error', message: err.message });
    res.end();
  }
}

// ── Internal helpers ──────────────────────────────────────────────────────────

async function fetchAllOrders(apiKey, warehouseId, clientId, fromDate, toDate, send) {
  const allOrders = [];
  let pageNo = 1;
  const clientParam = clientId ? `&ClientId=${encodeURIComponent(clientId)}` : '';

  // Step 1: Fetch all order headers via pagination
  while (true) {
    const path = `/api/Order/List?WarehouseId=${encodeURIComponent(warehouseId)}&SinceDespatchDate=${fromDate}T00:00:00&ToDate=${toDate}T23:59:59&Limit=${PAGE_LIMIT}&PageNo=${pageNo}${clientParam}`;

    const result = await mintsoftGet(path, apiKey);
    if (result.status !== 200) throw new Error(`Mintsoft API error ${result.status} on page ${pageNo}`);

    const batch = Array.isArray(result.body) ? result.body : (result.body.Orders || []);
    allOrders.push(...batch);

    console.log(`  Page ${pageNo}: ${batch.length} orders (total: ${allOrders.length})`);
    send({ type: 'progress', stage: 'orders', page: pageNo, total: allOrders.length });

    if (batch.length < PAGE_LIMIT) break;
    pageNo++;
    if (pageNo > 200) break; // safety cap at 20,000 orders
  }

  console.log(`  ✓ ${allOrders.length} orders — fetching items...`);

  // Step 2: Fetch order items in batches
  for (let i = 0; i < allOrders.length; i += ITEM_BATCH) {
    const batch = allOrders.slice(i, i + ITEM_BATCH);
    await Promise.all(batch.map(async (order) => {
      const orderId = order.ID || order.Id;
      if (!orderId) return;
      const result = await mintsoftGet(`/api/Order/${orderId}`, apiKey);
      if (result.status === 200 && result.body.OrderItems) {
        order.OrderItems = result.body.OrderItems;
      }
    }));

    const done = Math.min(i + ITEM_BATCH, allOrders.length);
    console.log(`  Items: ${done}/${allOrders.length}`);
    send({ type: 'progress', stage: 'items', done, total: allOrders.length });
  }

  console.log(`✓ Complete: ${allOrders.length} orders with items`);
  return allOrders;
}

module.exports = { fetchAll };
