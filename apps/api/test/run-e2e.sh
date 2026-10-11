#!/usr/bin/env bash
# Boots fake Salla + the real API (worker included) against local Postgres/Redis and runs test/e2e.mjs.
# Requires: Postgres with migrations applied and the radar_app role (see infra/init-db.sql), and redis-server.
set -euo pipefail
cd "$(dirname "$0")/.."
export NODE_ENV=development PORT=4010 APP_URL=http://localhost:4010 WEB_URL=http://localhost:3000 APP_ROLE=all
export DATABASE_URL="${E2E_DATABASE_URL:-postgresql://radar_app:radar_app_pw@localhost:5439/radar}"
export OWNER_DATABASE_URL="${E2E_OWNER_DATABASE_URL:-postgresql://radar_owner:o@localhost:5439/radar}"
export REDIS_URL=redis://localhost:6390
export SALLA_CLIENT_ID=cid SALLA_CLIENT_SECRET=csecret SALLA_AUTH_URL=http://localhost:4999/auth
export SALLA_USERINFO_URL=http://localhost:4999/oauth2/user/info SALLA_TOKEN_URL=http://localhost:4999/token SALLA_API_BASE=http://localhost:4999/admin/v2
export SALLA_WEBHOOK_SECRET=whsec-test-secret-0123456789 SALLA_WEBHOOK_STRATEGY=signature
export TOKEN_ENCRYPTION_KEYS="k1:$(openssl rand -base64 32)"
export SESSION_JWT_SECRET="$(openssl rand -hex 32)" PII_HASH_KEY="$(openssl rand -hex 32)"
redis-server --port 6390 --save "" --appendonly no >/dev/null & R=$!
node test/fake-salla.mjs & F=$!
node dist/main.js > /tmp/api-e2e.log 2>&1 & A=$!
trap 'kill $R $F $A 2>/dev/null || true' EXIT
for i in $(seq 1 40); do curl -sf localhost:4010/health >/dev/null && break; sleep 0.5; done
node test/e2e.mjs
