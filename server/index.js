// ─── server/index.js ─────────────────────────────────────────────────────────
// Entry point. Responsible for routing only — no business logic lives here.

const http      = require('http');
const path      = require('path');
const fs        = require('fs');
const auth      = require('./auth');
const proxy     = require('./proxy');
const reports   = require('./reports/index');
const dashboard = require('./reports/dashboard');

const DIST_DIR = path.join(__dirname, '../client/dist');

const PORT = process.env.PORT || 3001;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // ── CORS ──────────────────────────────────────────────────────────────────
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
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
    if (pathname === '/api/login'  && req.method === 'POST') return auth.login(req, res);
    if (pathname === '/api/logout' && req.method === 'POST') return auth.logout(req, res);
    if (pathname === '/api/me'     && req.method === 'GET')  return auth.me(req, res);

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

    // ── Pass-through proxy ────────────────────────────────────────────────────
    if (pathname.startsWith('/proxy/')) return proxy.passThrough(req, res, url);

    // ── SPA static serving (production build) ─────────────────────────────────
    if (req.method === 'GET') {
      // Try to serve an exact static asset from dist first
      const assetPath = path.join(DIST_DIR, pathname);
      if (fs.existsSync(assetPath) && fs.statSync(assetPath).isFile()) {
        const ext = path.extname(pathname);
        const mime = {
          '.js': 'application/javascript', '.css': 'text/css',
          '.html': 'text/html', '.svg': 'image/svg+xml',
          '.ico': 'image/x-icon', '.png': 'image/png',
          '.woff2': 'font/woff2', '.woff': 'font/woff',
        }[ext] || 'application/octet-stream';
        return serveFile(res, assetPath, mime);
      }
      // SPA fallback — serve index.html for all unmatched GET routes
      const indexPath = path.join(DIST_DIR, 'index.html');
      if (fs.existsSync(indexPath)) return serveFile(res, indexPath, 'text/html');
    }

    res.json(404, { error: 'Not found' });

  } catch (err) {
    console.error('Unhandled error:', err.message);
    res.json(500, { error: err.message });
  }
});

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
