// SKU Velocity Report
// Ranks SKUs by movement speed — picks/day, orders/week, units/month.

const { resolveIds, getStock, getOrders, getSkuNames } = require('../db-base');
const { startSSE, parseReportParams } = require('../base');

const meta = {
  title:       'SKU Velocity',
  description: 'Rank every SKU by movement speed — picks per day, orders per week, and velocity class.',
  icon:        '⚡',
  category:    'inventory',
  params: [
    { id: 'days', label: 'Period (days)', type: 'number', default: 30 },
  ]
};

async function run(req, res, url, session) {
  const { warehouseId: msWarehouseId, clientId: msClientId, dateFrom, dateTo } = parseReportParams(url, session);
  const send = startSSE(res);

  try {
    const { warehouseId, clientId } = resolveIds(session, msWarehouseId, msClientId);
    if (!warehouseId) throw new Error('warehouseId is required');

    send({ type: 'progress', message: 'Fetching order history…' });
    const orders = await getOrders(warehouseId, clientId, dateFrom, dateTo);

    send({ type: 'progress', message: 'Fetching stock…' });
    const stock = await getStock(warehouseId, clientId);

    send({ type: 'progress', message: 'Fetching product names…' });
    const skuNameMap = await getSkuNames(warehouseId, clientId);

    const days = parseInt(url.searchParams.get('days') || '30');
    send({ type: 'progress', message: 'Calculating velocity…' });
    const rows = calculate(orders, stock, skuNameMap, days);

    const summary = {
      fast:   rows.filter(r => r.velocityClass === 'fast').length,
      medium: rows.filter(r => r.velocityClass === 'medium').length,
      slow:   rows.filter(r => r.velocityClass === 'slow').length,
      dead:   rows.filter(r => r.velocityClass === 'dead').length,
    };

    send({ type: 'done', rows, meta: summary });
  } catch (err) {
    send({ type: 'error', message: err.message });
  }
  res.end();
}

function calculate(orders, stock, skuNameMap, days) {
  const skuData  = {};
  const stockMap = {};

  for (const item of stock) {
    const sku = item.SKU || item.Sku || '';
    if (sku) stockMap[sku] = item.Level || 0;
  }

  for (const order of orders) {
    for (const item of (order.OrderItems || [])) {
      const sku = item.SKU || item.Sku || '';
      const qty = item.Quantity || 0;
      if (!sku || !qty) continue;
      if (!skuData[sku]) skuData[sku] = { units: 0, orders: new Set(), picks: 0 };
      skuData[sku].units += qty;
      skuData[sku].orders.add(order.OrderId || order.ID || '');
      skuData[sku].picks += 1;
    }
  }

  const weeks  = days / 7;
  const months = days / 30.44;

  const rows = Object.entries(skuData).map(([sku, d]) => {
    const picksPerDay   = round(d.picks       / days);
    const ordersPerWeek = round(d.orders.size / weeks);
    const unitsPerMonth = round(d.units       / months);

    let velocityClass;
    if (picksPerDay >= 5)      velocityClass = 'fast';
    else if (picksPerDay >= 1) velocityClass = 'medium';
    else if (picksPerDay > 0)  velocityClass = 'slow';
    else                       velocityClass = 'dead';

    return {
      sku,
      name:         skuNameMap[sku] || '',
      currentStock: stockMap[sku] ?? 0,
      totalUnits:   d.units,
      totalOrders:  d.orders.size,
      picksPerDay,
      ordersPerWeek,
      unitsPerMonth,
      velocityClass,
    };
  });

  for (const [sku, qty] of Object.entries(stockMap)) {
    if (!skuData[sku] && qty > 0) {
      rows.push({
        sku, name: skuNameMap[sku] || '', currentStock: qty,
        totalUnits: 0, totalOrders: 0,
        picksPerDay: 0, ordersPerWeek: 0, unitsPerMonth: 0,
        velocityClass: 'dead',
      });
    }
  }

  return rows.sort((a, b) => b.picksPerDay - a.picksPerDay);
}

const round = (n, dp = 2) => Math.round(n * 10 ** dp) / 10 ** dp;

module.exports = { meta, run };
