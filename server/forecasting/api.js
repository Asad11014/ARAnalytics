// ─── server/forecasting/api.js ────────────────────────────────────────────────
// HTTP handlers for the Inventory Planner (forecasting module).

const { query, queryOne } = require('./../db');
const { runForecast } = require('./engine');
const { DEFAULTS, resolveConfig } = require('./config');

// Resolve the target client: client users are locked to their own; warehouse
// users may pass ?clientId=.
function targetClient(url, session) {
  if (session.isWarehouse) {
    const c = url.searchParams.get('clientId');
    return c ? parseInt(c) : null;
  }
  return session.clientId ? parseInt(session.clientId) : null;
}

// Config is set up by warehouse staff on behalf of the client.
function bodyClient(body, url, session) {
  if (session.isWarehouse) return body.clientId ? parseInt(body.clientId) : targetClient(url, session);
  return session.clientId ? parseInt(session.clientId) : null;
}

// Whitelist of editable client-scope settings.
const SETTING_KEYS = [
  'serviceLevel', 'demandBasis', 'inventoryBias', 'historyWeeks', 'horizonWeeks',
  'tradeProfile', 'exceptionalK', 'defaultLeadDays', 'defaultLeadSpread', 'reviewDays',
  'minWeeksCover', 'maxWeeksCover', 'defaultMoq', 'defaultMultiple',
];

// GET /api/forecasting/plan — latest run's reorder plan + run meta.
async function plan(req, res, url, session) {
  const clientId = targetClient(url, session);
  if (!clientId) return res.json(400, { error: 'clientId required' });

  const run = await queryOne(
    `SELECT id, status, stats, started_at, finished_at FROM forecast_runs
     WHERE client_id=$1 AND status='done' ORDER BY started_at DESC LIMIT 1`, [clientId]);
  if (!run) return res.json(200, { run: null, rows: [] });

  const rows = await query(
    `SELECT sku, name, demand_class, method, weekly_demand, on_hand, on_order, allocated,
            lead_days, safety_stock, reorder_point, order_qty, order_by_date, stockout_date,
            weeks_cover, wmape, flags
     FROM reorder_plan WHERE run_id=$1 ORDER BY (order_qty>0) DESC, weekly_demand DESC`, [run.id]);

  return res.json(200, { run, rows });
}

// GET /api/forecasting/forecast?sku= — forecast series + backtest for one SKU.
async function forecast(req, res, url, session) {
  const clientId = targetClient(url, session);
  const sku = url.searchParams.get('sku');
  if (!clientId || !sku) return res.json(400, { error: 'clientId and sku required' });

  const run = await queryOne(
    `SELECT id FROM forecast_runs WHERE client_id=$1 AND status='done' ORDER BY started_at DESC LIMIT 1`, [clientId]);
  if (!run) return res.json(200, { forecast: [], accuracy: [] });

  const [series, accuracy, planRow, history] = await Promise.all([
    query(`SELECT bucket_date, yhat, yhat_lo, yhat_hi, method FROM forecast_results
           WHERE run_id=$1 AND sku=$2 ORDER BY bucket_date`, [run.id, sku]),
    query(`SELECT period, actual, forecast, abs_err FROM forecast_accuracy
           WHERE client_id=$1 AND sku=$2 ORDER BY period`, [clientId, sku]),
    queryOne(`SELECT * FROM reorder_plan WHERE run_id=$1 AND sku=$2`, [run.id, sku]),
    // Weekly gross demand history (last 26 weeks) for the chart.
    query(
      `SELECT to_char(date_trunc('week', o.order_date), 'YYYY-MM-DD') AS week,
              SUM(oi.quantity)::int AS units
       FROM order_items oi JOIN orders o ON o.id = oi.order_id
       WHERE o.client_id=$1 AND oi.sku=$2
         AND o.order_date >= NOW() - INTERVAL '26 weeks'
         AND COALESCE(o.status_name,'') !~* 'cancel'
       GROUP BY 1 ORDER BY 1`, [clientId, sku]),
  ]);
  return res.json(200, { forecast: series, accuracy, plan: planRow, history });
}

// POST /api/forecasting/run — trigger a fresh run (warehouse only for now).
async function run(req, res, url, session) {
  if (!session.isWarehouse) return res.json(403, { error: 'Warehouse users only' });
  const body = await req.json().catch(() => ({}));
  const clientId = body.clientId ? parseInt(body.clientId) : targetClient(url, session);
  if (!clientId) return res.json(400, { error: 'clientId required' });
  const result = await runForecast(clientId);
  return res.json(200, { ok: true, ...result });
}

// GET /api/forecasting/config — current settings + defaults + lead times + events.
async function getConfig(req, res, url, session) {
  const clientId = targetClient(url, session);
  if (!clientId) return res.json(400, { error: 'clientId required' });
  const [row, leadTimes, events] = await Promise.all([
    queryOne(`SELECT settings FROM forecast_config WHERE client_id=$1 AND scope='client' AND scope_ref IS NULL`, [clientId]),
    query(`SELECT id, supplier, sku, lt_days, lt_spread_days FROM supplier_lead_times WHERE client_id=$1 ORDER BY supplier NULLS FIRST, sku NULLS FIRST`, [clientId]),
    query(`SELECT id, sku, category, type, start_date, end_date, factor, qty, note FROM demand_events WHERE client_id=$1 ORDER BY start_date DESC`, [clientId]),
  ]);
  const effective = await resolveConfig(clientId);
  return res.json(200, {
    settings: row?.settings || {},
    defaults: DEFAULTS,
    effective,
    leadTimes,
    events,
    canEdit: !!session.isWarehouse,
  });
}

// PUT /api/forecasting/config — save client-scope settings (warehouse only).
async function putConfig(req, res, url, session) {
  if (!session.isWarehouse) return res.json(403, { error: 'Warehouse users only' });
  const body = await req.json().catch(() => ({}));
  const clientId = bodyClient(body, url, session);
  if (!clientId) return res.json(400, { error: 'clientId required' });

  const incoming = body.settings || {};
  const clean = {};
  for (const k of SETTING_KEYS) if (incoming[k] !== undefined && incoming[k] !== null && incoming[k] !== '') clean[k] = incoming[k];

  await query(
    `INSERT INTO forecast_config (client_id, scope, scope_ref, settings, updated_at)
     VALUES ($1, 'client', NULL, $2, NOW())
     ON CONFLICT (client_id, scope, scope_ref) DO UPDATE SET settings=$2, updated_at=NOW()`,
    [clientId, JSON.stringify(clean)]
  );
  return res.json(200, { ok: true, settings: clean });
}

// POST /api/forecasting/lead-time — upsert a supplier/SKU lead time (warehouse only).
async function saveLeadTime(req, res, url, session) {
  if (!session.isWarehouse) return res.json(403, { error: 'Warehouse users only' });
  const body = await req.json().catch(() => ({}));
  const clientId = bodyClient(body, url, session);
  if (!clientId) return res.json(400, { error: 'clientId required' });
  const supplier = body.supplier?.trim() || null;
  const sku = body.sku?.trim() || null;
  if (!supplier && !sku) return res.json(400, { error: 'supplier or sku required' });
  const ltDays = parseInt(body.ltDays);
  if (!(ltDays >= 0)) return res.json(400, { error: 'ltDays must be a number' });
  const spread = body.ltSpreadDays != null ? parseInt(body.ltSpreadDays) : 0;
  const row = await queryOne(
    `INSERT INTO supplier_lead_times (client_id, supplier, sku, lt_days, lt_spread_days, updated_at)
     VALUES ($1,$2,$3,$4,$5,NOW())
     ON CONFLICT (client_id, supplier, sku) DO UPDATE SET lt_days=$4, lt_spread_days=$5, updated_at=NOW()
     RETURNING id, supplier, sku, lt_days, lt_spread_days`,
    [clientId, supplier, sku, ltDays, spread]
  );
  return res.json(200, { leadTime: row });
}

async function deleteLeadTime(req, res, url, session) {
  if (!session.isWarehouse) return res.json(403, { error: 'Warehouse users only' });
  const id = parseInt(url.searchParams.get('id'));
  if (!id) return res.json(400, { error: 'id required' });
  await query(`DELETE FROM supplier_lead_times WHERE id=$1`, [id]);
  return res.json(200, { ok: true });
}

// POST /api/forecasting/event — create a known demand event (warehouse only).
async function saveEvent(req, res, url, session) {
  if (!session.isWarehouse) return res.json(403, { error: 'Warehouse users only' });
  const body = await req.json().catch(() => ({}));
  const clientId = bodyClient(body, url, session);
  if (!clientId) return res.json(400, { error: 'clientId required' });
  const type = ['promo', 'trade_order', 'adjustment'].includes(body.type) ? body.type : 'trade_order';
  if (!body.startDate) return res.json(400, { error: 'startDate required' });
  const row = await queryOne(
    `INSERT INTO demand_events (client_id, sku, category, type, start_date, end_date, factor, qty, note, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id, sku, category, type, start_date, end_date, factor, qty, note`,
    [clientId, body.sku?.trim() || null, body.category?.trim() || null, type,
     body.startDate, body.endDate || null,
     body.factor != null && body.factor !== '' ? +body.factor : null,
     body.qty != null && body.qty !== '' ? parseInt(body.qty) : null,
     body.note?.trim() || null, session.username || null]
  );
  return res.json(201, { event: row });
}

async function deleteEvent(req, res, url, session) {
  if (!session.isWarehouse) return res.json(403, { error: 'Warehouse users only' });
  const id = parseInt(url.searchParams.get('id'));
  if (!id) return res.json(400, { error: 'id required' });
  await query(`DELETE FROM demand_events WHERE id=$1`, [id]);
  return res.json(200, { ok: true });
}

module.exports = {
  plan, forecast, run,
  getConfig, putConfig, saveLeadTime, deleteLeadTime, saveEvent, deleteEvent,
};
