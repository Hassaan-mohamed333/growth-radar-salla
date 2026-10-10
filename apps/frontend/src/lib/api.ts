// Typed client for the NestJS backend. Types mirror
// apps/backend/src/{store,analytics,products,competitors,recommendations}/*.service.ts — keep them in sync.

import { cookies } from 'next/headers';

export type ConnectionState ='connected' | 'expiring' | 'disconnected';

export interface StoreStatus {
  connected: boolean;
  status: ConnectionState;
  store: {
    id: string;
    name: string;
    domain: string | null;
    currency: string;
    locale: string;
    installedAt: string;
  } | null;
  connection: {
    scopes: string[];
    accessTokenExpiresAt: string | null;
    lastRefreshedAt: string | null;
    lastError: string | null;
  } | null;
  lastSyncAt: string | null;
  webhooks: { endpoint: string; verification: 'signature' | 'token' };
}

export interface SalesVelocity {
  windowDays: number;
  daysCovered: number;
  unitsPerDay: number;
  ordersPerDay: number;
  revenuePerDay: number;
  currency: string;
  previous: { daysCovered: number; unitsPerDay: number; revenuePerDay: number } | null;
  unitsChangePct: number | null;
  revenueChangePct: number | null;
  lastSnapshotDate: string | null;
}

export interface PriceTrends {
  windowDays: number;
  changes: number;
  increases: number;
  decreases: number;
  avgChangePct: number | null;
  recent: Array<{
    competitorId: string;
    competitorName: string;
    productName: string | null;
    previousPrice: number;
    price: number;
    changePct: number;
    observedAt: string;
  }>;
}

export interface AnalyticsSummary {
  generatedAt: string;
  currency: string;
  salesVelocity: SalesVelocity | null;
  priceTrends: PriceTrends;
  pricingConfidence: {
    score: number | null;
    windowDays: number;
    auditsCount: number;
    failedCount: number;
  };
  competitors: { active: number; undercutting: number; checkedLast24h: number };
  products: { monitored: number; total: number };
  recommendations: {
    pending: number;
    items: Array<{
      id: string;
      type: string;
      title: string;
      rationale: string;
      confidence: number | null;
      createdAt: string;
    }>;
  };
}

export interface ProductCompetitorSummary {
  active: number;
  /** Lowest last-known active competitor price, decimal string. */
  lowestPrice: string | null;
  /** The lowest competitor price is below what the customer pays here. */
  undercut: boolean;
}

export interface ProductItem {
  id: string;
  sallaProductId: string;
  sku: string | null;
  name: string;
  price: string;
  salePrice: string | null;
  currency: string;
  quantity: number | null;
  status: 'SALE' | 'OUT' | 'HIDDEN' | 'DELETED';
  url: string | null;
  imageUrl: string | null;
  competitors: ProductCompetitorSummary;
}

export interface ProductList {
  items: ProductItem[];
  page: number;
  pageSize: number;
  total: number;
}

export interface ProductQuery {
  page?: number;
  pageSize?: number;
  search?: string;
  monitored?: boolean;
}

export type ScrapeFailureKind =
  | 'invalid_url'
  | 'forbidden_target'
  | 'network'
  | 'blocked'
  | 'http_error'
  | 'not_html'
  | 'too_large'
  | 'parse_failed'
  | 'currency_mismatch';

export interface CompetitorItem {
  id: string;
  name: string;
  domain: string;
  productUrl: string | null;
  productId: string | null;
  product: { id: string; name: string } | null;
  currency: string;
  isActive: boolean;
  lastPrice: string | null;
  lastCheckedAt: string | null;
  scrapeFailures: number;
  lastScrapeError: ScrapeFailureKind | null;
  nextScrapeAt: string | null;
}

export interface CompetitorList {
  items: CompetitorItem[];
  page: number;
  pageSize: number;
  total: number;
}

export interface CompetitorQuery {
  page?: number;
  pageSize?: number;
  search?: string;
}

export type RecommendationKind =
  | 'match_competitor'
  | 'margin_floor'
  | 'alert_margin_blocked'
  | 'alert_no_cost';

export interface RecommendationDetails {
  kind: RecommendationKind;
  currency: string;
  currentPrice: number;
  lowestPrice: number;
  competitorName: string;
  competitorsCompared: number;
  gapPct: number;
  costPrice: number | null;
  suggestedPrice: number | null;
  priceChangePct: number | null;
  suggestedMarginPct: number | null;
  marginFloorPrice: number | null;
}

export interface RecommendationItem {
  id: string;
  type: string;
  status: 'PENDING' | 'ACCEPTED' | 'DISMISSED' | 'EXPIRED' | 'APPLIED';
  title: string;
  rationale: string;
  confidence: number | null;
  details: RecommendationDetails | null;
  product: { id: string; name: string; sku: string | null } | null;
  createdAt: string;
  expiresAt: string | null;
  decidedAt: string | null;
}

export interface RecommendationList {
  items: RecommendationItem[];
  page: number;
  pageSize: number;
  total: number;
}

export interface RecommendationQuery {
  status?: 'PENDING' | 'ACCEPTED' | 'DISMISSED' | 'ALL';
  page?: number;
  pageSize?: number;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// API_URL is server-only; NEXT_PUBLIC_API_URL is the shared fallback.
const BASE_URL = (
  process.env.API_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  'http://localhost:4000'
).replace(/\/$/, '');

/** Browser-facing URL that starts the Salla OAuth flow (the browser, not Next, must visit it). */
export const SALLA_LOGIN_URL = `${(process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000').replace(
  /\/$/,
  '',
)}/api/v1/auth/salla/login`;

const SESSION_COOKIE = 'gr_session';

async function get<T>(path: string): Promise<T> {
  // Server-side fetch: forward the merchant's session cookie to the backend.
  const session = (await cookies()).get(SESSION_COOKIE)?.value;
  const res = await fetch(`${BASE_URL}${path}`, {
    cache: 'no-store',
    headers: {
      accept: 'application/json',
      ...(session ? { cookie: `${SESSION_COOKIE}=${encodeURIComponent(session)}` } : {}),
    },
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) throw new ApiError(res.status, `GET ${path} failed with ${res.status}`);
  return (await res.json()) as T;
}

/** Resolves to null on failure; `unauthorized` is set when the backend answered 401. */
export async function settle<T>(p: Promise<T>, flags: { unauthorized: boolean }): Promise<T | null> {
  try {
    return await p;
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) flags.unauthorized = true;
    return null;
  }
}

export const api = {
  storeStatus: () => get<StoreStatus>('/api/v1/store/status'),
  analyticsSummary: () => get<AnalyticsSummary>('/api/v1/analytics/summary'),
  competitors: (q: CompetitorQuery = {}) => {
    const params = new URLSearchParams();
    if (q.page) params.set('page', String(q.page));
    if (q.pageSize) params.set('pageSize', String(q.pageSize));
    if (q.search) params.set('search', q.search);
    const qs = params.toString();
    return get<CompetitorList>(`/api/v1/competitors${qs ? `?${qs}` : ''}`);
  },
  recommendations: (q: RecommendationQuery = {}) => {
    const params = new URLSearchParams();
    if (q.status) params.set('status', q.status);
    if (q.page) params.set('page', String(q.page));
    if (q.pageSize) params.set('pageSize', String(q.pageSize));
    const qs = params.toString();
    return get<RecommendationList>(`/api/v1/recommendations${qs ? `?${qs}` : ''}`);
  },
  products: (q: ProductQuery = {}) => {
    const params = new URLSearchParams();
    if (q.page) params.set('page', String(q.page));
    if (q.pageSize) params.set('pageSize', String(q.pageSize));
    if (q.search) params.set('search', q.search);
    if (q.monitored !== undefined) params.set('monitored', String(q.monitored));
    const qs = params.toString();
    return get<ProductList>(`/api/v1/products${qs ? `?${qs}` : ''}`);
  },
};
