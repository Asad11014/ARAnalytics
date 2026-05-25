// Central navigation definition — shared by Sidebar and AppShell routing.

// Top-level standalone links (appear above the collapsible sections)
export const TOP_LINKS = [
  { to: '/app',            label: 'Dashboard',  icon: '⬛', exact: true },
  { to: '/app/calendar',   label: 'Calendar',   icon: '📅' },
  { to: '/app/quotations', label: 'Quotations', icon: '💬' },
  { to: '/app/my-quotes',  label: 'My Quotes',  icon: '📋' },
];

// Report sub-categories within the single "Reports" section.
// Each group has a label, optional warehouseOnly flag, and items.
export const REPORT_GROUPS = [
  {
    id: 'inventory',
    label: 'Inventory',
    items: [
      { to: '/app/inventory/health-score',  label: 'Health Score',      icon: '❤️',  badge: 'new'  },
      { to: '/app/inventory/snapshot',      label: 'Live Snapshot',     icon: '📷',  badge: 'new'  },
      { to: '/app/inventory/aging',         label: 'Aging Report',      icon: '⏳',  badge: 'new'  },
      { to: '/app/inventory/velocity',      label: 'SKU Velocity',      icon: '⚡',  badge: 'new'  },
    ]
  },
  {
    id: 'operations',
    label: 'Operations',
    warehouseOnly: true,
    items: [
      { to: '/app/operations/fulfillment', label: 'Fulfillment',  icon: '📤', badge: 'new'  },
    ]
  },
  {
    id: 'financial',
    label: 'Financial',
    items: [
      { to: '/app/financial/profitability', label: 'Revenue Breakdown', clientLabel: 'Cost Breakdown', icon: '💹', badge: 'new'  },
    ]
  },
  {
    id: 'analytics',
    label: 'Analytics',
    items: [
      { to: '/app/analytics/best-sellers', label: 'Best Sellers', icon: '🏆' },
      { to: '/app/analytics/sales-trend',  label: 'Sales Trend',  icon: '📊' },
    ]
  },
];

// Flat list of all report items — useful for route matching
export const ALL_REPORT_ITEMS = REPORT_GROUPS.flatMap(g => g.items);

// Legacy export so any code still importing NAV_SECTIONS doesn't break
export const NAV_SECTIONS = REPORT_GROUPS.map(g => ({ ...g, icon: '' }));
export const ALL_NAV_ITEMS = ALL_REPORT_ITEMS;
