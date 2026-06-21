// ─── server/forecasting/methods.js ────────────────────────────────────────────
// Forecasting method library. Each method takes a numeric series (oldest→newest)
// and a horizon h, and returns an array of h point forecasts. See plan §5.2.

const mean = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0;
const std  = a => {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1));
};
const flat = (v, h) => Array.from({ length: h }, () => Math.max(0, v));

// ── Moving average ────────────────────────────────────────────────────────────
function movingAverage(series, h, window = 4) {
  const w = series.slice(-window);
  return flat(mean(w), h);
}

// ── Simple exponential smoothing (level only) ────────────────────────────────
function sesLevel(series, alpha) {
  let l = series[0] ?? 0;
  for (let i = 1; i < series.length; i++) l = alpha * series[i] + (1 - alpha) * l;
  return l;
}
function ses(series, h, alpha = autoAlpha(series, a => sesLevel(series, a))) {
  return flat(sesLevel(series, alpha), h);
}

// ── Holt (level + trend) ──────────────────────────────────────────────────────
function holtFit(series, alpha, beta) {
  let l = series[0] ?? 0;
  let b = (series[1] ?? l) - l;
  for (let i = 1; i < series.length; i++) {
    const prevL = l;
    l = alpha * series[i] + (1 - alpha) * (l + b);
    b = beta * (l - prevL) + (1 - beta) * b;
  }
  return { l, b };
}
function holt(series, h, alpha = 0.3, beta = 0.1) {
  const { l, b } = holtFit(series, alpha, beta);
  // Damp the trend slightly so it can't run away (capital-efficiency friendly).
  const phi = 0.9;
  let damp = 0;
  return Array.from({ length: h }, (_, i) => { damp += phi ** (i + 1); return Math.max(0, l + b * damp); });
}

// ── Holt-Winters additive (level + trend + seasonal) ─────────────────────────
function holtWinters(series, h, period, alpha = 0.3, beta = 0.05, gamma = 0.2) {
  if (!period || series.length < period * 2) return null; // not enough cycles
  const seasonalAvg = [];
  for (let p = 0; p < period; p++) {
    const vals = [];
    for (let i = p; i < series.length; i += period) vals.push(series[i]);
    seasonalAvg.push(mean(vals));
  }
  const overall = mean(series);
  let s = seasonalAvg.map(v => v - overall);       // additive seasonal components
  let l = mean(series.slice(0, period));
  let b = (mean(series.slice(period, period * 2)) - l) / period;
  for (let i = 0; i < series.length; i++) {
    const si = i % period;
    const prevL = l;
    l = alpha * (series[i] - s[si]) + (1 - alpha) * (l + b);
    b = beta * (l - prevL) + (1 - beta) * b;
    s[si] = gamma * (series[i] - l) + (1 - gamma) * s[si];
  }
  return Array.from({ length: h }, (_, i) => Math.max(0, l + b * (i + 1) + s[(series.length + i) % period]));
}

// ── Seasonal naïve ────────────────────────────────────────────────────────────
function seasonalNaive(series, h, period) {
  if (!period || series.length < period) return null;
  return Array.from({ length: h }, (_, i) => Math.max(0, series[series.length - period + (i % period)]));
}

// ── Croston / SBA (intermittent demand) ──────────────────────────────────────
function crostonRate(series, alpha) {
  let z = null, x = null, q = 1; // z=demand size, x=interval
  for (let i = 0; i < series.length; i++) {
    if (series[i] > 0) {
      if (z === null) { z = series[i]; x = q; }
      else { z = alpha * series[i] + (1 - alpha) * z; x = alpha * q + (1 - alpha) * x; }
      q = 1;
    } else { q++; }
  }
  if (z === null) return 0;
  return z / x; // demand per period
}
function croston(series, h, alpha = 0.1) { return flat(crostonRate(series, alpha), h); }
function sba(series, h, alpha = 0.1)     { return flat(crostonRate(series, alpha) * (1 - alpha / 2), h); }

// ── TSB (Teunter–Syntetos–Babai) ──────────────────────────────────────────────
// Like Croston but updates the *probability* of demand each period (not just on
// demand occurrences), so it decays toward zero for obsolescent / dying SKUs —
// well suited to discontinued lines. Rate = p · z.
function tsb(series, h, alpha = 0.2, beta = 0.1) {
  let z = null, p = 0;
  const first = series.findIndex(v => v > 0);
  if (first === -1) return flat(0, h);
  z = series[first];
  p = 1 / Math.max(1, first + 1);
  for (let i = 0; i < series.length; i++) {
    if (series[i] > 0) { z = z + alpha * (series[i] - z); p = p + beta * (1 - p); }
    else { p = p + beta * (0 - p); }
  }
  return flat(p * z, h);
}

// ── Helpers ──────────────────────────────────────────────────────────────────
// Grid-search alpha minimising in-sample one-step SSE for a level function.
function autoAlpha(series, levelAt) {
  let best = 0.3, bestErr = Infinity;
  for (let a = 0.1; a <= 0.9; a += 0.1) {
    let l = series[0] ?? 0, err = 0;
    for (let i = 1; i < series.length; i++) { err += (series[i] - l) ** 2; l = a * series[i] + (1 - a) * l; }
    if (err < bestErr) { bestErr = err; best = a; }
  }
  return best;
}

module.exports = { movingAverage, ses, holt, holtWinters, seasonalNaive, croston, sba, tsb, mean, std };
