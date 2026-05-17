// ─── server/reports/dashboard.js ──────────────────────────────────────────────
// Aggregated summary data for the home dashboard.
// Client users get their own inventory overview.
// Warehouse users get a cross-client performance view.

const {
  fetchStock, fetchOrders, fetchOrderHeaders,
  fetchProductNames, fetchUnconfirmedInvoiceSummary,
  buildSkuSales, buildSkuDailySales,
  fmt, daysAgo, startSSE
} = require('./base');

// ── Server-side cache ─────────────────────────────────────────────────────────
// Keyed by warehouseId:clientId:role — persists across page navigations.
// Pass ?refresh=true to bypass and force a fresh Mintsoft API fetch.
const CACHE_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours
const dashboardCache = new Map();

async function run(req, res, url, session) {
  const send = startSSE(res);
  const { apiKey, isWarehouse, clientId: sessionClientId, clients } = session;

  const warehouseId = url.searchParams.get('warehouseId');
  if (!warehouseId) {
    send({ type: 'error', message: 'warehouseId is required' });
    res.end();
    return;
  }

  const clientId = isWarehouse
    ? (url.searchParams.get('clientId') || null)
    : sessionClientId;

  const refresh  = url.searchParams.get('refresh') === 'true';
  const cacheKey = `${warehouseId}:${clientId || ''}:${isWarehouse ? 'wh' : 'cl'}`;

  // Cache hit — respond immediately without calling Mintsoft
  if (!refresh) {
    const cached = dashboardCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp) < CACHE_TTL_MS) {
      send({ type: 'done', ...cached.data, cachedAt: cached.cachedAt });
      res.end();
      return;
    }
  }

  try {
    const today   = new Date();
    const from30  = fmt(daysAgo(30));
    const from60  = fmt(daysAgo(60));
    const toDate  = fmt(today);
    const to30ago = fmt(daysAgo(31));

    let data;

    if (isWarehouse) {
      const from21 = fmt(daysAgo(21));

      send({ type: 'progress', message: 'Fetching stock levels…' });
      const stock = await fetchStock(apiKey, warehouseId, null);

      send({ type: 'progress', message: 'Fetching order volume (30 days)…' });
      const orders30 = await fetchOrderHeaders(apiKey, warehouseId, null, from30, toDate);

      send({ type: 'progress', message: 'Fetching order volume (previous month)…' });
      const ordersPrev = await fetchOrderHeaders(apiKey, warehouseId, null, from60, to30ago);

      // Full order items for 21-day stockout check and SKU name lookup
      send({ type: 'progress', message: 'Fetching recent sales detail (21 days)…' });
      const orders21 = await fetchOrders(
        apiKey, warehouseId, null, from21, toDate,
        (p) => send({ type: 'progress', message: p.stage === 'items' ? `Loading order items… ${p.done}/${p.total}` : `Fetching orders… page ${p.page}` })
      );

      // Fetch unconfirmed invoice summary per client in parallel (5 at a time)
      // This gives accrued charges for the current month before the invoice is finalised
      send({ type: 'progress', message: 'Fetching monthly revenue (invoice summaries)…' });
      const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
      const fromMonth    = fmt(startOfMonth);
      const clientInvoices = {};
      const INVOICE_BATCH  = 5;
      const allClients     = clients || [];
      for (let i = 0; i < allClients.length; i += INVOICE_BATCH) {
        await Promise.all(
          allClients.slice(i, i + INVOICE_BATCH).map(async (c) => {
            const cid = c.ID || c.id;
            if (!cid) return;
            const summary = await fetchUnconfirmedInvoiceSummary(apiKey, cid, fromMonth, toDate);
            if (summary) clientInvoices[String(cid)] = summary;
          })
        );
      }

      send({ type: 'progress', message: 'Fetching product catalogue…' });
      const skuNameMap = await fetchProductNames(apiKey, warehouseId, null);

      data = computeWarehouseDashboard(stock, orders30, ordersPrev, orders21, clientInvoices, allClients, skuNameMap);
    } else {
      send({ type: 'progress', message: 'Fetching stock levels…' });
      const stock = await fetchStock(apiKey, warehouseId, clientId);

      // If clientId was not set at login, infer it from the first stock item
      // (Mintsoft auto-scopes stock API responses to the caller's client)
      const effectiveClientId = clientId
        || (stock.length > 0 ? String(stock[0].ClientId || stock[0].clientId || '') : null)
        || null;

      send({ type: 'progress', message: 'Fetching orders (last 30 days)…' });
      const orders30 = await fetchOrders(
        apiKey, warehouseId, effectiveClientId, from30, toDate,
        (p) => send({ type: 'progress', message: p.stage === 'items' ? `Loading order items… ${p.done}/${p.total}` : `Fetching orders… page ${p.page}` })
      );

      send({ type: 'progress', message: 'Fetching previous period…' });
      const ordersPrev = await fetchOrderHeaders(apiKey, warehouseId, effectiveClientId, from60, to30ago);

      send({ type: 'progress', message: 'Fetching product catalogue…' });
      const skuNameMap = await fetchProductNames(apiKey, warehouseId, effectiveClientId);

      data = computeClientDashboard(stock, orders30, ordersPrev, skuNameMap);
    }

    const cachedAt = new Date().toISOString();
    dashboardCache.set(cacheKey, { data, cachedAt, timestamp: Date.now() });
    send({ type: 'done', ...data, cachedAt });
  } catch (err) {
    send({ type: 'error', message: err.message });
  }

  res.end();
}

// ── Client dashboard computation ───────────────────────────────────────────────

function computeClientDashboard(stock, orders30, ordersPrev, skuNameMap) {
  const skuSales30 = buildSkuSales(orders30);

  const units30    = Object.values(skuSales30).reduce((s, n) => s + n, 0);
  const unitsPrev  = sumOrderHeaderUnits(ordersPrev);

  // Stock classification
  let healthy = 0, lowStock = 0, overstock = 0, deadStock = 0, outOfStock = 0;
  const stockMap    = {};
  const reorderList = [];

  for (const item of stock) {
    const sku      = item.SKU || item.Sku || '';
    const qty      = item.Level || 0;
    const name     = item.Name || item.ProductName || skuNameMap[sku] || '';
    const sold30   = skuSales30[sku] || 0;
    const dailyVel = sold30 / 30;
    const cover    = dailyVel > 0 ? qty / dailyVel : (qty > 0 ? Infinity : 0);

    stockMap[sku] = { qty, sold30, cover, name };

    if (qty === 0 && sold30 > 0)       outOfStock++;
    else if (sold30 === 0 && qty > 0)  deadStock++;
    else if (cover < 14 && sold30 > 0) lowStock++;
    else if (cover > 90 && sold30 > 0) overstock++;
    else if (sold30 > 0)               healthy++;

    if ((cover < 14 || qty === 0) && sold30 > 0) {
      reorderList.push({
        sku, name,
        currentStock:   qty,
        sold30,
        coverDays:      cover === Infinity ? null : Math.round(cover),
        suggestedOrder: Math.max(0, Math.ceil(dailyVel * 60 - qty))
      });
    }
  }

  // Top products by units sold
  const topProducts = Object.entries(skuSales30)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10)
    .map(([sku, sold30]) => {
      const s = stockMap[sku] || { qty: 0, cover: 0, name: skuNameMap[sku] || '' };
      return {
        sku, sold30,
        name:         s.name || skuNameMap[sku] || sku,
        currentStock: s.qty,
        coverDays:    s.cover === Infinity ? null : (s.cover > 0 ? Math.round(s.cover) : 0)
      };
    });

  // Daily sales trend
  const dailySales  = buildSkuDailySales(orders30);
  const dailyTotals = {};
  for (const days of Object.values(dailySales)) {
    for (const [date, qty] of Object.entries(days)) {
      dailyTotals[date] = (dailyTotals[date] || 0) + qty;
    }
  }
  const salesTrend = Object.entries(dailyTotals)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, units]) => ({ date, units }));

  // Average days of cover (active SKUs only)
  const coverArr = Object.values(stockMap)
    .filter(s => s.sold30 > 0 && s.cover !== Infinity && s.cover > 0)
    .map(s => s.cover);
  const avgCoverDays = coverArr.length
    ? Math.round(coverArr.reduce((a, b) => a + b, 0) / coverArr.length)
    : null;

  return {
    kpis: {
      orders30:      orders30.length,
      ordersPrev:    ordersPrev.length,
      units30,
      unitsPrev,
      lowStockCount: lowStock + outOfStock,
      avgCoverDays,
      totalSkus:     stock.length
    },
    stockHealth: { healthy, lowStock, overstock, deadStock, outOfStock },
    salesTrend,
    topProducts,
    reorderList: reorderList
      .sort((a, b) => (a.coverDays ?? -1) - (b.coverDays ?? -1))
      .slice(0, 20)
  };
}

// ── Warehouse dashboard computation ───────────────────────────────────────────

function computeWarehouseDashboard(stock, orders30, ordersPrev, orders21, clientInvoices, clients, skuNameMap) {
  // Build activeSKUs from 21-day order items (stockout filter — names come from product catalogue)
  const activeSKUs = new Set();
  for (const order of orders21) {
    for (const item of (order.OrderItems || [])) {
      const sku = item.SKU || item.Sku || '';
      if (sku) activeSKUs.add(sku);
    }
  }

  // Per-client order counts (from 30-day headers)
  const clientOrders = {};
  for (const o of orders30) {
    const cid = String(o.ClientId || o.clientId || '');
    clientOrders[cid] = (clientOrders[cid] || 0) + 1;
  }

  // Per-client stock stats
  const clientStock = {};
  for (const item of stock) {
    const cid = String(item.ClientId || item.clientId || '');
    const sku = item.SKU || item.Sku || '';
    if (!clientStock[cid]) clientStock[cid] = { skus: 0, stockouts: 0 };
    clientStock[cid].skus++;
    if ((item.Level || 0) === 0 && activeSKUs.has(sku)) clientStock[cid].stockouts++;
  }

  // Client breakdown table (orders + health)
  const clientBreakdown = clients
    .filter(c => c.ID || c.id)
    .map(c => {
      const cid       = String(c.ID || c.id);
      const orders    = clientOrders[cid] || 0;
      const stockData = clientStock[cid] || { skus: 0, stockouts: 0 };
      return {
        id:            cid,
        name:          c.Name || c.name,
        orders30:      orders,
        skuCount:      stockData.skus,
        stockoutCount: stockData.stockouts,
        status:        stockData.stockouts > 5 ? 'critical' : stockData.stockouts > 0 ? 'attention' : 'healthy'
      };
    })
    .sort((a, b) => b.orders30 - a.orders30);

  // Stockout alerts — confirmed sales in last 21 days only
  const stockAlerts = stock
    .filter(item => {
      const sku = item.SKU || item.Sku || '';
      return (item.Level || 0) === 0 && activeSKUs.has(sku);
    })
    .map(item => {
      const sku = item.SKU || item.Sku || '';
      const cid = String(item.ClientId || item.clientId || '');
      return {
        clientId:   cid,
        clientName: clients.find(c => String(c.ID) === cid)?.Name || 'Unknown',
        sku,
        name:       item.Name || item.ProductName || skuNameMap[sku] || ''
      };
    });

  // Weekly order volume trend (~8-week view)
  const weeklyMap = {};
  for (const o of [...ordersPrev, ...orders30]) {
    const date = (o.DespatchDate || o.OrderDate || '').split('T')[0];
    if (!date) continue;
    const d   = new Date(date);
    const sun = new Date(d);
    sun.setDate(d.getDate() - d.getDay());
    const key = sun.toISOString().split('T')[0];
    weeklyMap[key] = (weeklyMap[key] || 0) + 1;
  }
  const weeklyTrend = Object.entries(weeklyMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([week, orders]) => ({ week, orders }));

  // Month-to-date revenue from unconfirmed invoice summaries (accrued charges, not yet billed)
  const monthlyRevenue = clients
    .filter(c => c.ID || c.id)
    .map(c => {
      const cid = String(c.ID || c.id);
      const inv = clientInvoices[cid] || {};

      // Sum all charge components from the unconfirmed invoice summary
      const revenue =
        (inv.PickingCost              || 0) +
        (inv.PostageCost              || 0) +
        (inv.ReworkCost               || 0) +
        (inv.PackagingCost            || 0) +
        (inv.GenericInvoiceItemsCost  || 0) +
        (inv.CollectionsCost          || 0) +
        (inv.ReturnsCost              || 0) +
        (inv.GoodsInCost              || 0) +
        (inv.StorageCost              || 0) +
        (inv.AdminFee                 || 0);

      return {
        id:       cid,
        name:     c.Name || c.name,
        revenue:  Math.round(revenue * 100) / 100,
        picking:  Math.round((inv.PickingCost             || 0) * 100) / 100,
        postage:  Math.round((inv.PostageCost             || 0) * 100) / 100,
        storage:  Math.round((inv.StorageCost             || 0) * 100) / 100,
        other:    Math.round(((inv.ReworkCost || 0) + (inv.PackagingCost || 0) + (inv.GenericInvoiceItemsCost || 0) + (inv.CollectionsCost || 0) + (inv.ReturnsCost || 0) + (inv.GoodsInCost || 0) + (inv.AdminFee || 0)) * 100) / 100,
      };
    })
    .filter(c => c.revenue > 0)
    .sort((a, b) => b.revenue - a.revenue);

  return {
    kpis: {
      totalClients:  clients.length,
      activeClients: Object.keys(clientOrders).length,
      totalOrders30: orders30.length,
      prevOrders:    ordersPrev.length,
      totalSkus:     stock.length,
      totalAlerts:   stockAlerts.length
    },
    clientBreakdown,
    stockAlerts,
    weeklyTrend,
    monthlyRevenue
  };
}

function sumOrderHeaderUnits(orders) {
  let total = 0;
  for (const o of orders) {
    for (const item of (o.OrderItems || [])) total += item.Quantity || 0;
  }
  return total;
}

module.exports = { run };
