// ─── server/index.js ─────────────────────────────────────────────────────────
// Entry point. Responsible for routing only — no business logic lives here.

require('dotenv').config();

const http      = require('http');
const path      = require('path');
const fs        = require('fs');
const auth      = require('./auth');
const proxy     = require('./proxy');
const reports   = require('./reports/index');
const dashboard = require('./reports/dashboard');
const calendar    = require('./calendar');
const quotations  = require('./quotations');
const picklist    = require('./picklist');
const replen      = require('./replen');
const { ensureCoreSchema } = require('./schema');
const { runFullSync, runIncrementalSync, getSyncStatus } = require('./sync');
const { query, queryOne } = require('./db');
const { seedDemo } = require('./demo/seed-demo');

const DEMO_MODE = !!process.env.DEMO_MODE;

// Bootstrap schemas on startup; seed the demo dataset when running as a demo.
ensureCoreSchema()
  .then(() => Promise.all([
    calendar.ensureSchema(),
    quotations.ensureSchema(),
  ]))
  .then(() => { if (DEMO_MODE) return seedDemo(); })
  .catch(e => console.error('[schema] Bootstrap error:', e.message));

// ── Midnight cron ─────────────────────────────────────────────────────────────
// Nightly sync using the admin API key — rolling 7-day window + 90-day ASN window.
function scheduleMidnightSync() {
  const adminKey = process.env.MINTSOFT_ADMIN_KEY;
  if (!adminKey) {
    console.log('[cron] MINTSOFT_ADMIN_KEY not set — nightly sync disabled');
    return;
  }

  function msUntilMidnight() {
    const now  = new Date();
    const next = new Date(now);
    next.setHours(24, 0, 0, 0);
    return next - now;
  }

  function scheduleNext() {
    const delay = msUntilMidnight();
    console.log(`[cron] Next nightly sync in ${Math.round(delay / 60000)} minutes`);
    setTimeout(async () => {
      console.log('[cron] Running nightly incremental sync…');
      try {
        await runIncrementalSync({ apiKey: adminKey, triggeredBy: 'cron' });
      } catch (err) {
        console.error('[cron] Nightly sync error:', err.message);
      }
      scheduleNext();
    }, delay);
  }

  scheduleNext();
}

scheduleMidnightSync();

const DIST_DIR = path.join(__dirname, '../client/dist');
const PORT     = process.env.PORT || 3001;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // ── CORS ──────────────────────────────────────────────────────────────────
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, ms-apikey');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // ── Request helpers ───────────────────────────────────────────────────────
  req.json = () => new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => { try { resolve(JSON.parse(body)); } catch(e) { reject(e); } });
  });

  res.json = (status, data) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  };

  try {
    const { pathname } = url;

    // ── Auth routes ───────────────────────────────────────────────────────────
    if (pathname === '/api/login'      && req.method === 'POST') return auth.login(req, res);
    if (pathname === '/api/demo-login' && req.method === 'POST') return auth.demoLogin(req, res);
    if (pathname === '/api/logout'     && req.method === 'POST') return auth.logout(req, res);
    if (pathname === '/api/me'         && req.method === 'GET')  return auth.me(req, res);

    // ── Dashboard route ───────────────────────────────────────────────────────
    if (pathname === '/api/dashboard' && req.method === 'GET') {
      const session = auth.requireSession(req, res);
      if (!session) return;
      return dashboard.run(req, res, url, session);
    }

    // ── Report list ───────────────────────────────────────────────────────────
    if (pathname === '/api/reports' && req.method === 'GET') {
      const session = auth.requireSession(req, res);
      if (!session) return;
      return res.json(200, reports.listReports());
    }

    // ── Report data routes ────────────────────────────────────────────────────
    if (pathname.startsWith('/api/report/') && req.method === 'GET') {
      const session = auth.requireSession(req, res);
      if (!session) return;
      return reports.handleReport(req, res, url, session);
    }

    // ── Sync routes ───────────────────────────────────────────────────────────
    if (pathname === '/api/sync' && req.method === 'POST') {
      const session = auth.requireSession(req, res);
      if (!session) return;
      if (session.demo) return res.json(200, { ok: true, demo: true, message: 'Sync is disabled in the demo' });
      const body = await req.json().catch(() => ({}));
      const full = body.full !== false;
      res.json(200, { ok: true, message: full ? 'Full sync started' : 'Incremental sync started' });
      setImmediate(async () => {
        const fn = full ? runFullSync : runIncrementalSync;
        await fn({ apiKey: session.apiKey, triggeredBy: 'manual' });
      });
      return;
    }

    if (pathname === '/api/sync/status' && req.method === 'GET') {
      const session = auth.requireSession(req, res);
      if (!session) return;
      const status = await getSyncStatus();
      return res.json(200, status);
    }

    // ── Orders by client (for dashboard panel) ────────────────────────────────
    if (pathname === '/api/orders/by-client' && req.method === 'GET') {
      const session = auth.requireSession(req, res);
      if (!session) return;

      const msWarehouseId = url.searchParams.get('warehouseId');
      const dateFrom      = url.searchParams.get('dateFrom');
      const dateTo        = url.searchParams.get('dateTo');
      const statusParam   = url.searchParams.get('statuses') || '';
      const statuses      = statusParam.split(',').filter(Boolean);

      let sql = `
        SELECT o.client_id, c.name AS client_name, COUNT(*)::int AS order_count
        FROM orders o
        JOIN clients c ON o.client_id = c.id
        WHERE 1=1`;
      const p = [];

      if (msWarehouseId) sql += ` AND o.warehouse_id = $${p.push(parseInt(msWarehouseId))}`;
      if (dateFrom)      sql += ` AND o.order_date::date >= $${p.push(dateFrom)}`;
      if (dateTo)        sql += ` AND o.order_date::date <= $${p.push(dateTo)}`;
      if (statuses.length) sql += ` AND o.status_name = ANY($${p.push(statuses)})`;

      sql += ` GROUP BY o.client_id, c.name ORDER BY order_count DESC`;
      const rows = await query(sql, p);
      return res.json(200, { rows: rows.map(r => ({ ...r, client_id: r.client_id })) });
    }

    // ── Order statuses from DB ────────────────────────────────────────────────
    if (pathname === '/api/orders/statuses' && req.method === 'GET') {
      const session = auth.requireSession(req, res);
      if (!session) return;
      const rows = await query(
        `SELECT DISTINCT status_name FROM orders
         WHERE status_name IS NOT NULL
         ORDER BY status_name`
      );
      return res.json(200, { statuses: rows.map(r => r.status_name) });
    }

    // ── Calendar ASN sync (warehouse only, fast) ──────────────────────────────
    if (pathname === '/api/calendar/sync-asn' && req.method === 'POST') {
      const session = auth.requireSession(req, res);
      if (!session) return;
      if (session.demo) return res.json(200, { ok: true, demo: true, message: 'Sync is disabled in the demo' });
      if (!session.isWarehouse) return res.json(403, { error: 'Warehouse users only' });
      res.json(200, { ok: true, message: 'ASN sync started' });
      setImmediate(() =>
        runIncrementalSync({ apiKey: session.apiKey, triggeredBy: 'calendar-asn' })
          .catch(err => console.error('[calendar-asn sync]', err.message))
      );
      return;
    }

    // ── Calendar routes ───────────────────────────────────────────────────────
    if (pathname === '/api/calendar' && (req.method === 'GET' || req.method === 'POST')) {
      const session = auth.requireSession(req, res);
      if (!session) return;
      if (blockDemoWrite(session, req, res)) return;
      return calendar.handle(req, res, url, session, req.method, null);
    }
    const calEventMatch = pathname.match(/^\/api\/calendar\/(\d+)$/);
    if (calEventMatch && (req.method === 'PUT' || req.method === 'DELETE')) {
      const session = auth.requireSession(req, res);
      if (!session) return;
      if (blockDemoWrite(session, req, res)) return;
      return calendar.handle(req, res, url, session, req.method, calEventMatch[1]);
    }

    // ── Quotes ────────────────────────────────────────────────────────────────
    if (pathname === '/api/quotes' && (req.method === 'GET' || req.method === 'POST')) {
      const session = auth.requireSession(req, res);
      if (!session) return;
      if (blockDemoWrite(session, req, res)) return;
      try {
        return await quotations.handle(req, res, url, session, req.method);
      } catch (err) {
        return res.json(500, { error: err.message });
      }
    }

    // ── Pick list (warehouse only) ────────────────────────────────────────────
    if (pathname === '/api/picklist' && req.method === 'GET') {
      const session = auth.requireSession(req, res);
      if (!session) return;
      try {
        return await picklist.handle(req, res, url, session);
      } catch (err) {
        return res.json(500, { error: err.message });
      }
    }

    // ── Replenishment list (warehouse only) ───────────────────────────────────
    if (pathname === '/api/replen' && req.method === 'GET') {
      const session = auth.requireSession(req, res);
      if (!session) return;
      try {
        return await replen.handle(req, res, url, session);
      } catch (err) {
        return res.json(500, { error: err.message });
      }
    }

    // ── Pass-through proxy ────────────────────────────────────────────────────
    // Disabled entirely in demo: the demo has no Mintsoft credentials and must
    // never reach the live API.
    if (pathname.startsWith('/proxy/')) {
      if (DEMO_MODE) return res.json(403, { error: 'Disabled in demo' });
      return proxy.passThrough(req, res, url);
    }

    // ── SPA static serving (production build) ─────────────────────────────────
    if (req.method === 'GET') {
      const assetPath = path.join(DIST_DIR, pathname);
      if (fs.existsSync(assetPath) && fs.statSync(assetPath).isFile()) {
        const ext  = path.extname(pathname);
        const mime = {
          '.js': 'application/javascript', '.css': 'text/css',
          '.html': 'text/html', '.svg': 'image/svg+xml',
          '.ico': 'image/x-icon', '.png': 'image/png',
          '.woff2': 'font/woff2', '.woff': 'font/woff',
        }[ext] || 'application/octet-stream';
        return serveFile(res, assetPath, mime);
      }
      const indexPath = path.join(DIST_DIR, 'index.html');
      if (fs.existsSync(indexPath)) return serveFile(res, indexPath, 'text/html');
    }

    res.json(404, { error: 'Not found' });

  } catch (err) {
    console.error('Unhandled error:', err.message);
    res.json(500, { error: err.message });
  }
});

// Reject mutating requests for demo sessions. Returns true if the request was
// handled (blocked), false otherwise. GETs always pass through (read-only demo).
function blockDemoWrite(session, req, res) {
  if (session.demo && req.method !== 'GET') {
    res.json(403, { error: 'This is a read-only demo — changes are disabled.', demo: true });
    return true;
  }
  return false;
}

function serveFile(res, filePath, contentType) {
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
}

server.listen(PORT, () => {
  console.log(`\n✓ PF Forecaster running at http://localhost:${PORT}`);
  console.log(`  Login: http://localhost:${PORT}/\n`);
});
