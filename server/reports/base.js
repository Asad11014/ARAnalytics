// ─── server/reports/base.js ───────────────────────────────────────────────────
// Shared utilities used by every report.
// Import this in each report file rather than duplicating logic.

const { mintsoftGet } = require('../mintsoft');

const PAGE_LIMIT = 100;  // Mintsoft hard cap
const ITEM_BATCH = 10;   // Concurrent order item fetches

// ── Date helpers ──────────────────────────────────────────────────────────────

function fmt(date) {
  return date.toISOString().split('T')[0];
}

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

// ── Data fetchers ─────────────────────────────────────────────────────────────

// Fetch all stock levels for a warehouse + client
async function fetchStock(apiKey, warehouseId, clientId) {
  let path = `/api/Product/StockLevels?WarehouseId=${encodeURIComponent(warehouseId)}`;
  if (clientId) path += `&ClientId=${encodeURIComponent(clientId)}`;

  const result = await mintsoftGet(path, apiKey);
  if (result.status !== 200) throw new Error(`Stock API error: ${result.status}`);

  const all = Array.isArray(result.body) ? result.body : [];
  return clientId ? all.filter(i => String(i.ClientId) === String(clientId)) : all;
}

// Fetch all orders (with items) for a date range, streaming progress via onProgress
async function fetchOrders(apiKey, warehouseId, clientId, fromDate, toDate, onProgress) {
  const allOrders = [];
  let pageNo = 1;
  const clientParam = clientId ? `&ClientId=${encodeURIComponent(clientId)}` : '';

  // Paginate through order headers
  while (true) {
    const path = `/api/Order/List?WarehouseId=${encodeURIComponent(warehouseId)}&SinceDespatchDate=${fromDate}T00:00:00&ToDate=${toDate}T23:59:59&Limit=${PAGE_LIMIT}&PageNo=${pageNo}${clientParam}`;
    const result = await mintsoftGet(path, apiKey);
    if (result.status !== 200) throw new Error(`Orders API error: ${result.status} on page ${pageNo}`);

    const batch = Array.isArray(result.body) ? result.body : [];
    allOrders.push(...batch);

    if (onProgress) onProgress({ stage: 'orders', page: pageNo, total: allOrders.length });
    if (batch.length < PAGE_LIMIT) break;
    pageNo++;
    if (pageNo > 200) break;
  }

  // Fetch order items in batches
  for (let i = 0; i < allOrders.length; i += ITEM_BATCH) {
    const batch = allOrders.slice(i, i + ITEM_BATCH);
    await Promise.all(batch.map(async (order) => {
      const id = order.ID || order.Id;
      if (!id) return;
      const r = await mintsoftGet(`/api/Order/${id}`, apiKey);
      if (r.status === 200 && r.body.OrderItems) order.OrderItems = r.body.OrderItems;
    }));
    if (onProgress) onProgress({ stage: 'items', done: Math.min(i + ITEM_BATCH, allOrders.length), total: allOrders.length });
  }

  return allOrders;
}

// ── SKU aggregation ───────────────────────────────────────────────────────────

// Build a map of { sku → totalUnitsSold } from an orders array
function buildSkuSales(orders) {
  const sales = {};
  for (const order of orders) {
    for (const item of (order.OrderItems || [])) {
      const sku = item.SKU || item.Sku || '';
      const qty = item.Quantity || 0;
      if (sku && qty) sales[sku] = (sales[sku] || 0) + qty;
    }
  }
  return sales;
}

// Build a map of { sku → [ { date, qty } ] } for time-series analysis
function buildSkuDailySales(orders) {
  const daily = {};
  for (const order of orders) {
    const date = (order.DespatchDate || order.OrderDate || '').split('T')[0];
    for (const item of (order.OrderItems || [])) {
      const sku = item.SKU || item.Sku || '';
      const qty = item.Quantity || 0;
      if (!sku || !qty || !date) continue;
      if (!daily[sku]) daily[sku] = {};
      daily[sku][date] = (daily[sku][date] || 0) + qty;
    }
  }
  return daily;
}

// ── SSE helpers ───────────────────────────────────────────────────────────────

// Start an SSE response and return a send() helper
function startSSE(res) {
  res.writeHead(200, {
    'Content-Type':  'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection':    'keep-alive',
    'Access-Control-Allow-Origin': '*'
  });
  return (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);
}

// Parse common report query params from a URL
function parseReportParams(url, session) {
  return {
    warehouseId: url.searchParams.get('warehouseId'),
    clientId:    url.searchParams.get('clientId') || session.clientId,
    dateFrom:    url.searchParams.get('dateFrom'),
    dateTo:      url.searchParams.get('dateTo'),
    days:        parseInt(url.searchParams.get('days') || '30'),
  };
}

// Fetch product name map { sku → name } from the product catalogue.
// clientId=null fetches across all clients (warehouse context).
async function fetchProductNames(apiKey, warehouseId, clientId) {
  const names = {};
  let pageNo = 1;
  const clientParam = clientId ? `&ClientId=${encodeURIComponent(clientId)}` : '';

  while (true) {
    const path = `/api/Product/List?WarehouseId=${encodeURIComponent(warehouseId)}&PageNo=${pageNo}&Limit=${PAGE_LIMIT}${clientParam}`;
    const result = await mintsoftGet(path, apiKey);
    if (result.status !== 200) break;

    const batch = Array.isArray(result.body) ? result.body : [];
    if (!batch.length) break;

    for (const p of batch) {
      const sku  = p.SKU || p.Sku || '';
      const name = p.Name || p.Description || '';
      if (sku && name) names[sku] = name;
    }

    if (batch.length < PAGE_LIMIT) break;
    pageNo++;
    if (pageNo > 200) break;
  }

  return names;
}

// Fetch unconfirmed invoice summary for a single client (current period accruals)
async function fetchUnconfirmedInvoiceSummary(apiKey, clientId, fromDate, toDate) {
  const path = `/api/Account/Invoice/GetUnconfirmedInvoiceSummary?clientID=${encodeURIComponent(clientId)}&fromDate=${fromDate}&toDate=${toDate}`;
  try {
    const result = await mintsoftGet(path, apiKey);
    return result.status === 200 ? result.body : null;
  } catch {
    return null;
  }
}

// Fetch order headers only (no per-order item detail) — faster, used for dashboard counts
async function fetchOrderHeaders(apiKey, warehouseId, clientId, fromDate, toDate) {
  const allOrders = [];
  let pageNo = 1;
  const clientParam = clientId ? `&ClientId=${encodeURIComponent(clientId)}` : '';

  while (true) {
    const path = `/api/Order/List?WarehouseId=${encodeURIComponent(warehouseId)}&SinceDespatchDate=${fromDate}T00:00:00&ToDate=${toDate}T23:59:59&Limit=${PAGE_LIMIT}&PageNo=${pageNo}${clientParam}`;
    const result = await mintsoftGet(path, apiKey);
    if (result.status !== 200) throw new Error(`Orders API error: ${result.status} on page ${pageNo}`);

    const batch = Array.isArray(result.body) ? result.body : [];
    allOrders.push(...batch);
    if (batch.length < PAGE_LIMIT) break;
    pageNo++;
    if (pageNo > 200) break;
  }

  return allOrders;
}

module.exports = {
  fmt, daysAgo,
  fetchStock, fetchOrders, fetchOrderHeaders,
  fetchProductNames, fetchUnconfirmedInvoiceSummary,
  buildSkuSales, buildSkuDailySales,
  startSSE, parseReportParams
};
