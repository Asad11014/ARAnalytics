// ─── server/forecasting/demand.js ─────────────────────────────────────────────
// Build a clean per-SKU weekly demand series from order history. Gross basis
// (units ordered). Trade-aware: exceptional/pallet orders are de-peaked relative
// to each SKU's own order-size distribution, so regular bulk stays as baseline.
//
// Two exceptional-order signals (plan §4.1):
//   1. Statistical — line qty > median + k·MAD of the SKU's order-size distribution.
//   2. Courier — pallet orders almost always ship via a pallet courier (DTD) rather
//      than the usual parcel courier (APC / Royal Mail). Guarded so clients who ship
//      everything by pallet aren't stripped.
//
// See plan §3–§4.

const { query } = require('../db');

const DAY = 86400000;

// Monday (ISO) of the week containing d, as 'YYYY-MM-DD'.
function weekStart(d) {
  const date = new Date(d);
  const dow = (date.getUTCDay() + 6) % 7; // 0 = Monday
  const m = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - dow));
  return m.toISOString().slice(0, 10);
}

const median = arr => {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

// Robust spread: median + k·MAD threshold over a list of quantities.
function exceptionalThreshold(qtys, k) {
  if (qtys.length < 4) return Infinity; // too few to judge statistically — keep everything
  const med = median(qtys);
  const mad = median(qtys.map(q => Math.abs(q - med)));
  if (mad === 0) return Math.max(med * 3, med + 1); // degenerate spread fallback
  return med + k * 1.4826 * mad; // 1.4826 scales MAD to σ-equivalent
}

const isCancelled = s => /cancel|void/i.test(s || '');

// Returns { weeks:[mondays], skus:[{ sku, weekly:[...], totalUnits, exceptionalUnits,
//           exceptionalCount, palletCount, tradeUnits, tradeShare, firstSeen, lastSeen }] }
async function buildDemandSeries(clientId, cfg) {
  const windowStart = weekStart(Date.now() - cfg.historyWeeks * 7 * DAY);
  // Exclude the current (incomplete) week so the last bucket isn't artificially low.
  const lastMonday = weekStart(Date.now() - 7 * DAY);

  const rows = await query(
    `SELECT oi.sku AS sku, o.order_date::date AS d, oi.quantity AS qty,
            COALESCE(o.channel_name,'') AS channel,
            COALESCE(o.courier_service_name,'') AS courier,
            COALESCE(o.status_name,'') AS status
     FROM order_items oi
     JOIN orders o ON o.id = oi.order_id
     WHERE o.client_id = $1 AND o.order_date::date >= $2 AND o.order_date::date <= $3
       AND oi.quantity > 0`,
    [clientId, windowStart, lastMonday]
  );

  // Build the week calendar.
  const weeks = [];
  for (let t = new Date(windowStart).getTime(); t <= new Date(lastMonday).getTime(); t += 7 * DAY) {
    weeks.push(weekStart(t));
  }
  const weekIdx = Object.fromEntries(weeks.map((w, i) => [w, i]));

  const tradeChannels = (cfg.tradeChannels || []).map(c => c.toLowerCase());
  const isTrade = ch => {
    const c = (ch || '').toLowerCase();
    return tradeChannels.includes(c) || /b2b/.test(c);
  };
  const palletPats = (cfg.palletCouriers || []).map(p => p.toLowerCase());
  const isPalletCourier = co => {
    const c = (co || '').toLowerCase();
    return palletPats.some(p => c.includes(p)) || /pallet/.test(c);
  };

  // Group lines per SKU.
  const bySku = {};
  for (const r of rows) {
    if (isCancelled(r.status)) continue;
    (bySku[r.sku] = bySku[r.sku] || []).push(r);
  }

  const skus = [];
  for (const sku of Object.keys(bySku)) {
    const lines = bySku[sku];
    const qtys = lines.map(l => l.qty);
    const med = median(qtys);
    const thresh = exceptionalThreshold(qtys, cfg.exceptionalK);
    const statCap = Number.isFinite(thresh) ? thresh : Math.max(med, 1);

    // Courier signal only if pallet shipping is a *minority* for this SKU (otherwise
    // pallet IS this client's normal way of shipping and shouldn't be stripped).
    const palletLines = lines.filter(l => isPalletCourier(l.courier)).length;
    const usePalletSignal = palletLines > 0 && palletLines / lines.length < 0.5;
    const palletCap = Math.max(med, 1);

    const weekly = new Array(weeks.length).fill(0);
    const exceptionalWeekly = new Array(weeks.length).fill(0); // banked excess per week
    let totalUnits = 0, exceptionalUnits = 0, exceptionalCount = 0, palletCount = 0, tradeUnits = 0;
    let firstSeen = null, lastSeen = null;

    for (const l of lines) {
      const wi = weekIdx[weekStart(l.d)];
      if (wi === undefined) continue;
      totalUnits += l.qty;
      if (isTrade(l.channel)) tradeUnits += l.qty;
      if (!firstSeen || l.d < firstSeen) firstSeen = l.d;
      if (!lastSeen  || l.d > lastSeen)  lastSeen  = l.d;

      const palletExceptional = usePalletSignal && isPalletCourier(l.courier) && l.qty > palletCap;
      const statExceptional   = l.qty > thresh;

      if (statExceptional || palletExceptional) {
        // De-peak: contribute typical-order size to baseline, bank the excess.
        const cap = palletExceptional ? Math.min(statCap, palletCap) : statCap;
        const contribution = Math.min(l.qty, cap);
        const excess = l.qty - contribution;
        exceptionalCount++;
        if (palletExceptional) palletCount++;
        exceptionalUnits += excess;
        exceptionalWeekly[wi] += excess;
        weekly[wi] += contribution;
      } else {
        weekly[wi] += l.qty;
      }
    }

    skus.push({
      sku, weekly, exceptionalWeekly,
      totalUnits, exceptionalUnits: Math.round(exceptionalUnits), exceptionalCount, palletCount,
      tradeUnits, tradeShare: totalUnits ? +(tradeUnits / totalUnits).toFixed(2) : 0,
      firstSeen, lastSeen,
    });
  }

  return { weeks, skus };
}

module.exports = { buildDemandSeries, weekStart };
