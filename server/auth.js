// ─── server/auth.js ───────────────────────────────────────────────────────────
// Authenticates against Mintsoft; sessions stored in-memory.

const https  = require('https');
const crypto = require('crypto');
const { mintsoftGet } = require('./mintsoft');
const { runFullSync, runIncrementalSync } = require('./sync');
const { queryOne } = require('./db');

// In-memory session store: { sessionToken: { apiKey, clientId, username, ... } }
const sessions = {};
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

// ── Mintsoft Auth ─────────────────────────────────────────────────────────────

function mintsoftAuth(username, password) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ Username: username, Password: password });
    const options = {
      hostname: 'api.mintsoft.co.uk',
      path:     '/api/Auth',
      method:   'POST',
      headers: {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(body),
        'User-Agent':     'PFForecaster/2.0'
      }
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error(`Mintsoft auth failed: ${res.statusCode} — ${data}`));
          return;
        }
        try {
          const parsed = JSON.parse(data);
          const apiKey = typeof parsed === 'string'
            ? parsed
            : (parsed.ApiKey || parsed.apiKey || parsed.Token || parsed.token || parsed);
          if (!apiKey) { reject(new Error('No API key in Mintsoft response')); return; }
          resolve(String(apiKey).trim());
        } catch(e) {
          reject(new Error(`Failed to parse Mintsoft auth response: ${data}`));
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function fetchWarehouses(apiKey) {
  return new Promise((resolve) => {
    const options = {
      hostname: 'api.mintsoft.co.uk',
      path:     '/api/Warehouse',
      method:   'GET',
      headers:  { 'ms-apikey': apiKey, 'User-Agent': 'PFForecaster/2.0' }
    };
    console.log('  fetchWarehouses: GET /api/Warehouse');
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        console.log(`  fetchWarehouses: status=${res.statusCode} body=${data.substring(0, 150)}`);
        try {
          const parsed = JSON.parse(data);
          if (res.statusCode === 200 && Array.isArray(parsed)) {
            const warehouses = parsed.map(w => ({
              ID:   w.ID   || w.Id   || w.WarehouseId,
              Name: w.Name || w.WarehouseName || w.ShortName || String(w.ID || w.Id)
            })).filter(w => w.ID);
            console.log(`  ✓ ${warehouses.length} warehouse(s) found`);
            resolve(warehouses);
          } else {
            resolve([]);
          }
        } catch(e) { resolve([]); }
      });
    });
    req.on('error', () => resolve([]));
    req.end();
  });
}

// 200 on /api/Client = warehouse user; 401/403 = client user
function detectUserType(apiKey) {
  return new Promise((resolve) => {
    const options = {
      hostname: 'api.mintsoft.co.uk',
      path:     '/api/Client?limit=100',
      method:   'GET',
      headers:  { 'ms-apikey': apiKey, 'User-Agent': 'PFForecaster/2.0' }
    };
    console.log('  detectUserType: GET /api/Client?limit=100');
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        console.log(`  detectUserType: status=${res.statusCode} body=${data.substring(0, 150)}`);
        if (res.statusCode === 200) {
          try {
            const parsed     = JSON.parse(data);
            const clientArr  = Array.isArray(parsed) ? parsed : [];
            console.log(`  ✓ Warehouse user — ${clientArr.length} clients`);
            resolve({ isWarehouse: true, clients: clientArr });
          } catch(e) {
            resolve({ isWarehouse: true, clients: [] });
          }
        } else {
          console.log(`  Client user detected (status ${res.statusCode})`);
          resolve({ isWarehouse: false, clients: [] });
        }
      });
    });
    req.on('error', (e) => {
      console.log(`  detectUserType error: ${e.message}`);
      resolve({ isWarehouse: false, clients: [] });
    });
    req.end();
  });
}

function fetchClientProfile(apiKey) {
  return new Promise((resolve) => {
    const options = {
      hostname: 'api.mintsoft.co.uk',
      path:     '/api/ClientUser/Current',
      method:   'GET',
      headers:  { 'ms-apikey': apiKey, 'User-Agent': 'PFForecaster/2.0' }
    };
    console.log('  fetchClientProfile: GET /api/ClientUser/Current');
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        console.log(`  fetchClientProfile: status=${res.statusCode}`);
        if (res.statusCode !== 200) { resolve(null); return; }
        try { resolve(JSON.parse(data)); } catch(e) { resolve(null); }
      });
    });
    req.on('error', (e) => { console.log(`  fetchClientProfile error: ${e.message}`); resolve(null); });
    req.end();
  });
}

async function inferClientIdFromStock(apiKey, warehouseId) {
  try {
    const result = await mintsoftGet(
      `/api/Product/StockLevels?WarehouseId=${encodeURIComponent(warehouseId)}&Limit=1`,
      apiKey
    );
    if (result.status === 200 && Array.isArray(result.body) && result.body.length > 0) {
      return result.body[0].ClientId || result.body[0].clientId || null;
    }
  } catch (e) {
    console.log(`  inferClientIdFromStock failed: ${e.message}`);
  }
  return null;
}

// ── Session helpers ───────────────────────────────────────────────────────────

function createSession(apiKey, clientId, username, isWarehouse = false, clients = [], warehouses = []) {
  pruneExpiredSessions();
  const token = crypto.randomBytes(32).toString('hex');
  sessions[token] = {
    apiKey, clientId, username, isWarehouse,
    clients,    // [{ ID, Name }] for warehouse users
    warehouses, // [{ ID, Name }] for all users
    expiresAt: Date.now() + SESSION_TTL_MS
  };
  return token;
}

function getSessionFromToken(token) {
  if (!token) return null;
  const session = sessions[token];
  if (!session) return null;
  if (Date.now() > session.expiresAt) { delete sessions[token]; return null; }
  session.expiresAt = Date.now() + SESSION_TTL_MS;
  return session;
}

function pruneExpiredSessions() {
  const now = Date.now();
  for (const token in sessions) {
    if (now > sessions[token].expiresAt) delete sessions[token];
  }
}

function getTokenFromRequest(req) {
  const cookie = req.headers.cookie || '';
  const match  = cookie.match(/session=([a-f0-9]+)/);
  return match ? match[1] : null;
}

// ── Exported middleware + route handlers ──────────────────────────────────────

function getSession(req) {
  return getSessionFromToken(getTokenFromRequest(req));
}

function requireSession(req, res) {
  const session = getSession(req);
  if (!session) { res.json(401, { error: 'Not authenticated' }); return null; }
  return session;
}

// POST /api/login
async function login(req, res) {
  try {
    const { username, password } = await req.json();
    if (!username || !password) return res.json(400, { error: 'Username and password required' });

    console.log(`Login attempt: ${username}`);
    const apiKey = await mintsoftAuth(username, password);
    console.log(`✓ Mintsoft auth successful for ${username}`);

    const { isWarehouse, clients } = await detectUserType(apiKey);
    const warehouses = await fetchWarehouses(apiKey);

    let clientId = null;
    if (!isWarehouse) {
      const profile = await fetchClientProfile(apiKey);
      if (profile && typeof profile === 'object') {
        clientId = profile.ClientId || profile.clientId || profile.ClientID
          || profile.client_id || profile.Client?.ID || profile.Client?.Id || null;
        console.log(`  Profile keys: ${Object.keys(profile).join(', ')}, ClientId: ${clientId}`);
      }
      if (!clientId && warehouses.length > 0) {
        clientId = await inferClientIdFromStock(apiKey, warehouses[0].ID);
        if (clientId) console.log(`  ClientId inferred from stock: ${clientId}`);
      }
      if (!clientId) console.log('  WARNING: could not determine ClientId for client user');
    }

    const token = createSession(apiKey, clientId, username, isWarehouse, clients, warehouses);

    setImmediate(() => triggerBackgroundSync({ apiKey, username, isWarehouse }));

    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Set-Cookie':   `session=${token}; HttpOnly; SameSite=Strict; Max-Age=${SESSION_TTL_MS / 1000}; Path=/`
    });
    res.end(JSON.stringify({
      success:    true,
      username,
      clientId,
      isWarehouse,
      clients:    isWarehouse ? clients.map(c => ({ ID: c.ID || c.Id, Name: c.Name || c.ClientName || c.ShortName })) : [],
      warehouses,
    }));
  } catch (err) {
    console.error('Login error:', err.message);
    if (err.message.includes('401') || err.message.includes('auth failed')) {
      return res.json(401, { error: 'Invalid username or password' });
    }
    res.json(500, { error: 'Login failed — please try again' });
  }
}

async function triggerBackgroundSync({ apiKey, username, isWarehouse }) {
  try {
    // Check whether any previous sync has completed — if so, run incremental
    const lastJob = await queryOne(
      `SELECT id FROM sync_jobs WHERE status IN ('success','partial') ORDER BY completed_at DESC LIMIT 1`
    );
    if (!lastJob) {
      console.log(`[sync] No previous completed sync — running full sync for ${username}`);
      await runFullSync({ apiKey, triggeredBy: 'login' });
    } else {
      console.log(`[sync] Previous sync found — running incremental for ${username}`);
      await runIncrementalSync({ apiKey, triggeredBy: 'login' });
    }
  } catch (err) {
    console.error('[sync] Background sync error:', err.message);
  }
}

// POST /api/logout
function logout(req, res) {
  const token = getTokenFromRequest(req);
  if (token) delete sessions[token];
  res.writeHead(200, {
    'Content-Type': 'application/json',
    'Set-Cookie':   'session=; HttpOnly; Max-Age=0; Path=/'
  });
  res.end(JSON.stringify({ success: true }));
}

// GET /api/me
function me(req, res) {
  const session = getSession(req);
  if (!session) return res.json(401, { error: 'Not authenticated' });
  res.json(200, {
    username:    session.username,
    clientId:    session.clientId,
    isWarehouse: session.isWarehouse || false,
    clients:     session.clients     || [],
    warehouses:  session.warehouses  || []
  });
}

module.exports = { login, logout, me, getSession, requireSession };
