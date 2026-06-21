// ─── server/forecasting/engine.js ─────────────────────────────────────────────
// Orchestrates a forecast run for one client: build demand → classify → select &
// forecast → plan reorder → persist. See docs/forecasting-module-plan.html §10.

const { query, queryOne } = require('../db');
const { resolveConfig, serviceZ } = require('./config');
const { buildDemandSeries } = require('./demand');
const { classify } = require('./classify');
const { selectAndForecast } = require('./select');
const { computePlan } = require('./planning');
const { std, mean } = require('./methods');

const DAY = 86400000;
const SEASONAL_PERIOD = 52; // weekly seasonality (only used once ≥2yrs history exists)

// ── Reference data for a client ───────────────────────────────────────────────
async function loadStock(clientId) {
  const rows = await query(
    `SELECT sku, SUM(qty_on_hand)::int AS on_hand, SUM(qty_allocated)::int AS allocated
     FROM product_stock_levels WHERE client_id = $1 GROUP BY sku`, [clientId]);
  return Object.fromEntries(rows.map(r => [r.sku, r]));
}
async function loadOnOrder(clientId) {
  const rows = await query(
    `SELECT ai.sku AS sku, SUM(GREATEST(COALESCE(ai.expected_qty,0) - COALESCE(ai.received_qty,0), 0))::int AS on_order
     FROM asn_items ai JOIN asns a ON a.id = ai.asn_id
     WHERE a.client_id = $1 AND a.booked_in_date IS NULL
       AND COALESCE(a.status_name,'') !~* 'cancel'
     GROUP BY ai.sku`, [clientId]);
  return Object.fromEntries(rows.map(r => [r.sku, r.on_order]));
}
async function loadProducts(clientId) {
  const rows = await query(
    `SELECT sku, name, category, supplier, price, discontinued FROM products WHERE client_id = $1`, [clientId]);
  return Object.fromEntries(rows.map(r => [r.sku, r]));
}
async function loadLeadTimes(clientId) {
  const rows = await query(
    `SELECT supplier, sku, lt_days, lt_spread_days FROM supplier_lead_times WHERE client_id = $1`, [clientId]);
  const bySku = {}, bySupplier = {};
  for (const r of rows) {
    if (r.sku) bySku[r.sku] = r;
    else if (r.supplier) bySupplier[r.supplier] = r;
  }
  return { bySku, bySupplier };
}
// Future demand events (known trade/pallet orders + promotions) the warehouse has
// entered on behalf of the client. Past events are ignored (history is observed).
async function loadEvents(clientId) {
  const rows = await query(
    `SELECT sku, category, type, start_date, end_date, factor, qty
     FROM demand_events WHERE client_id = $1 AND COALESCE(end_date, start_date) >= CURRENT_DATE`, [clientId]);
  const bySku = {}, global = [];
  for (const r of rows) {
    if (r.sku) (bySku[r.sku] = bySku[r.sku] || []).push(r);
    else global.push(r);
  }
  return { bySku, global };
}

// Apply events to a weekly forecast array. `bucketDate(i)` → the Monday of forecast
// week i. trade_order adds known units to the covered weeks; promo scales them.
function applyEvents(weekly, bucketStart, events) {
  if (!events.length) return weekly;
  const out = weekly.slice();
  const wkStart = i => new Date(bucketStart.getTime() + i * 7 * 86400000);
  for (let i = 0; i < out.length; i++) {
    const ws = wkStart(i), we = new Date(ws.getTime() + 7 * 86400000);
    for (const e of events) {
      const s = new Date(e.start_date), en = e.end_date ? new Date(e.end_date) : s;
      const overlaps = s < we && en >= ws;
      if (!overlaps) continue;
      if (e.type === 'promo' && e.factor) out[i] *= +e.factor;
      else if (e.qty) {
        // Spread the known order quantity evenly across the weeks it spans.
        const spanWeeks = Math.max(1, Math.round((en - s) / (7 * 86400000)) + 1);
        out[i] += (+e.qty) / spanWeeks;
      }
    }
  }
  return out;
}

// ── Chunked multi-row insert ──────────────────────────────────────────────────
async function bulkInsert(table, columns, rows, chunk = 400) {
  for (let i = 0; i < rows.length; i += chunk) {
    const slice = rows.slice(i, i + chunk);
    const params = [];
    const values = slice.map(r => {
      const ph = columns.map(c => `$${params.push(r[c] === undefined ? null : r[c])}`);
      return `(${ph.join(',')})`;
    });
    await query(`INSERT INTO ${table} (${columns.join(',')}) VALUES ${values.join(',')}`, params);
  }
}

// ── Main run ──────────────────────────────────────────────────────────────────
async function runForecast(clientId) {
  const cfg = await resolveConfig(clientId);
  const z = serviceZ(cfg.serviceLevel);

  const run = await queryOne(
    `INSERT INTO forecast_runs (client_id, status) VALUES ($1, 'running') RETURNING id`, [clientId]);
  const runId = run.id;

  try {
    const [{ weeks, skus }, stock, onOrder, products, leads, events] = await Promise.all([
      buildDemandSeries(clientId, cfg), loadStock(clientId), loadOnOrder(clientId),
      loadProducts(clientId), loadLeadTimes(clientId), loadEvents(clientId),
    ]);

    const lastMonday = weeks[weeks.length - 1] || new Date().toISOString().slice(0, 10);
    const firstForecastMonday = new Date(new Date(lastMonday).getTime() + 7 * DAY);
    const bucketDate = i => new Date(new Date(lastMonday).getTime() + (i + 1) * 7 * DAY).toISOString().slice(0, 10);
    const weekDate   = i => weeks[i] || lastMonday;

    // Union of SKUs that have demand history or stock on hand.
    const demandBySku = Object.fromEntries(skus.map(s => [s.sku, s]));
    const allSkus = new Set([...skus.map(s => s.sku), ...Object.keys(stock)]);

    const resultRows = [], planRows = [], accuracyRows = [], accEval = [];
    let reorderCount = 0;

    for (const sku of allSkus) {
      const d = demandBySku[sku];
      const series = d ? d.weekly : new Array(weeks.length).fill(0);
      const prod = products[sku] || {};
      const st = stock[sku] || {};
      const onHand = st.on_hand || 0, allocated = st.allocated || 0, oo = onOrder[sku] || 0;

      const cls = classify(series);
      const fc = selectAndForecast(series, cls.demandClass, cfg.horizonWeeks, SEASONAL_PERIOD, cfg.primaryMetric);

      // Layer in known demand events (entered by the warehouse): trade/pallet orders
      // and promotions. These convert the unpredictable part of demand into knowns.
      const skuEvents = [...(events.bySku[sku] || []), ...events.global.filter(e => !e.category || e.category === prod.category)];
      const hasEvents = skuEvents.length > 0;
      fc.forecast = applyEvents(fc.forecast, firstForecastMonday, skuEvents);
      fc.lo = applyEvents(fc.lo, firstForecastMonday, skuEvents);
      fc.hi = applyEvents(fc.hi, firstForecastMonday, skuEvents);

      // Lead time: SKU override → supplier default → config default.
      const lt = leads.bySku[sku] || (prod.supplier && leads.bySupplier[prod.supplier]) || null;
      const leadDays   = lt ? lt.lt_days : cfg.defaultLeadDays;
      const leadSpread = lt ? (lt.lt_spread_days || 0) : cfg.defaultLeadSpread;

      // Demand mean over the lead+review window (what planning cares about).
      const coverWeeks = Math.max(1, Math.ceil((leadDays + cfg.reviewDays) / 7));
      const weeklyMean = mean(fc.forecast.slice(0, Math.min(coverWeeks, fc.forecast.length)));
      const weeklyStd  = std(series);

      const plan = computePlan({
        weeklyMean, weeklyErrStd: fc.errStd, weeklyStd, leadDays, leadSpread,
        onHand, onOrder: oo, allocated, z,
        reviewDays: cfg.reviewDays, minWeeksCover: cfg.minWeeksCover, maxWeeksCover: cfg.maxWeeksCover,
        moq: cfg.defaultMoq || 1, multiple: cfg.defaultMultiple || 1,
      });

      if (prod.discontinued && !plan.flags.includes('discontinued')) plan.flags.push('discontinued');
      if (d && d.exceptionalCount > 0) plan.flags.push('has_exceptional');
      if (hasEvents) plan.flags.push('has_events');
      if (plan.orderQty > 0) reorderCount++;

      // Forecast series rows.
      fc.forecast.forEach((v, i) => resultRows.push({
        run_id: runId, client_id: clientId, sku, grain: 'week', bucket_date: bucketDate(i),
        yhat: +v.toFixed(3), yhat_lo: +(fc.lo[i] ?? 0).toFixed(3), yhat_hi: +(fc.hi[i] ?? v).toFixed(3),
        method: fc.method,
      }));

      // Reorder plan row.
      planRows.push({
        run_id: runId, client_id: clientId, sku, name: prod.name || null,
        demand_class: cls.demandClass, method: fc.method,
        weekly_demand: +weeklyMean.toFixed(3), on_hand: onHand, on_order: oo, allocated,
        lead_days: leadDays, safety_stock: plan.safetyStock, reorder_point: plan.reorderPoint,
        order_qty: plan.orderQty, order_by_date: plan.orderByDate, stockout_date: plan.stockoutDate,
        weeks_cover: plan.weeksCover, wmape: fc.wmape, mase: fc.mase, bias: fc.bias,
        exceptional_units: d ? d.exceptionalUnits : 0, trade_share: d ? d.tradeShare : 0,
        price: prod.price != null ? prod.price : null,
        flags: JSON.stringify(plan.flags),
      });

      // Accuracy (backtest) rows. `exc..` = exceptional/pallet units that week — these
      // are known orders in practice (entered by the warehouse), so they carry no
      // forecast error but DO count toward total demand.
      for (const p of fc.backtest) {
        const exc = d ? (d.exceptionalWeekly[p.period] || 0) : 0;
        accuracyRows.push({
          client_id: clientId, sku, period: weekDate(p.period), method: fc.method,
          actual: +p.actual.toFixed(3), forecast: +p.forecast.toFixed(3),
          abs_err: +Math.abs(p.actual - p.forecast).toFixed(3),
        });
        accEval.push({ period: weekDate(p.period), baseActual: p.actual, forecast: p.forecast, exc });
      }
    }

    // Persist (accuracy is per-run-fresh: clear this client's prior backtest rows).
    await query(`DELETE FROM forecast_accuracy WHERE client_id = $1`, [clientId]);
    await bulkInsert('forecast_results', ['run_id','client_id','sku','grain','bucket_date','yhat','yhat_lo','yhat_hi','method'], resultRows);
    await bulkInsert('reorder_plan', ['run_id','client_id','sku','name','demand_class','method','weekly_demand','on_hand','on_order','allocated','lead_days','safety_stock','reorder_point','order_qty','order_by_date','stockout_date','weeks_cover','wmape','mase','bias','exceptional_units','trade_share','price','flags'], planRows);
    await bulkInsert('forecast_accuracy', ['client_id','sku','period','method','actual','forecast','abs_err'], accuracyRows);

    // Accuracy views (all = 1 − WMAPE on a rolling back-test):
    //  • wmape          — per-SKU weekly (harsh on sparse SKUs; shown for transparency).
    //  • portfolioWmape — catalogue total per week (SKU noise cancels).
    //  • horizonWmape   — catalogue total over the replenishment window (the planning number).
    //  • horizonWmapeWithEvents — same, but treating exceptional/pallet orders as KNOWN
    //    (entered by the warehouse): error is only on the statistical baseline, while the
    //    denominator is full demand. This is the accuracy clients see when the module is
    //    used as intended (known orders entered as demand events).
    const sumAbs = accuracyRows.reduce((s, r) => s + r.abs_err, 0);
    const sumAct = accuracyRows.reduce((s, r) => s + Math.abs(r.actual), 0);
    const periodAgg = {};            // period → { a: baseline, f: forecast, exc: known }
    for (const r of accEval) {
      const p = (periodAgg[r.period] = periodAgg[r.period] || { a: 0, f: 0, exc: 0 });
      p.a += r.baseActual; p.f += r.forecast; p.exc += r.exc;
    }
    let pAbs = 0, pAct = 0;
    for (const k in periodAgg) { pAbs += Math.abs(periodAgg[k].a - periodAgg[k].f); pAct += Math.abs(periodAgg[k].a); }

    const win = Math.max(1, Math.round(cfg.defaultLeadDays / 7));
    const periods = Object.keys(periodAgg).sort();
    let hAbs = 0, hAct = 0, hActTotal = 0;
    for (let i = 0; i + win <= periods.length; i += win) {
      let a = 0, f = 0, exc = 0;
      for (let j = i; j < i + win; j++) { const g = periodAgg[periods[j]]; a += g.a; f += g.f; exc += g.exc; }
      hAbs += Math.abs(a - f); hAct += Math.abs(a); hActTotal += Math.abs(a) + exc;
    }
    const stats = {
      skus: allSkus.size, reorderCount,
      wmape: sumAct > 0 ? +(sumAbs / sumAct).toFixed(3) : null,
      portfolioWmape: pAct > 0 ? +(pAbs / pAct).toFixed(3) : null,
      horizonWmape: hAct > 0 ? +(hAbs / hAct).toFixed(3) : null,
      horizonWmapeWithEvents: hActTotal > 0 ? +(hAbs / hActTotal).toFixed(3) : null,
      horizonWeeks: win,
      forecastRows: resultRows.length,
    };
    await query(`UPDATE forecast_runs SET status='done', stats=$1, finished_at=NOW() WHERE id=$2`,
      [JSON.stringify(stats), runId]);

    // Keep only the latest 5 runs per client.
    await query(
      `DELETE FROM forecast_runs WHERE client_id=$1 AND id NOT IN (
         SELECT id FROM forecast_runs WHERE client_id=$1 ORDER BY started_at DESC LIMIT 5)`, [clientId]);

    return { runId, ...stats };
  } catch (err) {
    await query(`UPDATE forecast_runs SET status='error', error=$1, finished_at=NOW() WHERE id=$2`,
      [err.message, runId]);
    throw err;
  }
}

module.exports = { runForecast };
