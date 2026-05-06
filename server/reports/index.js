// ─── server/reports/index.js ──────────────────────────────────────────────────
// Central registry for all reports.
// To add a new report: create its file, import it here, add one line to REPORTS.
// The route /api/report/:name will automatically pick it up.

const replenishment = require('./replenishment');
const deadStock     = require('./dead-stock');
const overstock     = require('./overstock');
const bestSellers   = require('./best-sellers');
const salesTrend    = require('./sales-trend');

const REPORTS = {
  'replenishment': replenishment,
  'dead-stock':    deadStock,
  'overstock':     overstock,
  'best-sellers':  bestSellers,
  'sales-trend':   salesTrend,
};

// Route handler — called by server/index.js for GET /api/report/:name
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

// Returns the list of available reports (for the UI nav)
function listReports() {
  return Object.entries(REPORTS).map(([id, r]) => ({
    id,
    title:       r.meta.title,
    description: r.meta.description,
    icon:        r.meta.icon,
    params:      r.meta.params,
  }));
}

module.exports = { handleReport, listReports };
