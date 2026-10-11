# Growth Radar for Salla — راصد

B2B marketing-intelligence & decision SaaS for Salla merchants and agencies. Modular monolith + isolated BullMQ workers in a pnpm/Turborepo monorepo.

```
growth-radar-salla/
├─ apps/
│  ├─ api/                          NestJS 11 (Fastify) — HTTP API *and* BullMQ workers (APP_ROLE=api|worker|all)
│  │  ├─ prisma/
│  │  │  ├─ schema.prisma           data model (multi-tenant, composite tenant FKs)
│  │  │  └─ migrations/
│  │  │     ├─ 0001_init            generated DDL + indexes
│  │  │     └─ 0002_security        RLS, immutability triggers, CHECKs, SECURITY DEFINER lookups, least-privilege grants
│  │  ├─ src/
│  │  │  ├─ config/                 zod-validated env (fail-fast), key-ring parser, role switch
│  │  │  ├─ common/
│  │  │  │  ├─ crypto/              TokenCryptoService (AES-256-GCM), PiiService (keyed pseudonymisation)
│  │  │  │  ├─ auth/                session JWT, SessionGuard, PermissionsGuard (RBAC), StoreAccessGuard, TenantInterceptor
│  │  │  │  └─ throttle/            Redis fixed-window rate-limit storage (Lua, atomic)
│  │  │  ├─ infra/                  Prisma (+tenant-guard extension), TenantDb (RLS tx), SystemDb, Redis
│  │  │  ├─ queue/                  BullMQ wiring, retry/backoff defaults
│  │  │  ├─ salla/                  OAuth (PKCE+state), tokens/refresh, API client, webhooks, paginated sync, mappers
│  │  │  ├─ confidence/             Data Confidence audit service + recommendation engine
│  │  │  └─ dashboard/              /stores, /stores/:id/overview, /stores/:id/sync
│  │  └─ test/                      fake Salla + end-to-end smoke test (real Postgres/Redis)
│  └─ web/                          Next.js 15 App Router, Tailwind, Lucide, Arabic RTL / English LTR, light/dark/system
├─ packages/shared/                 RBAC matrix, **Data Confidence calculator**, zod DTOs, queue names (used by API *and* web)
├─ infra/init-db.sql                creates the non-owner, non-superuser runtime DB role (required for RLS)
├─ docker-compose.yml               Postgres 16 + Redis 7
└─ .github/workflows/ci.yml         typecheck + test + build + `pnpm audit`
```

## Run it

```bash
cp .env.example .env              # fill SALLA_*, generate keys: openssl rand -base64 32 / openssl rand -hex 32
docker compose up -d
pnpm install
pnpm db:migrate                   # runs prisma migrate deploy as the owner role (MIGRATION_DATABASE_URL)
pnpm dev                          # api :4000, web :3000
pnpm test                         # unit tests (shared + api)
pnpm --filter @radar/api test:e2e # end-to-end (needs local postgres+redis; see test/run-e2e.sh)
```

Salla Partners Portal: register redirect URI `${APP_URL}/salla/oauth/callback`, subscribe webhooks to `${APP_URL}/salla/webhooks`, set the webhook secret to `SALLA_WEBHOOK_SECRET`.
Production: run `APP_ROLE=api` and `APP_ROLE=worker` as separate deployments; workers open no HTTP port.

## Security controls (what enforces each rule)

| Rule | Implementation | Verified by |
|---|---|---|
| OAuth2 code flow + PKCE + state | `salla-oauth.controller.ts`, `oauth-state.service.ts`: 256-bit state, single-use (`GETDEL`), 10-min TTL, bound to an HttpOnly nonce cookie (blocks login-CSRF), S256 challenge | e2e: replay & missing-nonce rejected |
| Tokens encrypted at rest | `token-crypto.service.ts`: AES-256-GCM, random 96-bit IV, key-ring rotation, AAD = purpose+tenant+store (ciphertext can't be moved between rows). DB `CHECK` rejects any non-envelope value | unit + e2e + SQL test |
| No raw tokens in logs | Fastify log serializer logs path only (no query: `code`/`state`), redacts cookies/authorization/signature; errors carry class names, not bodies | e2e log grep = 0 hits |
| Auth token ≠ session JWT | Session JWT (HS256 pinned, own secret/audience, HttpOnly SameSite=Lax cookie) never contains a Salla token; Salla tokens never leave the API | e2e |
| Tenant isolation | 3 layers: (1) `tenant_id` + composite FK `(tenant_id, store_id)`; (2) Prisma extension **throws** if a tenant-model query lacks explicit `tenantId`; (3) Postgres **RLS (FORCE)** keyed on `app.tenant_id` set per transaction. Tenant comes only from the verified session (AsyncLocalStorage), never from request input | unit + SQL + e2e (cross-tenant → 404) |
| RBAC | `packages/shared/src/rbac.ts` (Owner / Agency Admin / Marketer / Client Viewer). `SessionGuard` → `PermissionsGuard` is **deny-by-default**: a route without `@RequirePermission` is 403 | unit + e2e |
| Webhook HMAC before parse | `main.ts` hands the webhook route the untouched `Buffer`; `SallaWebhookGuard` verifies HMAC-SHA256 (constant-time) over exact bytes; strategy comes from config, never from a header | unit + e2e |
| Webhook idempotency | key = sha256(raw body): Redis `SET NX` (72h) → `UNIQUE(idempotency_key)` → BullMQ `jobId`. A crash between persist and enqueue is recovered (row re-enqueued on retry) | e2e (duplicate = 1 row) |
| Rate limiting | Redis-backed throttler (global 120/min, webhooks 600/min, OAuth 20/min, resync 3/h) — shared across replicas | e2e (429s) |
| Retries / resilience | every Salla call runs in a BullMQ job: 6 attempts, exponential backoff; 429/5xx/network retried, other 4xx → `UnrecoverableError`; 15 s timeout, bounded body, no redirects; refresh serialised by a Redis lock (Salla refresh tokens are single-use) | e2e |
| Immutable evidence | `webhook_events` (raw body + sha256) and `raw_ingestions` are append-only: runtime role has no `UPDATE/DELETE` (webhook processing columns excepted via column grant) + triggers reject edits | SQL test |
| Input hygiene | all external payloads pass zod mappers that drop unknown fields; the dashboard DTO is rebuilt and re-validated; the web tier re-validates API responses; React renders text only | unit |
| Misc | Helmet + CSP on API; Next middleware sets a per-request-nonce CSP + HSTS/XFO/nosniff; customers stored only as keyed hashes (no name/phone/email); fonts self-hosted; `pnpm audit` clean (Fastify/PostCSS overridden to patched versions) | CI |

## Data Confidence Score (`packages/shared/src/confidence.ts`)

Pure function, 0–100, weighted checks: GA4 connected 15 · purchase event exists 25 · revenue match 30 · order-count match 15 · freshness 10 · currency match 5.
Principles: **missing evidence never earns points** (`unavailable` = 0); meaningless checks (no Salla orders) are `not_applicable` and leave the denominator; GA4 *over*-reporting (duplicate tags) is penalised like under-reporting; money is never compared across currencies. Every run is stored in `data_confidence_audits` (append-only) and drives `decision_recommendations` with evidence pointers.

## ⚠️ Salla-specific assumptions to verify against docs.salla.dev

I could not reach `docs.salla.dev` from my build sandbox, so these come from prior knowledge and **must be checked** before production. Each is isolated to one place:

1. **PKCE**: sent when `SALLA_USE_PKCE=true`. If Salla ignores/rejects the params, set it to `false` (state + nonce still protect the flow).
2. **Webhook auth**: header `X-Salla-Signature` = hex HMAC-SHA256(secret, raw body), or `Authorization` token strategy (`webhook-verify.ts`). Salla does not (to my knowledge) send a unique delivery id, hence body-hash idempotency.
3. **Endpoints/shapes**: `/oauth2/user/info`, `/orders|products|categories?page&per_page`, pagination `{totalPages}`, order `amounts.total`, `date.{date,timezone}` (`salla/mappers.ts`, tolerant + unit-tested; invalid items are skipped, never guessed).
4. **Revenue statuses** (`NON_REVENUE_STATUS_SLUGS`) and the **scopes** in `SALLA_SCOPES` must match your registered app.
5. **Easy-mode install** (`app.store.authorize` webhook carrying tokens) is deliberately *not* wired: the body is stored redacted and never queued. This scaffold uses Custom-mode OAuth.

## Not built yet (honest scope)

GA4 / Search Console / Apify ingestion workers (the auditor already reads `analytics_snapshots`; without GA4 data it correctly reports *low* confidence + a "connect GA4" decision) · competitor scraping & pricing recommendations (tables exist) · member invitations & agency multi-store switching UI · accept/dismiss decision actions · billing. Single JWT secret has no revocation list (8h TTL) — add a Redis denylist/rotation before GA.
