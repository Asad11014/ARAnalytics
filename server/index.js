// ─── server/index.js ─────────────────────────────────────────────────────────
// Entry point — creates the HTTP server and routes all incoming requests

const http    = require('http');
const path    = require('path');
const fs      = require('fs');
const auth    = require('./auth');
const orders  = require('./orders');
const stock   = require('./stock');
const proxy   = require('./proxy');

const PORT = process.env.PORT || 3001;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // ── CORS ──────────────────────────────────────────────────────────────────
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, ms-apikey');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // ── Helper to parse JSON body ─────────────────────────────────────────────
  req.json = () => new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => { try { resolve(JSON.parse(body)); } catch(e) { reject(e); } });
  });

  // ── Helper to send JSON response ──────────────────────────────────────────
  res.json = (status, data) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  };

  try {
    // ── Static files ─────────────────────────────────────────────────────────
    if (url.pathname === '/' || url.pathname === '/login') {
      return serveFile(res, path.join(__dirname, '../client/login.html'), 'text/html');
    }
    if (url.pathname === '/app') {
      // Protect app route — must have valid session
      const session = auth.getSession(req);
      if (!session) { res.writeHead(302, { Location: '/' }); res.end(); return; }
      return serveFile(res, path.join(__dirname, '../client/app.html'), 'text/html');
    }

    // ── Auth routes ───────────────────────────────────────────────────────────
    if (url.pathname === '/api/login'  && req.method === 'POST') return auth.login(req, res);
    if (url.pathname === '/api/logout' && req.method === 'POST') return auth.logout(req, res);
    if (url.pathname === '/api/me'     && req.method === 'GET')  return auth.me(req, res);

    // ── Data routes (session required) ────────────────────────────────────────
    if (url.pathname === '/api/orders-all' && req.method === 'GET') {
      const session = auth.requireSession(req, res);
      if (!session) return;
      return orders.fetchAll(req, res, url, session);
    }
    if (url.pathname === '/api/stock' && req.method === 'GET') {
      const session = auth.requireSession(req, res);
      if (!session) return;
      return stock.fetchLevels(req, res, url, session);
    }

    // ── Legacy proxy (pass-through for any other Mintsoft API calls) ──────────
    if (url.pathname.startsWith('/proxy/')) return proxy.passThrough(req, res, url);

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
  console.log(`\n✓ Mintsoft Replenishment Tool running at http://localhost:${PORT}`);
  console.log(`  Login page: http://localhost:${PORT}/`);
  console.log(`  App:        http://localhost:${PORT}/app\n`);
});
