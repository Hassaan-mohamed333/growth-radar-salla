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

Not covered (needs Redis / the live Salla API): OAuth state, webhook idempotency keys,
schedulers' distributed locks, Salla response shapes.
