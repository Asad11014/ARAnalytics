// ─── server/demo/constants.js ─────────────────────────────────────────────────
// Reserved ID range + identifiers for the public demo dataset.
//
// Demo data is seeded into a SEPARATE database (DEMO_MODE deployment only), but
// we still keep all demo records inside a reserved high ID range so that:
//   • the seed can be deleted/re-inserted idempotently, and
//   • any demo row is instantly recognisable and can never collide with real
//     Mintsoft IDs (which are small, sequential integers).

const DEMO_WAREHOUSE_ID = 900001;

// Curated demo clients (Mintsoft-shaped { ID, Name }).
const DEMO_CLIENTS = [
  { ID: 900101, Name: 'Aurora Skincare' },
  { ID: 900102, Name: 'Peak Nutrition' },
  { ID: 900103, Name: 'Loom & Co.' },
  { ID: 900104, Name: 'Verdant Tea' },
  { ID: 900105, Name: 'Northstar Apparel' },
];

const DEMO_CLIENT_IDS = DEMO_CLIENTS.map(c => c.ID);

const DEMO_WAREHOUSE = { ID: DEMO_WAREHOUSE_ID, Name: 'Demo Warehouse — Bristol' };

// Reserved sub-ranges within the demo ID space (keeps each entity's IDs distinct).
const DEMO_ID_BASE = {
  product:    9_010_000,
  order:      9_020_000,
  orderItem:  9_030_000,
  invoice:    9_040_000,
  asn:        9_050_000,
};

// True if an integer ID belongs to the reserved demo range.
function isDemoId(id) {
  const n = Number(id);
  return Number.isFinite(n) && n >= 900_000;
}

module.exports = {
  DEMO_WAREHOUSE_ID,
  DEMO_WAREHOUSE,
  DEMO_CLIENTS,
  DEMO_CLIENT_IDS,
  DEMO_ID_BASE,
  isDemoId,
};
