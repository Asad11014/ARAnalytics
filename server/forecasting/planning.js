// ─── server/forecasting/planning.js ───────────────────────────────────────────
// Reorder & inventory planning math. Capital-efficient bias: hold the service
// level but lean toward less stock (round order qty down, cap cover). See §7.

const DAY = 86400000;
const addDays = (n) => new Date(Date.now() + n * DAY).toISOString().slice(0, 10);

// roundToMultiple: capital-efficient → round DOWN to the order multiple, but never
// below MOQ when an order is actually needed.
function roundOrderQty(raw, moq, multiple) {
  if (raw <= 0) return 0;
  let q = raw;
  if (multiple && multiple > 1) q = Math.floor(q / multiple) * multiple;
  if (q < moq) q = moq;                          // respect minimum order quantity
  if (multiple && multiple > 1 && q % multiple !== 0) q = Math.ceil(q / multiple) * multiple;
  return Math.round(q);
}

// params: { weeklyMean, weeklyErrStd, weeklyStd, leadDays, leadSpread, onHand, onOrder,
//           allocated, z, reviewDays, minWeeksCover, maxWeeksCover, moq, multiple }
function computePlan(p) {
  const dailyMean = p.weeklyMean / 7;
  // Demand uncertainty for safety stock = forecast error (out-of-sample), falling
  // back to raw demand spread when no backtest exists. This sizes buffer to how
  // wrong the forecast actually is, not how variable demand is.
  const weeklyErr = p.weeklyErrStd != null ? p.weeklyErrStd : (p.weeklyStd || 0);
  const dailyErr  = weeklyErr / 7;
  const LT = Math.max(0, p.leadDays);
  const leadStd = Math.max(0, p.leadSpread || 0);

  // Safety stock: combined forecast-error + lead-time variability over the lead time.
  const safetyStock = p.z * Math.sqrt(LT * dailyErr ** 2 + dailyMean ** 2 * leadStd ** 2);
  const reorderPoint = dailyMean * LT + safetyStock;

  const netPosition = (p.onHand || 0) + (p.onOrder || 0) - (p.allocated || 0);

  // Order-up-to level, capped at maxWeeksCover (capital efficiency).
  const upTo = dailyMean * (LT + p.reviewDays) + safetyStock;
  const cap  = dailyMean * 7 * p.maxWeeksCover;
  const targetLevel = Math.min(upTo, Math.max(cap, reorderPoint));

  const needOrder = netPosition <= reorderPoint && dailyMean > 0;
  const rawQty = needOrder ? Math.max(0, targetLevel - netPosition) : 0;
  const orderQty = needOrder ? roundOrderQty(rawQty, p.moq || 1, p.multiple || 1) : 0;

  // Timing.
  const weeksCover   = p.weeklyMean > 0 ? +(netPosition / p.weeklyMean).toFixed(2) : null;
  const daysToStockout = dailyMean > 0 ? netPosition / dailyMean : null;
  const stockoutDate = daysToStockout != null ? addDays(Math.max(0, Math.round(daysToStockout))) : null;
  // Order by when net position would fall to the reorder point.
  const daysToRop = dailyMean > 0 ? (netPosition - reorderPoint) / dailyMean : null;
  const orderByDate = needOrder
    ? addDays(0)
    : (daysToRop != null ? addDays(Math.max(0, Math.round(daysToRop))) : null);

  const flags = [];
  if (needOrder) flags.push('reorder');
  if (daysToStockout != null && daysToStockout <= LT) flags.push('stockout_risk');
  if (weeksCover != null && weeksCover > p.maxWeeksCover) flags.push('overstock');
  if (p.weeklyMean === 0 && (p.onHand || 0) > 0) flags.push('dead_stock');

  return {
    safetyStock: +safetyStock.toFixed(1),
    reorderPoint: +reorderPoint.toFixed(1),
    orderQty,
    orderByDate,
    stockoutDate,
    weeksCover,
    netPosition,
    flags,
  };
}

module.exports = { computePlan };
