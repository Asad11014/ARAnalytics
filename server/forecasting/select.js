// ─── server/forecasting/select.js ─────────────────────────────────────────────
// Candidate methods per demand class + rolling-origin backtest selection.
// Picks the method with the lowest WMAPE on out-of-sample one-step forecasts.
// See plan §5.3, §8.1.

const M = require('./methods');
const { metrics, naiveScale } = require('./accuracy');

// Candidate builders per demand class. Each candidate: { name, fn(train, h) }.
function candidatesFor(demandClass, period) {
  const base = [
    { name: 'moving_avg', fn: (s, h) => M.movingAverage(s, h, 4) },
    { name: 'ses',        fn: (s, h) => M.ses(s, h) },
  ];
  const trend    = { name: 'holt',          fn: (s, h) => M.holt(s, h) };
  const seasonal = { name: 'holt_winters',  fn: (s, h) => M.holtWinters(s, h, period) };
  const snaive   = { name: 'seasonal_naive', fn: (s, h) => M.seasonalNaive(s, h, period) };
  const croston  = { name: 'croston',       fn: (s, h) => M.croston(s, h) };
  const sba      = { name: 'sba',           fn: (s, h) => M.sba(s, h) };
  const tsb      = { name: 'tsb',           fn: (s, h) => M.tsb(s, h) };

  switch (demandClass) {
    case 'smooth':       return [...base, trend, seasonal, snaive];
    case 'erratic':      return [...base, trend];
    case 'intermittent': return [croston, sba, tsb, base[0]];
    case 'lumpy':        return [sba, croston, tsb, base[0]];
    default:             return base;
  }
}

// Rolling-origin one-step backtest. Returns null if the candidate can't produce
// forecasts across the evaluation window.
function backtest(series, fn) {
  const n = series.length;
  const origins = Math.min(8, Math.max(3, Math.floor(n / 3)));
  const start = n - origins;
  if (start < 2) return null;
  const pairs = [];
  for (let t = start; t < n; t++) {
    const train = series.slice(0, t);
    const f = fn(train, 1);
    if (!f || f[0] == null || Number.isNaN(f[0])) return null;
    pairs.push({ period: t, actual: series[t], forecast: f[0] });
  }
  return pairs;
}

// Choose the best method for a series. Returns { method, forecast, lo, hi, wmape,
// mase, bias, backtest: [{period, actual, forecast}] }.
function selectAndForecast(series, demandClass, horizon, period, primaryMetric = 'wmape') {
  const n = series.length;

  // Too little history → flat last-value / short MA.
  if (n < 4) {
    const v = M.mean(series.slice(-Math.min(3, n)));
    return {
      method: 'fallback_avg',
      forecast: Array.from({ length: horizon }, () => Math.max(0, v)),
      lo: Array.from({ length: horizon }, () => Math.max(0, v * 0.5)),
      hi: Array.from({ length: horizon }, () => v * 1.5),
      wmape: null, mase: null, bias: null, errStd: M.std(series), backtest: [],
    };
  }

  const candidates = candidatesFor(demandClass, period);
  let best = null;
  for (const c of candidates) {
    const pairs = backtest(series, c.fn);
    if (!pairs) continue;
    const m = metrics(pairs);
    if (m.wmape == null) continue;
    if (!best || m.wmape < best.score) best = { ...c, score: m.wmape, m, pairs };
  }
  // Fallback if nothing backtested cleanly.
  if (!best) {
    const c = candidates[0];
    const forecast = c.fn(series, horizon) || M.movingAverage(series, horizon, 4);
    return { method: c.name, forecast, lo: forecast.map(v => v * 0.6), hi: forecast.map(v => v * 1.4),
             wmape: null, mase: null, bias: null, errStd: M.std(series), backtest: [] };
  }

  // Final fit on the full series.
  const forecast = best.fn(series, horizon);
  const scale = naiveScale(series);
  const mase = scale > 0 ? +(best.m.mae / scale).toFixed(3) : null;

  // Residual spread of the *chosen* method's out-of-sample errors. This is the
  // forecast-error std that drives both the prediction band and safety stock —
  // far better than raw historical variance, which conflates signal and noise.
  const resStd = Math.sqrt(best.pairs.reduce((s, p) => s + (p.actual - p.forecast) ** 2, 0) / best.pairs.length);
  const lo = forecast.map(v => Math.max(0, v - 1.28 * resStd));
  const hi = forecast.map(v => v + 1.28 * resStd);

  return {
    method: best.name, forecast, lo, hi,
    wmape: best.m.wmape, mase, bias: best.m.bias, errStd: +resStd.toFixed(3),
    backtest: best.pairs,
  };
}

module.exports = { selectAndForecast, candidatesFor };
