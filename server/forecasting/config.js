// ─── server/forecasting/config.js ─────────────────────────────────────────────
// Engine defaults + layered config resolution (client → category → sku).
// See docs/forecasting-module-plan.html §9.

const { query } = require('../db');

// Per the confirmed decisions: 95% service level client-wide, gross demand,
// capital-efficient ordering, client-configured lead times.
const DEFAULTS = {
  serviceLevel:      0.95,   // → z ≈ 1.645
  demandBasis:       'gross',
  inventoryBias:     'capital',  // capital | availability — rounds order qty down
  grain:             'week',
  historyWeeks:      52,     // lookback window for fitting
  horizonWeeks:      12,     // how far ahead to forecast
  seasonality:       'auto',
  primaryMetric:     'wmape',
  // Trade handling
  tradeProfile:      'mixed',                 // retail | mixed | all-trade
  tradeChannels:     ['Manual Input', 'Amazon FBA', 'TikTok FBT'],  // + any *B2B*
  exceptionalK:      4.5,    // robust z (median + k·MAD) flag threshold for pallet/exceptional orders
  palletCouriers:    ['DTD'],  // pallet orders almost always ship via DTD (vs APC/Royal Mail) → exceptional
  // Ordering
  defaultLeadDays:   28,     // fallback when no supplier/SKU lead time configured
  defaultLeadSpread: 7,      // ± days variability fallback
  reviewDays:        7,      // periodic review cadence
  minWeeksCover:     2,      // don't recommend ordering above this much cover unnecessarily
  maxWeeksCover:     12,     // capital-efficiency cap on order-up-to
  defaultMoq:        1,      // minimum order quantity (override per supplier/SKU later)
  defaultMultiple:   1,      // order in multiples of (carton/pallet)
};

// z-score for a service level (one-sided). Small table; good enough for planning.
function serviceZ(sl) {
  const table = [[0.50,0],[0.80,0.84],[0.85,1.04],[0.90,1.28],[0.95,1.645],[0.975,1.96],[0.98,2.05],[0.99,2.33],[0.995,2.58]];
  let z = 1.645;
  for (const [p, zz] of table) if (sl >= p) z = zz;
  return z;
}

// Resolve effective config for a client (+ optional category/sku). Client scope
// only for MVP; category/sku overrides merge on top when present.
async function resolveConfig(clientId, { category, sku } = {}) {
  const rows = await query(
    `SELECT scope, scope_ref, settings FROM forecast_config WHERE client_id = $1`,
    [clientId]
  );
  let cfg = { ...DEFAULTS };
  const apply = (scope, ref) => {
    const r = rows.find(x => x.scope === scope && (ref == null ? x.scope_ref == null : x.scope_ref === ref));
    if (r && r.settings) cfg = { ...cfg, ...r.settings };
  };
  apply('client', null);
  if (category) apply('category', category);
  if (sku)      apply('sku', sku);
  return cfg;
}

module.exports = { DEFAULTS, serviceZ, resolveConfig };
