-- 0002_security: Row-Level Security, immutability, integrity constraints, and the few
-- SECURITY DEFINER lookups that must work BEFORE a tenant context exists.
--
-- The app sets the tenant per transaction:  SELECT set_config('app.tenant_id', '<uuid>', true);
-- With no setting, app_tenant_id() is NULL and every policy evaluates to NULL => zero rows (fail closed).

CREATE OR REPLACE FUNCTION app_tenant_id() RETURNS uuid
LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid $$;

-- ---------------------------------------------------------------------------
-- 1. Row-Level Security (FORCE => applies even to the table owner)
-- ---------------------------------------------------------------------------
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tenants
  USING (id = app_tenant_id()) WITH CHECK (id = app_tenant_id());

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'stores','memberships','salla_connections','categories','products','orders',
    'webhook_events','raw_ingestions','analytics_snapshots','data_confidence_audits',
    'competitors','competitor_observations','decision_recommendations'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id())', t);
  END LOOP;
END $$;

-- NOTE: `users` is a global identity table (an agency employee spans tenants) and is intentionally
-- not RLS-scoped. It is only touched by AuthService (by id / salla_user_id), never joined in tenant queries.

-- ---------------------------------------------------------------------------
-- 2. Integrity constraints
-- ---------------------------------------------------------------------------
-- One membership per (tenant, user, store); NULL store ("all stores") participates in uniqueness.
CREATE UNIQUE INDEX memberships_tenant_user_store_uq
  ON memberships (tenant_id, user_id, COALESCE(store_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- At most one OPEN recommendation per (store, code): regeneration upserts instead of piling up.
CREATE UNIQUE INDEX decision_recommendations_open_uq
  ON decision_recommendations (store_id, code) WHERE status = 'OPEN';

-- Tokens can only be stored as our AES-GCM envelope; a plaintext token fails the insert.
ALTER TABLE salla_connections
  ADD CONSTRAINT access_token_is_envelope  CHECK (access_token_enc  ~ '^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$'),
  ADD CONSTRAINT refresh_token_is_envelope CHECK (refresh_token_enc IS NULL OR refresh_token_enc ~ '^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$');

ALTER TABLE orders ADD CONSTRAINT orders_total_nonneg CHECK (total_amount >= 0);
ALTER TABLE orders ADD CONSTRAINT orders_currency_upper CHECK (currency = upper(currency));
ALTER TABLE stores ADD CONSTRAINT stores_currency_upper CHECK (currency = upper(currency));
ALTER TABLE data_confidence_audits ADD CONSTRAINT audit_score_range CHECK (score IS NULL OR score BETWEEN 0 AND 100);
ALTER TABLE decision_recommendations
  ADD CONSTRAINT rec_confidence_range CHECK (confidence BETWEEN 0 AND 1),
  ADD CONSTRAINT rec_risk_nonneg CHECK (estimated_revenue_at_risk >= 0);
ALTER TABLE webhook_events ADD CONSTRAINT webhook_sha_hex CHECK (body_sha256 ~ '^[0-9a-f]{64}$');

-- ---------------------------------------------------------------------------
-- 3. Immutable evidence
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION forbid_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only (immutable evidence)', TG_TABLE_NAME USING ERRCODE = 'integrity_constraint_violation';
END $$;

CREATE TRIGGER raw_ingestions_immutable BEFORE UPDATE ON raw_ingestions
  FOR EACH ROW EXECUTE FUNCTION forbid_update();
CREATE TRIGGER confidence_audits_immutable BEFORE UPDATE ON data_confidence_audits
  FOR EACH ROW EXECUTE FUNCTION forbid_update();

-- webhook_events: processing columns are mutable, the raw evidence columns are not.
CREATE OR REPLACE FUNCTION webhook_events_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.store_id IS DISTINCT FROM OLD.store_id
     OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
     OR NEW.event IS DISTINCT FROM OLD.event
     OR NEW.salla_merchant_id IS DISTINCT FROM OLD.salla_merchant_id
     OR NEW.raw_body IS DISTINCT FROM OLD.raw_body
     OR NEW.body_sha256 IS DISTINCT FROM OLD.body_sha256
     OR NEW.headers IS DISTINCT FROM OLD.headers
     OR NEW.received_at IS DISTINCT FROM OLD.received_at THEN
    RAISE EXCEPTION 'webhook_events raw evidence columns are immutable' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER webhook_events_immutable BEFORE UPDATE ON webhook_events
  FOR EACH ROW EXECUTE FUNCTION webhook_events_guard();

-- ---------------------------------------------------------------------------
-- 4. Pre-tenant-context lookups (SECURITY DEFINER, minimal surface, fixed search_path)
-- ---------------------------------------------------------------------------
-- Webhook path: after the HMAC is verified, which tenant/store owns this Salla merchant?
CREATE OR REPLACE FUNCTION resolve_tenant_by_merchant(p_merchant bigint)
RETURNS TABLE (tenant_id uuid, store_id uuid, status "ConnectionStatus") LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT c.tenant_id, c.store_id, c.status FROM salla_connections c WHERE c.salla_merchant_id = p_merchant
$$;

-- Login path: which tenants can this user enter, with which role?
CREATE OR REPLACE FUNCTION list_user_memberships(p_user uuid)
RETURNS TABLE (tenant_id uuid, role "Role", store_id uuid) LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT m.tenant_id, m.role, m.store_id FROM memberships m WHERE m.user_id = p_user
$$;

-- Token-refresh scheduler: connections that need a refresh soon (ids only, no secrets).
CREATE OR REPLACE FUNCTION list_expiring_connections(p_within interval)
RETURNS TABLE (tenant_id uuid, store_id uuid) LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT c.tenant_id, c.store_id FROM salla_connections c
  WHERE c.status = 'ACTIVE' AND c.access_expires_at < now() + p_within
$$;

-- Nightly audit scheduler: all active connections (ids only).
CREATE OR REPLACE FUNCTION list_active_connections()
RETURNS TABLE (tenant_id uuid, store_id uuid) LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT c.tenant_id, c.store_id FROM salla_connections c WHERE c.status = 'ACTIVE'
$$;

-- ---------------------------------------------------------------------------
-- 5. Least-privilege grants for the runtime role (skipped when the role doesn't exist, e.g. CI)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  REVOKE ALL ON FUNCTION resolve_tenant_by_merchant(bigint), list_user_memberships(uuid),
                         list_expiring_connections(interval), list_active_connections() FROM PUBLIC;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'radar_app') THEN
    GRANT EXECUTE ON FUNCTION resolve_tenant_by_merchant(bigint), list_user_memberships(uuid),
                              list_expiring_connections(interval), list_active_connections() TO radar_app;
    GRANT USAGE ON SCHEMA public TO radar_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO radar_app;
    -- Evidence tables: the runtime role can append and read, never rewrite or delete.
    REVOKE UPDATE, DELETE ON raw_ingestions, data_confidence_audits FROM radar_app;
    REVOKE UPDATE, DELETE ON webhook_events FROM radar_app;
    GRANT UPDATE (status, attempts, processed_at, last_error) ON webhook_events TO radar_app;
    -- The migration bookkeeping table must not be writable by the app.
    IF to_regclass('public._prisma_migrations') IS NOT NULL THEN
      REVOKE ALL ON _prisma_migrations FROM radar_app;
    END IF;
  END IF;
END $$;
