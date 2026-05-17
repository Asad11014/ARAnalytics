// Customer Profitability Report
// Revenue breakdown per client using the Mintsoft unconfirmed invoice summary API.

const { fetchUnconfirmedInvoiceSummary, startSSE, parseReportParams } = require('../base');

const meta = {
  title:       'Customer Profitability',
  description: 'Revenue and cost breakdown per client — identify your most and least profitable accounts.',
  icon:        '💹',
  category:    'financial',
  params: []
};

async function run(req, res, url, session) {
  const { apiKey } = session;
  const { warehouseId } = parseReportParams(url, session);
  const send = startSSE(res);

  try {
    const clients = session.clients || [];
    if (!clients.length) {
      send({ type: 'done', rows: [], meta: { totalRevenue: 0, totalClients: 0 } });
      res.end();
      return;
    }

    const now   = new Date();
    const from  = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
    const to    = now.toISOString().split('T')[0];

    const rows = [];
    for (let i = 0; i < clients.length; i++) {
      const client = clients[i];
      const clientId = String(client.ID || client.id);
      const name     = client.Name || client.name || clientId;
      send({ type: 'progress', message: `Fetching billing for ${name} (${i + 1}/${clients.length})…` });

      const inv = await fetchUnconfirmedInvoiceSummary(apiKey, clientId, from, to);
      if (!inv) continue;

      const picking  = inv.PickingCost || 0;
      const postage  = (inv.PostageCost || 0) + (inv.VatFreePostageCost || 0);
      const storage  = inv.StorageCost || 0;
      const goodsIn  = inv.GoodsInCost || 0;
      const returns  = inv.ReturnsCost || 0;
      const other    = (inv.ReworkCost || 0) + (inv.PackagingCost || 0) +
                       (inv.GenericInvoiceItemsCost || 0) + (inv.CollectionsCost || 0) + (inv.AdminFee || 0);
      const revenue  = picking + postage + storage + goodsIn + returns + other;

      if (revenue === 0) continue;
      rows.push({ clientId, name, picking, postage, storage, goodsIn, returns, other, revenue });
    }

    rows.sort((a, b) => b.revenue - a.revenue);

    const totalRevenue = rows.reduce((s, r) => s + r.revenue, 0);
    send({ type: 'done', rows, meta: { totalRevenue, totalClients: rows.length, period: `${from} → ${to}` } });
  } catch (err) {
    send({ type: 'error', message: err.message });
  }
  res.end();
}

module.exports = { meta, run };
