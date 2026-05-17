// ─── server/reports/index.js ───────────────────────────────────────────────────
// Central report registry. To add a report: create its file, require it here,
// add one entry to REPORTS. Route /api/report/:name picks it up automatically.

const REPORTS = {
  // ── Inventory ──────────────────────────────────────────────────────────────
  'inventory-health-score': require('./inventory/health-score'),
  'inventory-snapshot':     require('./inventory/snapshot'),
  'inventory-aging':        require('./inventory/aging'),
  'sku-velocity':           require('./inventory/velocity'),
  'stockout-analysis':      require('./inventory/stockout-analysis'),
  'inventory-turnover':     require('./inventory/turnover'),
  // ── Operations ────────────────────────────────────────────────────────────
  'fulfillment':            require('./operations/fulfillment'),
  'receiving':              require('./operations/receiving'),
  'errors':                 require('./operations/errors'),

  // ── Financial ─────────────────────────────────────────────────────────────
  'profitability':          require('./financial/profitability'),
  'billing':                require('./financial/billing'),

  // ── Analytics ─────────────────────────────────────────────────────────────
  'best-sellers':           require('./analytics/best-sellers'),
  'sales-trend':            require('./analytics/sales-trend'),
  'forecasting':            require('./analytics/forecasting'),
};

async function handleReport(req, res, url, session) {
  const name = url.pathname.split('/').pop();
  const handler = REPORTS[name];
  if (!handler) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: `Unknown report: ${name}` }));
    return;
  }
  await handler.run(req, res, url, session);
}

function listReports() {
  return Object.entries(REPORTS).map(([id, r]) => ({
    id,
    title:       r.meta.title,
    description: r.meta.description,
    icon:        r.meta.icon,
    category:    r.meta.category || 'other',
    comingSoon:  r.meta.comingSoon || false,
    params:      r.meta.params || [],
  }));
}

module.exports = { handleReport, listReports };
