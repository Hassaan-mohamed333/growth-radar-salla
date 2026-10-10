# Integration tests

Run against a **real PostgreSQL** with the checked-in Prisma migrations applied
(`prisma migrate deploy`), so they exercise what production runs: raw SQL, row locks,
unique constraints, cascades and the HTTP layer.

```bash
pnpm test:integration                      # from the repo root
pnpm --filter @growth-radar/backend test:integration -- http   # one suite
```

By default an **embedded PostgreSQL 16** (npm `embedded-postgres`, UTF8) is started on a
free port and deleted afterwards - no Docker needed. To use your own server instead:

```bash
pnpm infra:up
TEST_DATABASE_URL=postgresql://radar:radar@localhost:5432/growth_radar_test pnpm test:integration
```

The database name **must contain "test"**: every suite truncates all tables.

| Suite | Proves |
| --- | --- |
| `schema` | Migrations create the tables/indexes the client expects; cascades |
| `analytics` | Dashboard raw SQL (undercutting, price trends, sales velocity) |
| `competitor-prices` | `FOR UPDATE` serialises concurrent price observations; history chain |
| `product-sync` | Catalogue upsert / soft-delete / chunking / product webhooks |
| `recommendations` | Engine lifecycle, suppression, concurrent decisions |
| `tenant-isolation` | Every read/write is scoped to the session's store |
| `http` | Auth, zod validation, SSRF rejection, and the full merchant flow over HTTP |
| `oauth` | Salla login over HTTP: PKCE S256, single-use state bound to the browser cookie, encrypted token storage, re-authorization, callback race |
| `token-refresh` | Refresh once for concurrent callers and across instances (Redis lock), rotation, rejected vs transient failures |
| `webhooks` | HMAC verification, duplicate/concurrent delivery idempotency, key release on failure, event routing |
| `schedulers` | One instance syncs per interval (Redis lock), failures are isolated per store, inactive stores skipped |

Redis is **emulated** (`ioredis-mock`): the code only uses `SET EX/NX`, `GETDEL` and `DEL`, but this is
not a real server. Salla is **faked at the HTTP boundary** (`accounts.salla.sa`), so response shapes are
our assumptions, not captured traffic.

Not covered: the live Salla API (real response shapes, real consent screen), real competitor sites,
and a real Redis server.
