// ─── server/index.js ─────────────────────────────────────────────────────────
// Entry point. Responsible for routing only — no business logic lives here.

const http    = require('http');
const path    = require('path');
const fs      = require('fs');
const auth    = require('./auth');
const proxy   = require('./proxy');
const reports = require('./reports/index');

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

    // ── Static files ─────────────────────────────────────────────────────────
    if (pathname === '/' || pathname === '/login') {
      return serveFile(res, path.join(__dirname, '../client/login.html'), 'text/html');
    }
    if (pathname === '/app') {
      const session = auth.getSession(req);
      if (!session) { res.writeHead(302, { Location: '/' }); res.end(); return; }
      return serveFile(res, path.join(__dirname, '../client/app/index.html'), 'text/html');
    }
    // Serve client-side report JS files
    if (pathname.startsWith('/reports/') && pathname.endsWith('.js')) {
      const file = path.join(__dirname, '../client', pathname);
      console.log(`Serving JS: ${pathname} → ${file}`);
      return serveFile(res, file, 'application/javascript');
    }

    // ── Auth routes ───────────────────────────────────────────────────────────
    if (pathname === '/api/login'  && req.method === 'POST') return auth.login(req, res);
    if (pathname === '/api/logout' && req.method === 'POST') return auth.logout(req, res);
    if (pathname === '/api/me'     && req.method === 'GET')  return auth.me(req, res);

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
