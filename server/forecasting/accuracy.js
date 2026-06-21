// ─── server/forecasting/accuracy.js ───────────────────────────────────────────
// Forecast accuracy metrics. See plan §8.2.

// pairs: [{ actual, forecast }]
function metrics(pairs) {
  const n = pairs.length;
  if (!n) return { wmape: null, mae: null, rmse: null, bias: null };
  let absErr = 0, sumActual = 0, sqErr = 0, signedErr = 0;
  for (const { actual, forecast } of pairs) {
    absErr   += Math.abs(actual - forecast);
    sqErr    += (actual - forecast) ** 2;
    signedErr += (forecast - actual);
    sumActual += Math.abs(actual);
  }
  return {
    wmape: sumActual > 0 ? +(absErr / sumActual).toFixed(3) : null,  // volume-weighted MAPE
    mae:   +(absErr / n).toFixed(2),
    rmse:  +Math.sqrt(sqErr / n).toFixed(2),
    bias:  +(signedErr / n).toFixed(2),                              // >0 = over-forecast
  };
}

// MASE scale = mean absolute one-step naïve error over the series.
function naiveScale(series) {
  let s = 0, c = 0;
  for (let i = 1; i < series.length; i++) { s += Math.abs(series[i] - series[i - 1]); c++; }
  return c ? s / c : 0;
}

module.exports = { metrics, naiveScale };
