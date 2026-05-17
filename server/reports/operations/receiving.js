const { startSSE } = require('../base');
const meta = { title: 'Receiving Performance', description: 'Inbound shipment performance, dock-to-stock time, and ASN accuracy.', icon: '📥', category: 'operations', comingSoon: true, params: [] };
async function run(req, res) { const send = startSSE(res); send({ type: 'done', rows: [], meta: { comingSoon: true } }); res.end(); }
module.exports = { meta, run };
