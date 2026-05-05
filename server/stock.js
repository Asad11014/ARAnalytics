// ─── server/stock.js ──────────────────────────────────────────────────────────
// Fetches current stock levels from Mintsoft for a given warehouse + client.

const { mintsoftGet } = require('./mintsoft');

async function fetchLevels(req, res, url, session) {
  const { apiKey, clientId: sessionClientId } = session;
  const warehouseId = url.searchParams.get('warehouseId');
  // Warehouse users pass clientId as a query param; client users use their session clientId
  const clientId = url.searchParams.get('clientId') || sessionClientId;

  if (!warehouseId) return res.json(400, { error: 'Missing warehouseId' });

  let path = `/api/Product/StockLevels?WarehouseId=${encodeURIComponent(warehouseId)}`;
  if (clientId) path += `&ClientId=${encodeURIComponent(clientId)}`;

  const result = await mintsoftGet(path, apiKey);
  if (result.status !== 200) {
    return res.json(result.status, { error: `Mintsoft stock API error: ${result.status}` });
  }

  // Filter to client just in case Mintsoft ignores the param
  const allStock = Array.isArray(result.body) ? result.body : [];
  const filtered = clientId
    ? allStock.filter(item => String(item.ClientId) === String(clientId))
    : allStock;

  res.json(200, filtered);
}

module.exports = { fetchLevels };
