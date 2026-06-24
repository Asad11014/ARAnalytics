// ─── server/storage.js ────────────────────────────────────────────────────────
// Client-facing stock-volume insights, computed from product dimensions (cm) and
// live on-hand stock:
//   • storageBreakdown — CBM / volumetric breakdown of what's in storage.
//   • excessStock      — slow-moving / overstocked / dead SKUs and the volume tied up.
// Both are DB-backed JSON (no Mintsoft round-trip) and scoped to one client.

const { query } = require('./db');
const { mintsoftGet } = require('./mintsoft');

const VOL_WEIGHT_FACTOR = 167; // kg per m³ — industry volumetric-weight convention

// Friendly labels for Mintsoft storage charging types.
const METHOD_LABEL = {
  PerPalletUnit:      'Per pallet',
  Volumetric:         'Volumetric (per m³)',
  StockManagementFee: 'Stock management fee',
};
const num = (s, re) => { const m = (s || '').match(re); return m ? +m[1] : null; };

// cm × cm × cm → m³ (CBM). 0 when any dimension is missing.
const unitCbm = p => {
  const h = +p.height, w = +p.width, d = +p.depth;
  if (!(h > 0 && w > 0 && d > 0)) return 0;
  return (h * w * d) / 1e6;
};

// Resolve target client: clients see their own; warehouse may pass ?clientId=.
function targetClient(url, session) {
  if (session.isWarehouse) {
    const c = url.searchParams.get('clientId');
    return c ? parseInt(c) : null;
  }
  return session.clientId ? parseInt(session.clientId) : null;
}

// Products + on-hand qty for a client.
async function loadStocked(clientId) {
  return query(
    `SELECT p.sku, p.name, p.height, p.width, p.depth, p.weight, p.price, p.discontinued,
            COALESCE(st.qty, 0) AS qty
     FROM products p
     LEFT JOIN (
       SELECT product_id, SUM(qty_on_hand)::int AS qty
       FROM product_stock_levels GROUP BY product_id
     ) st ON st.product_id = p.id
     WHERE p.client_id = $1`,
    [clientId]
  );
}

// Size bands by unit volume (litres).
function sizeBand(litres) {
  if (litres <= 0)   return 'unknown';
  if (litres < 1)    return 'small';
  if (litres < 5)    return 'medium';
  if (litres < 25)   return 'large';
  return 'oversized';
}
const BANDS = ['small', 'medium', 'large', 'oversized', 'unknown'];

// GET /api/storage — CBM / volumetric breakdown of on-hand storage.
async function storageBreakdown(req, res, url, session) {
  const clientId = targetClient(url, session);
  if (!clientId) return res.json(400, { error: 'clientId required' });

  const products = await loadStocked(clientId);

  let totalCbm = 0, totalUnits = 0, totalActualWeight = 0, missingDims = 0, skusStocked = 0;
  const bands = Object.fromEntries(BANDS.map(b => [b, { skus: 0, units: 0, cbm: 0 }]));
  const rows = [];

  for (const p of products) {
    const qty = p.qty || 0;
    if (qty <= 0) continue;
    skusStocked++;
    const uCbm = unitCbm(p);
    const litres = uCbm * 1000;
    const cbm = uCbm * qty;
    const actualWeight = (+p.weight || 0) * qty;
    if (uCbm === 0) missingDims++;

    totalCbm += cbm; totalUnits += qty; totalActualWeight += actualWeight;
    const band = sizeBand(litres);
    bands[band].skus++; bands[band].units += qty; bands[band].cbm += cbm;

    rows.push({
      sku: p.sku, name: p.name || '', qty,
      unitCbm: +uCbm.toFixed(5), unitLitres: +litres.toFixed(2),
      cbm: +cbm.toFixed(4),
      heightCm: +p.height || null, widthCm: +p.width || null, depthCm: +p.depth || null,
      actualWeightKg: +actualWeight.toFixed(2),
      band,
    });
  }

  rows.sort((a, b) => b.cbm - a.cbm);
  const sharePct = rows.length ? rows.map(r => ({ ...r, sharePct: totalCbm > 0 ? +(100 * r.cbm / totalCbm).toFixed(1) : 0 })) : [];
  const volumetricWeight = totalCbm * VOL_WEIGHT_FACTOR;

  return res.json(200, {
    summary: {
      totalCbm: +totalCbm.toFixed(3),
      totalUnits,
      skusStocked,
      missingDims,
      actualWeightKg: +totalActualWeight.toFixed(1),
      volumetricWeightKg: +volumetricWeight.toFixed(1),
      volWeightFactor: VOL_WEIGHT_FACTOR,
    },
    bands: BANDS.map(b => ({ band: b, ...bands[b], cbm: +bands[b].cbm.toFixed(3) })),
    rows: sharePct,
  });
}

// GET /api/excess?days=90&targetWeeks=12 — slow-moving / overstocked / dead stock.
async function excessStock(req, res, url, session) {
  const clientId = targetClient(url, session);
  if (!clientId) return res.json(400, { error: 'clientId required' });

  const days        = Math.max(7, parseInt(url.searchParams.get('days') || '90'));
  const targetWeeks = Math.max(1, parseInt(url.searchParams.get('targetWeeks') || '12'));
  const weeksInWindow = days / 7;

  const [products, sales] = await Promise.all([
    loadStocked(clientId),
    query(
      `SELECT oi.sku AS sku, SUM(oi.quantity)::int AS sold
       FROM order_items oi JOIN orders o ON o.id = oi.order_id
       WHERE o.client_id = $1 AND o.order_date >= NOW() - ($2::int * INTERVAL '1 day')
         AND COALESCE(o.status_name,'') !~* 'cancel'
       GROUP BY oi.sku`,
      [clientId, days]
    ),
  ]);
  const soldBySku = Object.fromEntries(sales.map(s => [s.sku, s.sold]));

  let totalExcessUnits = 0, totalExcessCbm = 0, deadUnits = 0, deadCbm = 0;
  let excessCount = 0, deadCount = 0, healthyCount = 0, lowCount = 0;
  const rows = [];

  for (const p of products) {
    const qty = p.qty || 0;
    if (qty <= 0) continue;
    const sold = soldBySku[p.sku] || 0;
    const weeklyDemand = sold / weeksInWindow;
    const weeksCover = weeklyDemand > 0 ? qty / weeklyDemand : null;
    const uCbm = unitCbm(p);

    let status, excessUnits = 0;
    if (sold === 0) {
      status = 'dead';
      excessUnits = qty;                       // nothing sold in the window → all surplus
      deadCount++; deadUnits += qty; deadCbm += uCbm * qty;
    } else if (weeksCover > targetWeeks) {
      status = 'excess';
      excessUnits = Math.max(0, Math.round(qty - targetWeeks * weeklyDemand));
      excessCount++;
    } else if (weeksCover != null && weeksCover < 2) {
      status = 'low';
      lowCount++;
    } else {
      status = 'healthy';
      healthyCount++;
    }
    const excessCbm = uCbm * excessUnits;
    totalExcessUnits += excessUnits; totalExcessCbm += excessCbm;

    rows.push({
      sku: p.sku, name: p.name || '', qty,
      soldInWindow: sold,
      weeklyDemand: +weeklyDemand.toFixed(2),
      weeksCover: weeksCover == null ? null : +weeksCover.toFixed(1),
      excessUnits,
      excessCbm: +excessCbm.toFixed(4),
      unitCbm: +uCbm.toFixed(5),
      discontinued: p.discontinued,
      status,
    });
  }

  // Most actionable first: dead, then biggest excess volume.
  const order = { dead: 0, excess: 1, healthy: 2, low: 3 };
  rows.sort((a, b) => (order[a.status] - order[b.status]) || (b.excessCbm - a.excessCbm) || (b.qty - a.qty));

  return res.json(200, {
    summary: {
      days, targetWeeks,
      skusStocked: rows.length,
      excessCount, deadCount, healthyCount, lowCount,
      totalExcessUnits,
      totalExcessCbm: +totalExcessCbm.toFixed(3),
      deadUnits, deadCbm: +deadCbm.toFixed(3),
    },
    rows,
  });
}

// GET /api/storage/cost?days=30 — actual storage charges from Mintsoft (the real
// volumetric / per-pallet / management-fee cost the client is billed).
async function storageCost(req, res, url, session) {
  const clientId = targetClient(url, session);
  if (!clientId) return res.json(400, { error: 'clientId required' });
  if (!session.apiKey) return res.json(200, { available: false, reason: 'no_api_key' });

  const days = Math.max(7, Math.min(180, parseInt(url.searchParams.get('days') || '30')));
  const to = new Date();
  const from = new Date(to.getTime() - days * 86400000);
  const fmt = d => d.toISOString().slice(0, 10);

  // Paginate the unconfirmed storage costs for the window.
  const items = [];
  for (let pageNo = 1; pageNo <= 20; pageNo++) {
    const path = `/api/Account/Invoice/GetUnconfirmedInvoiceStorageCosts`
      + `?clientID=${encodeURIComponent(clientId)}&fromDate=${fmt(from)}&toDate=${fmt(to)}&limit=100&pageNo=${pageNo}`;
    const r = await mintsoftGet(path, session.apiKey);
    if (r.status !== 200 || !Array.isArray(r.body) || !r.body.length) break;
    items.push(...r.body);
    if (r.body.length < 100) break;
  }

  if (!items.length) return res.json(200, { available: false, reason: 'no_data', days });

  const byType = {};
  let total = 0;
  const series = [];
  for (const it of items) {
    const cost = +it.Cost || 0;
    total += cost;
    (byType[it.Type] = byType[it.Type] || { type: it.Type, label: METHOD_LABEL[it.Type] || it.Type, cost: 0, count: 0 })
      .cost += cost;
    byType[it.Type].count++;
    series.push({
      date: (it.InvoiceDate || '').slice(0, 10),
      cost: +cost.toFixed(2),
      pallets: num(it.Comments, /Number Of Pallets:\s*([\d.]+)/),
      cbm: num(it.Comments, /Storage Cubic Metres:\s*([\d.]+)/),
    });
  }
  series.sort((a, b) => a.date.localeCompare(b.date));

  // Headline method = the type carrying the most cost.
  const typesByCost = Object.values(byType).sort((a, b) => b.cost - a.cost);
  const primary = typesByCost[0];
  const latest = series[series.length - 1] || {};
  const latestRow = items.find(i => (i.InvoiceDate || '').slice(0, 10) === latest.date) || items[items.length - 1];

  // Derive the rate where Mintsoft exposes it.
  let rate = null, rateUnit = null;
  if (primary.type === 'Volumetric') {
    const fee = num(latestRow?.Comments, /Client Storage Fee:\s*([\d.]+)/);
    if (fee != null) { rate = fee; rateUnit = 'per m³ / day'; }
  } else if (primary.type === 'PerPalletUnit') {
    if (latest.pallets) { rate = +(latest.cost / latest.pallets).toFixed(2); rateUnit = 'per pallet'; }
  }

  return res.json(200, {
    available: true,
    days,
    method: primary.type,
    methodLabel: primary.label,
    totalCost: +total.toFixed(2),
    byType: typesByCost.map(t => ({ ...t, cost: +t.cost.toFixed(2) })),
    rate, rateUnit,
    latest: { date: latest.date, cost: latest.cost, pallets: latest.pallets, cbm: latest.cbm },
    series,
  });
}

module.exports = { storageBreakdown, excessStock, storageCost };
