// ─── server/forecast.js ───────────────────────────────────────────────────────
// Forecasting logic. Currently implements simple daily average (Level 1).
// Structured so that additional methods (weighted average, Holt-Winters etc.)
// can be dropped in without touching any other file.
//
// Each method receives: { orders, sku, windowDays }
// Each method returns:  { dailyVelocity, totalSold }

// ── Method: Simple daily average ─────────────────────────────────────────────
function simpleDailyAverage({ skuSales, sku, windowDays }) {
  const totalSold = skuSales[sku] || 0;
  const dailyVelocity = totalSold / windowDays;
  return { dailyVelocity, totalSold };
}

// ── Method: Weighted moving average (more recent = higher weight) ─────────────
// Splits the window into 3 equal thirds, weights them 1:2:3 (oldest to newest)
function weightedMovingAverage({ skuDailySales, sku, windowDays }) {
  const sales = skuDailySales[sku] || {};
  const dates = Object.keys(sales).sort();

  if (!dates.length) return { dailyVelocity: 0, totalSold: 0 };

  const totalSold = dates.reduce((sum, d) => sum + (sales[d] || 0), 0);
  const third = Math.ceil(dates.length / 3);

  const w1 = dates.slice(0, third).reduce((s, d) => s + (sales[d] || 0), 0) / (third || 1);
  const w2 = dates.slice(third, third * 2).reduce((s, d) => s + (sales[d] || 0), 0) / (third || 1);
  const w3 = dates.slice(third * 2).reduce((s, d) => s + (sales[d] || 0), 0) / (dates.slice(third * 2).length || 1);

  const dailyVelocity = (w1 * 1 + w2 * 2 + w3 * 3) / 6;
  return { dailyVelocity, totalSold };
}

// ── Method registry — add new methods here ────────────────────────────────────
const METHODS = {
  simple:   simpleDailyAverage,
  weighted: weightedMovingAverage,
  // 'holt-winters': holtWinters,  // add here when ready
};

// ── Build SKU sales map from orders ──────────────────────────────────────────
// Returns: { sku: totalUnits } for simple, { sku: { date: units } } for time-series methods
function buildSalesMaps(orders) {
  const skuSales = {};       // sku → total units (for simple average)
  const skuDailySales = {};  // sku → { date → units } (for time-series methods)

  for (const order of orders) {
    const items = order.OrderItems || [];
    const date = (order.DespatchDate || order.OrderDate || '').split('T')[0];

    for (const item of items) {
      const sku = item.SKU || item.Sku || item.sku;
      const qty = item.Quantity || item.quantity || 0;
      if (!sku || !qty) continue;

      skuSales[sku] = (skuSales[sku] || 0) + qty;

      if (date) {
        if (!skuDailySales[sku]) skuDailySales[sku] = {};
        skuDailySales[sku][date] = (skuDailySales[sku][date] || 0) + qty;
      }
    }
  }

  return { skuSales, skuDailySales };
}

// ── Main export ───────────────────────────────────────────────────────────────
// Calculates replenishment data for all SKUs given orders + stock + settings
function calculateReplenishment(orders, stockLevels, settings) {
  const { windowDays, coverageDays, leadTime, method = 'simple' } = settings;
  const forecastFn = METHODS[method] || METHODS.simple;
  const { skuSales, skuDailySales } = buildSalesMaps(orders);

  const results = [];

  for (const item of stockLevels) {
    const sku        = item.SKU || item.Sku || item.sku || '';
    const stockLevel = item.Level || item.StockLevel || 0;
    const name       = item.Name || item.ProductName || '';

    const { dailyVelocity, totalSold } = forecastFn({
      skuSales, skuDailySales, sku, windowDays
    });

    const daysRemaining = dailyVelocity > 0
      ? Math.round(stockLevel / dailyVelocity)
      : null; // null = no velocity, can't calculate

    // Order qty: enough stock to cover coverageDays AFTER order arrives
    // Formula: ((coverageDays + leadTime) × dailyVelocity) - currentStock
    const orderQty = Math.max(0, Math.ceil(
      (coverageDays + leadTime) * dailyVelocity - stockLevel
    ));

    // Only include SKUs with stock or sales activity
    if (stockLevel === 0 && totalSold === 0) continue;

    results.push({
      sku,
      name,
      stock:       stockLevel,
      totalSold,
      dailyVel:    Math.round(dailyVelocity * 100) / 100,
      daysLeft:    daysRemaining,
      leadTime,
      orderQty,
      forecastMethod: method
    });
  }

  // Sort: needs ordering first, then by urgency (fewest days remaining)
  results.sort((a, b) => {
    if (a.orderQty > 0 && b.orderQty === 0) return -1;
    if (b.orderQty > 0 && a.orderQty === 0) return 1;
    if (a.daysLeft === null) return 1;
    if (b.daysLeft === null) return -1;
    return a.daysLeft - b.daysLeft;
  });

  return results;
}

module.exports = { calculateReplenishment, METHODS };
