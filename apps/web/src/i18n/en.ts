import type { Dict } from './ar';

export const en: Dict = {
  brand: 'Growth Radar',
  tagline: 'for Salla',
  nav: { overview: 'Overview', tracking: 'Tracking health', competitors: 'Competitors', decisions: 'Decisions', settings: 'Settings' },
  common: { language: 'العربية', theme: 'Theme', light: 'Light', dark: 'Dark', system: 'System', store: 'Store', logout: 'Sign out', updated: 'Updated' },
  login: {
    title: 'Sign in to Growth Radar',
    subtitle: 'Connect your Salla store to see how trustworthy your numbers are and what to do next.',
    cta: 'Continue with Salla',
    errors: {
      denied: 'Salla denied the permission request.',
      invalid: 'Your sign-in request expired. Please try again.',
      forbidden: 'This store is linked to another account. Ask the store owner for an invitation.',
      failed: 'We could not complete the connection. Please try again later.',
    },
  },
  overview: {
    title: 'Command Center',
    subtitle: 'An executive summary of data trust and the decisions that matter most.',
    empty: 'No data yet. Your store is being synced from Salla.',
    apiDown: 'The API is unreachable. Showing demo data.',
  },
  confidence: {
    title: 'Data Confidence',
    levels: { high: 'High', medium: 'Medium', low: 'Low', insufficient_data: 'Insufficient data' },
    hint: 'How closely Salla orders match your analytics tracking.',
    checks: {
      ga4_connected: 'GA4 connected',
      purchase_event_exists: 'Purchase event exists',
      revenue_match: 'Revenue match',
      order_count_match: 'Order count match',
      data_freshness: 'Data freshness',
      currency_match: 'Currency match',
    },
    status: { pass: 'Healthy', warn: 'Warning', fail: 'Failed', unavailable: 'Unavailable', not_applicable: 'N/A' },
  },
  risk: { title: 'Revenue at Risk', hint: '30-day estimate from open decisions.', ofRevenue: 'of 30-day revenue' },
  health: { title: 'Marketing Health', hint: 'A blend of data trust and revenue at risk.', na: 'N/A' },
  decisions: {
    title: 'Top 3 Priority Decisions',
    none: 'No open decisions. Everything looks healthy.',
    confidence: 'Confidence',
    atRisk: 'at risk',
    severity: { CRITICAL: 'Critical', HIGH: 'High', MEDIUM: 'Medium', LOW: 'Low' },
    category: { TRACKING: 'Tracking', PRICING: 'Pricing', COMPETITOR: 'Competitors', INVENTORY: 'Inventory', CAMPAIGN: 'Campaigns' },
  },
};
