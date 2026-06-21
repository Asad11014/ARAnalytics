// ─── server/forecasting/classify.js ───────────────────────────────────────────
// Demand-pattern classification (Syntetos–Boylan ADI / CV²). See plan §5.1.

const { mean } = require('./methods');

// series: per-period demand (oldest→newest), zero-filled.
function classify(series) {
  const n = series.length || 1;
  const nonzero = series.filter(v => v > 0);
  const periodsWithDemand = nonzero.length || 1;

  const adi = n / periodsWithDemand;                         // avg interval between demands
  const sizeMean = mean(nonzero);
  const sizeVar  = nonzero.length > 1
    ? nonzero.reduce((s, x) => s + (x - sizeMean) ** 2, 0) / (nonzero.length - 1)
    : 0;
  const cv2 = sizeMean > 0 ? sizeVar / (sizeMean ** 2) : 0;  // squared CV of demand sizes

  let demandClass;
  if (adi < 1.32 && cv2 < 0.49)      demandClass = 'smooth';
  else if (adi < 1.32 && cv2 >= 0.49) demandClass = 'erratic';
  else if (adi >= 1.32 && cv2 < 0.49) demandClass = 'intermittent';
  else                                demandClass = 'lumpy';

  return { demandClass, adi: +adi.toFixed(2), cv2: +cv2.toFixed(2) };
}

module.exports = { classify };
