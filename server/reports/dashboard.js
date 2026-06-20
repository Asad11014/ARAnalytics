// ─── server/reports/dashboard.js ──────────────────────────────────────────────
// Aggregated summary data for the home dashboard. Reads from PostgreSQL.

const { resolveIds, getStock, getOrders, getOrderHeaders, getSkuNames, getCurrentAccrualsMap } = require('./db-base');

const { buildSkuSales, buildSkuDailySales, fmt, daysAgo, startSSE } = require('./base');

const CACHE_TTL_MS = 30 * 60 * 1000;
const dashboardCache = new Map();

async function run(req, res, url, session) {
  const send = startSSE(res);
  const { isWarehouse, clientId: sessionMsClientId, clients } = session;

  const msWarehouseId = url.searchParams.get('warehouseId');
  if (!msWarehouseId) {
    send({ type: 'error', message: 'warehouseId is required' });
    res.end();
    return;
  }

  const msClientId = isWarehouse
    ? (url.searchParams.get('clientId') || null)
    : sessionMsClientId;

  // Comma-separated status filter, e.g. "Despatched,Invoiced"
  const statusParam = url.searchParams.get('statuses') || '';
  const statuses    = statusParam ? statusParam.split(',').filter(Boolean) : [];

  const refresh  = url.searchParams.get('refresh') === 'true';
  const cacheKey = `${msWarehouseId}:${msClientId || ''}:${isWarehouse ? 'wh' : 'cl'}:${statusParam}`;

  if (!refresh) {
    const cached = dashboardCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp) < CACHE_TTL_MS) {
      send({ type: 'done', ...cached.data, cachedAt: cached.cachedAt });
      res.end();
      return;
    }
  }

  try {
    const { warehouseId, clientId } = resolveIds(session, msWarehouseId, msClientId);
    if (!warehouseId) throw new Error('warehouseId is required');

    const today   = new Date();
    const from30  = fmt(daysAgo(30));
    const from60  = fmt(daysAgo(60));
    const toDate  = fmt(today);
    const to30ago = fmt(daysAgo(31));

    let data;

    if (isWarehouse && !msClientId) {
      send({ type: 'progress', message: 'Fetching stock levels…' });
      const stock = await getStock(warehouseId, null);

      send({ type: 'progress', message: 'Fetching order volume (30 days)…' });
      const orders30 = await getOrderHeaders(warehouseId, null, from30, toDate, { statuses });

      send({ type: 'progress', message: 'Fetching order volume (previous period)…' });
      const ordersPrev = await getOrderHeaders(warehouseId, null, from60, to30ago, { statuses });

      send({ type: 'progress', message: 'Fetching recent order detail (21 days)…' });
      const orders21 = await getOrders(warehouseId, null, fmt(daysAgo(21)), toDate, { statuses });

      send({ type: 'progress', message: 'Fetching current month revenue…' });
      const { map: clientInvoices, source: revenueSource } = await getCurrentAccrualsMap();

      send({ type: 'progress', message: 'Fetching product catalogue…' });
      const skuNameMap = await getSkuNames(warehouseId, null);

      data = computeWarehouseDashboard(stock, orders30, ordersPrev, orders21, clientInvoices, clients || [], skuNameMap, revenueSource);
    } else {
      const effectiveClientId = isWarehouse ? clientId : clientId;

      send({ type: 'progress', message: 'Fetching stock levels…' });
      const stock = await getStock(warehouseId, effectiveClientId);

      send({ type: 'progress', message: 'Fetching orders (last 30 days)…' });
      const orders30 = await getOrders(warehouseId, effectiveClientId, from30, toDate, { statuses });

      send({ type: 'progress', message: 'Fetching previous period…' });
      const ordersPrev = await getOrderHeaders(warehouseId, effectiveClientId, from60, to30ago, { statuses });

      send({ type: 'progress', message: 'Fetching product catalogue…' });
      const skuNameMap = await getSkuNames(warehouseId, effectiveClientId);

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

  const units30   = Object.values(skuSales30).reduce((s, n) => s + n, 0);
  const unitsPrev = sumOrderHeaderUnits(ordersPrev);

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

function computeWarehouseDashboard(stock, orders30, ordersPrev, orders21, clientInvoices, clients, skuNameMap, revenueSource = 'accrual') {
  const activeSKUs = new Set();
  for (const order of orders21) {
    for (const item of (order.OrderItems || [])) {
      const sku = item.SKU || item.Sku || '';
      if (sku) activeSKUs.add(sku);
    }
  }

  const clientOrders = {};
  for (const o of orders30) {
    const cid = String(o.ClientId || o.clientId || '');
    clientOrders[cid] = (clientOrders[cid] || 0) + 1;
  }

  const clientStock = {};
  for (const item of stock) {
    const cid = String(item.ClientId || item.clientId || '');
    const sku = item.SKU || item.Sku || '';
    if (!clientStock[cid]) clientStock[cid] = { skus: 0, stockouts: 0 };
    clientStock[cid].skus++;
    if ((item.Level || 0) === 0 && activeSKUs.has(sku)) clientStock[cid].stockouts++;
  }

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

  const weeklyMap = {};
  for (const o of [...ordersPrev, ...orders30]) {
    const date = (o.DespatchDate || o.OrderDate || '').slice(0, 10);
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

  const monthlyRevenue = clients
    .filter(c => c.ID || c.id)
    .map(c => {
      const cid = String(c.ID || c.id);
      const inv = clientInvoices[cid] || {};
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
        id:      cid,
        name:    c.Name || c.name,
        revenue: Math.round(revenue * 100) / 100,
        picking: Math.round((inv.PickingCost  || 0) * 100) / 100,
        postage: Math.round((inv.PostageCost  || 0) * 100) / 100,
        storage: Math.round((inv.StorageCost  || 0) * 100) / 100,
        other:   Math.round(((inv.ReworkCost || 0) + (inv.PackagingCost || 0) + (inv.GenericInvoiceItemsCost || 0) + (inv.CollectionsCost || 0) + (inv.ReturnsCost || 0) + (inv.GoodsInCost || 0) + (inv.AdminFee || 0)) * 100) / 100,
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
    monthlyRevenue,
    revenueSource
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
