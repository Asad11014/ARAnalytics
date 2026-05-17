// Central navigation definition — shared by Sidebar and AppShell routing.
// Add a new page: add an entry here, create the page file, add a Route in AppShell.

export const NAV_SECTIONS = [
  {
    id: 'inventory',
    label: 'Inventory',
    icon: '📦',
    items: [
      { to: '/app/inventory/health-score',  label: 'Health Score',      icon: '❤️',  badge: 'new' },
      { to: '/app/inventory/snapshot',      label: 'Live Snapshot',     icon: '📷',  badge: 'new' },
      { to: '/app/inventory/aging',         label: 'Aging Report',      icon: '⏳',  badge: 'new' },
      { to: '/app/inventory/velocity',      label: 'SKU Velocity',      icon: '⚡',  badge: 'new' },
      { to: '/app/inventory/stockout',      label: 'Stockout Analysis', icon: '🚨',  badge: 'soon' },
      { to: '/app/inventory/turnover',      label: 'Turnover',          icon: '🔄',  badge: 'soon' },
    ]
  },
  {
    id: 'operations',
    label: 'Operations',
    icon: '🏭',
    warehouseOnly: true,
    items: [
      { to: '/app/operations/fulfillment', label: 'Fulfillment',        icon: '📤', badge: 'new'  },
      { to: '/app/operations/receiving',   label: 'Receiving',          icon: '📥', badge: 'soon' },
      { to: '/app/operations/errors',      label: 'Errors & Adj.',      icon: '⚠️', badge: 'soon' },
    ]
  },
  {
    id: 'financial',
    label: 'Financial',
    icon: '💰',
    items: [
      { to: '/app/financial/profitability', label: 'Revenue Breakdown', clientLabel: 'Cost Breakdown', icon: '💹', badge: 'new'  },
      { to: '/app/financial/billing',       label: 'Billing Summary',   icon: '🧾', badge: 'soon' },
    ]
  },
  {
    id: 'analytics',
    label: 'Analytics',
    icon: '📊',
    items: [
      { to: '/app/analytics/best-sellers', label: 'Best Sellers',       icon: '🏆' },
      { to: '/app/analytics/sales-trend',  label: 'Sales Trend',        icon: '📊' },
      { to: '/app/analytics/forecasting',  label: 'Forecasting',        icon: '🔮', badge: 'soon' },
    ]
  },
];

// Flat list of all items — useful for route matching
export const ALL_NAV_ITEMS = NAV_SECTIONS.flatMap(s => s.items);
