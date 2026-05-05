// ─── server/mintsoft.js ───────────────────────────────────────────────────────
// Shared HTTP client for all Mintsoft API calls.
// All modules import this rather than making raw https calls directly.

const https = require('https');

const MINTSOFT_BASE = 'https://api.mintsoft.co.uk';

function mintsoftGet(path, apiKey) {
  return new Promise((resolve, reject) => {
    const options = {
      headers: {
        'ms-apikey': apiKey,
        'Content-Type': 'application/json',
        'User-Agent': 'MexecoReplenishmentTool/1.0'
      }
    };
    https.get(`${MINTSOFT_BASE}${path}`, options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch (e) { resolve({ status: res.statusCode, body: data }); }
      });
    }).on('error', reject);
  });
}

module.exports = { mintsoftGet, MINTSOFT_BASE };
