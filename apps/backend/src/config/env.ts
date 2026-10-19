import { z } from 'zod';

/** Decodes to exactly 32 bytes (AES-256). */
const aes256Key = z
  .string()
  .min(1, 'TOKEN_ENCRYPTION_KEY is required')
  .refine((v) => {
    try {
      return Buffer.from(v, 'base64').length === 32;
    } catch {
      return false;
    }
  }, 'TOKEN_ENCRYPTION_KEY must be 32 bytes, base64-encoded');

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  /**
   * How many reverse proxies sit in front of the API (Express `trust proxy`). One on Render alone;
   * with the Vercel rewrite in front of Render the real client may be one hop further out.
   * Measure on staging (log req.ip against X-Forwarded-For) before changing it.
   */
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(1),
  /** Public address of the dashboard. Production must set it: the localhost default is rejected. */
  FRONTEND_ORIGIN: z.string().url().default('http://localhost:3000'),

  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),

  TOKEN_ENCRYPTION_KEY: aes256Key,
  TOKEN_ENCRYPTION_KEY_VERSION: z.coerce.number().int().min(1).default(1),

  /** HMAC key for session JWTs. Generate: node -e "console.log(require('crypto').randomBytes(48).toString('base64'))" */
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),
  SESSION_TTL_SECONDS: z.coerce.number().int().min(60).default(60 * 60 * 12),
  /** Set (e.g. ".example.com") when the dashboard and API live on sibling subdomains. */
  SESSION_COOKIE_DOMAIN: z.string().min(1).optional(),

  /** Periodic order sync (also re-run on order webhooks and after login). */
  SALES_SYNC_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  SALES_SYNC_INTERVAL_MINUTES: z.coerce.number().int().min(5).default(60),
  /** History pulled the first time a store is synced. */
  SALES_BACKFILL_DAYS: z.coerce.number().int().min(1).max(365).default(90),

  /** Periodic catalogue sync (also driven by product webhooks and after login). */
  PRODUCT_SYNC_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  PRODUCT_SYNC_INTERVAL_MINUTES: z.coerce.number().int().min(15).default(360),

  /** Recommendation engine (competitor-driven price alerts / suggestions). */
  RECOMMENDATIONS_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  RECOMMENDATIONS_INTERVAL_MINUTES: z.coerce.number().int().min(15).default(60),
  /** A competitor must be at least this much cheaper (%) before we raise anything. */
  RECOMMENDATION_MIN_GAP_PCT: z.coerce.number().min(0).max(100).default(2),
  /** Suggested prices keep at least this margin (%) over the product's cost price. */
  RECOMMENDATION_MIN_MARGIN_PCT: z.coerce.number().min(0).max(1000).default(10),

  /** Competitor price scraping. Opt-in: it makes outbound requests to third-party sites. */
  SCRAPER_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  /** How often each listing is re-fetched after a successful scrape. */
  SCRAPER_INTERVAL_MINUTES: z.coerce.number().int().min(15).default(360),
  /** Max listings picked up per 5-minute tick. */
  SCRAPER_BATCH_SIZE: z.coerce.number().int().min(1).max(500).default(50),
  /** Pause between two requests to the same domain. */
  SCRAPER_DOMAIN_DELAY_MS: z.coerce.number().int().min(0).default(2000),
  SCRAPER_USER_AGENT: z
    .string()
    .min(1)
    .default('GrowthRadarBot/1.0 (merchant price monitoring)'),

  SALLA_CLIENT_ID: z.string().min(1),
  SALLA_CLIENT_SECRET: z.string().min(1),
  /** Must exactly match a redirect URL registered on the Salla Partners app. */
  SALLA_REDIRECT_URI: z
    .string()
    .url()
    .default('http://localhost:4000/api/v1/auth/salla/callback'),
  /**
   * Space-separated. `offline_access` makes Salla issue a refresh token;
   * `settings.read` is needed for store info at login, `orders.read` by the sales sync,
   * `products.read` by the catalogue sync. Names must match the app's permissions in the
   * Salla Partners portal (the docs list `settings.read`; read-only orders/products
   * scope names should be confirmed against the portal).
   */
  SALLA_OAUTH_SCOPES: z
    .string()
    .min(1)
    .default('offline_access settings.read orders.read products.read'),
  SALLA_WEBHOOK_SECRET: z.string().min(16, 'SALLA_WEBHOOK_SECRET looks too short'),
  SALLA_WEBHOOK_STRATEGY: z.enum(['signature', 'token']).default('signature'),
}).superRefine(productionChecks);

export type Env = z.infer<typeof envSchema>;

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '0.0.0.0']);
/** The route AuthController serves; Salla calls the registered URL verbatim, so the path must match. */
const OAUTH_CALLBACK_PATH = '/api/v1/auth/salla/callback';

/**
 * Settings that fall back to a harmless localhost default in development but would break login in
 * production, silently. A wrong value should stop the boot with a clear reason, not surface as
 * "invalid_state" for every merchant after deploy.
 */
function productionChecks(
  env: { NODE_ENV: string; FRONTEND_ORIGIN: string; SALLA_REDIRECT_URI: string },
  ctx: z.RefinementCtx,
): void {
  if (env.NODE_ENV !== 'production') return;

  const issue = (key: string, message: string) =>
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: [key], message });

  const frontend = new URL(env.FRONTEND_ORIGIN);
  const redirect = new URL(env.SALLA_REDIRECT_URI);

  for (const [key, url] of [
    ['FRONTEND_ORIGIN', frontend],
    ['SALLA_REDIRECT_URI', redirect],
  ] as const) {
    if (url.protocol !== 'https:') {
      issue(key, 'must use https in production (session cookies are Secure, and Salla requires it)');
    }
    if (LOCAL_HOSTS.has(url.hostname)) {
      issue(key, 'must be the public address, not localhost: set it explicitly in production');
    }
  }

  // The OAuth state cookie is stored by the browser for the host that started the login. The
  // callback must come back to that same host, i.e. through the dashboard's /api rewrite.
  if (redirect.origin !== frontend.origin) {
    issue(
      'SALLA_REDIRECT_URI',
      `must be on the dashboard origin (${frontend.origin}) so the OAuth state cookie is sent back`,
    );
  }
  if (redirect.pathname !== OAUTH_CALLBACK_PATH) {
    issue('SALLA_REDIRECT_URI', `path must be ${OAUTH_CALLBACK_PATH}`);
  }
}

/** Used by ConfigModule.forRoot({ validate }) — fails fast at boot on bad config. */
export function validateEnv(raw: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}
