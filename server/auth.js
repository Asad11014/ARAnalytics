// ─── server/auth.js ───────────────────────────────────────────────────────────
// Handles authentication against Mintsoft and server-side session management.
// Sessions are stored in memory — on a production server you'd swap this for
// Redis or a database, but for a single-server deploy this works fine.

const https   = require('https');
const crypto  = require('crypto');

const MINTSOFT_BASE = 'https://api.mintsoft.co.uk';

// In-memory session store: { sessionToken: { apiKey, clientId, username, expiresAt } }
const sessions = {};

// Sessions last 8 hours
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

// ── Mintsoft Auth ─────────────────────────────────────────────────────────────

function mintsoftAuth(username, password) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ Username: username, Password: password });
    const options = {
      hostname: 'api.mintsoft.co.uk',
      path: '/api/Auth',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'User-Agent': 'MexecoReplenishmentTool/1.0'
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
          // Mintsoft returns the API key as a plain string or in an object
          const apiKey = typeof parsed === 'string' ? parsed : (parsed.ApiKey || parsed.apiKey || parsed.Token || parsed.token || parsed);
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

// Fetch the list of warehouses this API key can access
function fetchWarehouses(apiKey) {
  return new Promise((resolve) => {
    const options = {
      hostname: 'api.mintsoft.co.uk',
      path: '/api/Warehouse',
      method: 'GET',
      headers: { 'ms-apikey': apiKey, 'User-Agent': 'MexecoReplenishmentTool/1.0' }
    };
    console.log('  fetchWarehouses: GET https://api.mintsoft.co.uk/api/Warehouse');
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

// Detect whether the logged-in user is a warehouse admin or a client user.
// Strategy: call a warehouse-only endpoint (/api/Client/List).
// 200 = warehouse user (can see all clients)
// 401/403 = client user (scoped to their own account)
function detectUserType(apiKey) {
  return new Promise((resolve) => {
    const options = {
      hostname: 'api.mintsoft.co.uk',
      path: '/api/Client?limit=100',
      method: 'GET',
      headers: { 'ms-apikey': apiKey, 'User-Agent': 'MexecoReplenishmentTool/1.0' }
    };
    console.log(`  detectUserType: GET https://api.mintsoft.co.uk/api/Client?limit=100`);
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        console.log(`  detectUserType: status=${res.statusCode} body=${data.substring(0, 150)}`);
        if (res.statusCode === 200) {
          try {
            const parsed = JSON.parse(data);
            const clientArr = Array.isArray(parsed) ? parsed : [];
            console.log(`  ✓ Warehouse user — ${clientArr.length} clients`);
            if (clientArr.length > 0) console.log(`  Sample keys: ${Object.keys(clientArr[0]).join(', ')}`);
            resolve({ isWarehouse: true, clients: clientArr });
          } catch(e) {
            console.log(`  ✓ Warehouse user (200 but parse error: ${e.message})`);
            resolve({ isWarehouse: true, clients: [] });
          }
        } else {
          console.log(`  Client user detected (status ${res.statusCode})`);
          resolve({ isWarehouse: false, clients: [] });
        }
      });
    });
    req.on('error', (e) => {
      console.log(`  detectUserType request error: ${e.message}`);
      resolve({ isWarehouse: false, clients: [] });
    });
    req.end();
  });
}

// Fetch a client user's own profile to get their ClientId
function fetchClientProfile(apiKey) {
  return new Promise((resolve) => {
    const options = {
      hostname: 'api.mintsoft.co.uk',
      path: '/api/ClientUser/Current',
      method: 'GET',
      headers: { 'ms-apikey': apiKey, 'User-Agent': 'MexecoReplenishmentTool/1.0' }
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.end();
  });
}

// ── Session helpers ───────────────────────────────────────────────────────────

function createSession(apiKey, clientId, username, isWarehouse = false, clients = [], warehouses = []) {
  pruneExpiredSessions();
  const token = crypto.randomBytes(32).toString('hex');
  sessions[token] = {
    apiKey,
    clientId,
    username,
    isWarehouse,
    clients,    // list of { ID, Name } for warehouse users
    warehouses, // list of { ID, Name } for all users
    expiresAt: Date.now() + SESSION_TTL_MS
  };
  return token;
}

function getSessionFromToken(token) {
  if (!token) return null;
  const session = sessions[token];
  if (!session) return null;
  if (Date.now() > session.expiresAt) {
    delete sessions[token];
    return null;
  }
  // Refresh TTL on activity
  session.expiresAt = Date.now() + SESSION_TTL_MS;
  return session;
}

function pruneExpiredSessions() {
  const now = Date.now();
  for (const token in sessions) {
    if (now > sessions[token].expiresAt) delete sessions[token];
  }
}

// Extract session token from cookie header
function getTokenFromRequest(req) {
  const cookie = req.headers.cookie || '';
  const match = cookie.match(/session=([a-f0-9]+)/);
  return match ? match[1] : null;
}

// ── Exported middleware + route handlers ──────────────────────────────────────

// Get session from request (returns null if not logged in)
function getSession(req) {
  const token = getTokenFromRequest(req);
  return getSessionFromToken(token);
}

// Middleware — sends 401 if not logged in, returns session if valid
function requireSession(req, res) {
  const session = getSession(req);
  if (!session) {
    res.json(401, { error: 'Not authenticated' });
    return null;
  }
  return session;
}

// POST /api/login
async function login(req, res) {
  try {
    const { username, password } = await req.json();
    if (!username || !password) {
      return res.json(400, { error: 'Username and password required' });
    }

    console.log(`Login attempt: ${username}`);

    // Authenticate with Mintsoft
    const apiKey = await mintsoftAuth(username, password);
    console.log(`✓ Mintsoft auth successful for ${username}`);

    // Detect user type — warehouse admin or client user
    const { isWarehouse, clients } = await detectUserType(apiKey);
    console.log(`  User type: ${isWarehouse ? 'warehouse admin' : 'client user'}`);

    // Fetch warehouses accessible to this user (runs for both user types)
    const warehouses = await fetchWarehouses(apiKey);

    let clientId = null;

    if (isWarehouse) {
      // Warehouse users can select any client — clientId set per-report, not at login
      console.log(`  Clients available: ${clients.length}`);
    } else {
      // Client users — auto-detect their own ClientId
      const profile = await fetchClientProfile(apiKey);
      if (profile) {
        clientId = profile.ClientId || profile.clientId || profile.ID || profile.id || null;
        console.log(`  ClientId detected: ${clientId}`);
      }
    }

    // Create session
    const token = createSession(apiKey, clientId, username, isWarehouse, clients, warehouses);

    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Set-Cookie': `session=${token}; HttpOnly; SameSite=Strict; Max-Age=${SESSION_TTL_MS / 1000}; Path=/`
    });
    res.end(JSON.stringify({
      success:     true,
      username,
      clientId,
      isWarehouse,
      clients:    isWarehouse ? clients.map(c => ({ ID: c.ID || c.Id, Name: c.Name || c.ClientName || c.ShortName })) : [],
      warehouses: warehouses
    }));

  } catch (err) {
    console.error('Login error:', err.message);
    // Give a user-friendly error for bad credentials
    if (err.message.includes('401') || err.message.includes('auth failed')) {
      return res.json(401, { error: 'Invalid username or password' });
    }
    res.json(500, { error: 'Login failed — please try again' });
  }
}

// POST /api/logout
function logout(req, res) {
  const token = getTokenFromRequest(req);
  if (token) delete sessions[token];
  res.writeHead(200, {
    'Content-Type': 'application/json',
    'Set-Cookie': 'session=; HttpOnly; Max-Age=0; Path=/'
  });
  res.end(JSON.stringify({ success: true }));
}

// GET /api/me — returns current session info
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
