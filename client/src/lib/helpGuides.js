// Help guide index. Add guides here as they're written; set published:true to
// make the content live (otherwise the guide shows as "coming soon").
export const HELP_GUIDES = [
  { slug: 'hub-overview', title: 'How to Use the Premium Fulfilment Hub', category: 'Getting Started',
    summary: 'A complete overview of every page in the Hub and what it can do for your business.', published: true },

  { slug: 'sourcing',     title: 'Sourcing',                         category: 'Sourcing & Importing',
    summary: 'Finding, vetting and negotiating with suppliers for your products.', published: false },
  { slug: 'importing',    title: 'Importing',                        category: 'Sourcing & Importing',
    summary: 'Bringing stock into the UK — duties, customs and inbound logistics.', published: false },

  { slug: 'wms',          title: 'How to Use the WMS System',        category: 'Operations',
    summary: 'Getting the most out of the warehouse management system.', published: false },
  { slug: 'packaging',    title: 'Different Packaging',              category: 'Operations',
    summary: 'Choosing the right packaging for protection, presentation and cost.', published: false },
  { slug: 'forecasting',  title: 'Forecasting & Inventory Planning', category: 'Operations',
    summary: 'Planning stock levels to avoid stockouts and tied-up capital.', published: false },

  { slug: 'website-seo',  title: 'Setup & SEO a Website',            category: 'Growth',
    summary: 'Launching a website and ranking it on Google.', published: false },
  { slug: 'sell-on-amazon', title: 'Sell on Amazon',                category: 'Growth',
    summary: 'Listing, fulfilling and growing on the Amazon marketplace.', published: false },
]

export const getGuide = slug => HELP_GUIDES.find(g => g.slug === slug) || null
