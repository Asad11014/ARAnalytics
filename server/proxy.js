// ─── server/proxy.js ──────────────────────────────────────────────────────────
// Pass-through proxy for any direct Mintsoft API calls from the client.
// The ms-apikey header is forwarded from the browser request.

const https = require('https');
const { MINTSOFT_BASE } = require('./mintsoft');

function passThrough(req, res, url) {
  const targetPath = url.pathname.replace(/^\/proxy/, '') + url.search;
  console.log(`→ Proxy: ${MINTSOFT_BASE}${targetPath}`);

  const options = {
    method: req.method,
    headers: {
      'ms-apikey':    req.headers['ms-apikey'] || '',
      'Content-Type': 'application/json',
      'User-Agent':   'MexecoReplenishmentTool/1.0'
    }
  };

  const proxyReq = https.request(
    `${MINTSOFT_BASE}${targetPath}`,
    options,
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode, { 'Content-Type': 'application/json' });
      proxyRes.pipe(res);
    }
  );

  proxyReq.on('error', (err) => {
    res.writeHead(502);
    res.end(JSON.stringify({ error: err.message }));
  });

  req.pipe(proxyReq);
}

module.exports = { passThrough };
