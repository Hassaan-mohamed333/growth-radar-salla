-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "TenantType" AS ENUM ('MERCHANT', 'AGENCY');

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('OWNER', 'AGENCY_ADMIN', 'MARKETER', 'CLIENT_VIEWER');

-- CreateEnum
CREATE TYPE "ConnectionStatus" AS ENUM ('ACTIVE', 'REFRESH_FAILED', 'REVOKED');

-- CreateEnum
CREATE TYPE "WebhookStatus" AS ENUM ('RECEIVED', 'QUEUED', 'PROCESSED', 'FAILED', 'IGNORED');

-- CreateEnum
CREATE TYPE "IngestionSource" AS ENUM ('SALLA_API', 'GA4', 'GSC', 'APIFY');

-- CreateEnum
CREATE TYPE "ConfidenceLevel" AS ENUM ('high', 'medium', 'low', 'insufficient_data');

-- CreateEnum
CREATE TYPE "RecommendationCategory" AS ENUM ('TRACKING', 'PRICING', 'COMPETITOR', 'INVENTORY', 'CAMPAIGN');

-- CreateEnum
CREATE TYPE "Severity" AS ENUM ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW');

-- CreateEnum
CREATE TYPE "RecommendationStatus" AS ENUM ('OPEN', 'ACCEPTED', 'DISMISSED', 'EXPIRED');

-- CreateTable
CREATE TABLE "tenants" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" VARCHAR(200) NOT NULL,
    "type" "TenantType" NOT NULL DEFAULT 'MERCHANT',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" VARCHAR(320),
    "name" VARCHAR(200),
    "salla_user_id" BIGINT,
    "locale" VARCHAR(5) NOT NULL DEFAULT 'ar',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memberships" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "Role" NOT NULL,
    "store_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stores" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "domain" VARCHAR(255),
    "currency" CHAR(3) NOT NULL DEFAULT 'SAR',
    "timezone" VARCHAR(64) NOT NULL DEFAULT 'Asia/Riyadh',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "salla_connections" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "salla_merchant_id" BIGINT NOT NULL,
    "access_token_enc" TEXT NOT NULL,
    "refresh_token_enc" TEXT,
    "access_expires_at" TIMESTAMPTZ(6) NOT NULL,
    "scopes" TEXT[],
    "store_metadata" JSONB NOT NULL DEFAULT '{}',
    "status" "ConnectionStatus" NOT NULL DEFAULT 'ACTIVE',
    "connected_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_refreshed_at" TIMESTAMPTZ(6),
    "last_sync_at" TIMESTAMPTZ(6),
    "revoked_at" TIMESTAMPTZ(6),

    CONSTRAINT "salla_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categories" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "salla_id" BIGINT NOT NULL,
    "parent_salla_id" BIGINT,
    "name" VARCHAR(300) NOT NULL,
    "status" VARCHAR(40),
    "synced_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "salla_id" BIGINT NOT NULL,
    "sku" VARCHAR(120),
    "name" VARCHAR(500) NOT NULL,
    "status" VARCHAR(40),
    "price" DECIMAL(14,2),
    "sale_price" DECIMAL(14,2),
    "currency" CHAR(3),
    "quantity" INTEGER,
    "category_salla_ids" BIGINT[],
    "salla_updated_at" TIMESTAMPTZ(6),
    "synced_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "salla_id" BIGINT NOT NULL,
    "reference_id" VARCHAR(64),
    "status_slug" VARCHAR(60),
    "counts_as_revenue" BOOLEAN NOT NULL DEFAULT false,
    "total_amount" DECIMAL(14,2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "payment_method" VARCHAR(60),
    "customer_hash" CHAR(64),
    "placed_at" TIMESTAMPTZ(6) NOT NULL,
    "salla_updated_at" TIMESTAMPTZ(6),
    "synced_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "idempotency_key" VARCHAR(128) NOT NULL,
    "event" VARCHAR(100) NOT NULL,
    "salla_merchant_id" BIGINT NOT NULL,
    "raw_body" TEXT NOT NULL,
    "body_sha256" CHAR(64) NOT NULL,
    "headers" JSONB NOT NULL,
    "received_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "WebhookStatus" NOT NULL DEFAULT 'RECEIVED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "processed_at" TIMESTAMPTZ(6),
    "last_error" VARCHAR(1000),

    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "raw_ingestions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "source" "IngestionSource" NOT NULL,
    "request_ref" VARCHAR(300) NOT NULL,
    "payload" JSONB NOT NULL,
    "payload_sha256" CHAR(64) NOT NULL,
    "fetched_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "raw_ingestions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analytics_snapshots" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "source" "IngestionSource" NOT NULL DEFAULT 'GA4',
    "day" DATE NOT NULL,
    "revenue" DECIMAL(14,2) NOT NULL,
    "purchases" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "last_purchase_event_at" TIMESTAMPTZ(6),
    "ingestion_id" UUID,

    CONSTRAINT "analytics_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "data_confidence_audits" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "window_start" TIMESTAMPTZ(6) NOT NULL,
    "window_end" TIMESTAMPTZ(6) NOT NULL,
    "score" SMALLINT,
    "level" "ConfidenceLevel" NOT NULL,
    "checks" JSONB NOT NULL,
    "salla_revenue" DECIMAL(14,2) NOT NULL,
    "salla_order_count" INTEGER NOT NULL,
    "ga4_revenue" DECIMAL(14,2),
    "ga4_purchases" INTEGER,
    "currency" CHAR(3) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "data_confidence_audits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "competitors" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "domain" VARCHAR(255) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "competitors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "competitor_observations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "competitor_id" UUID NOT NULL,
    "matched_product_salla_id" BIGINT,
    "url" VARCHAR(2000) NOT NULL,
    "title" VARCHAR(500),
    "price" DECIMAL(14,2),
    "currency" CHAR(3),
    "offer_text" VARCHAR(500),
    "previous_price" DECIMAL(14,2),
    "observed_at" TIMESTAMPTZ(6) NOT NULL,
    "ingestion_id" UUID,

    CONSTRAINT "competitor_observations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "decision_recommendations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "code" VARCHAR(80) NOT NULL,
    "category" "RecommendationCategory" NOT NULL,
    "severity" "Severity" NOT NULL,
    "title_ar" VARCHAR(200) NOT NULL,
    "title_en" VARCHAR(200) NOT NULL,
    "summary_ar" VARCHAR(1000) NOT NULL,
    "summary_en" VARCHAR(1000) NOT NULL,
    "confidence" DECIMAL(4,3) NOT NULL,
    "estimated_revenue_at_risk" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "currency" CHAR(3) NOT NULL,
    "evidence" JSONB NOT NULL DEFAULT '{}',
    "status" "RecommendationStatus" NOT NULL DEFAULT 'OPEN',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6),
    "acted_by" UUID,
    "acted_at" TIMESTAMPTZ(6),

    CONSTRAINT "decision_recommendations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_salla_user_id_key" ON "users"("salla_user_id");

-- CreateIndex
CREATE INDEX "memberships_user_id_idx" ON "memberships"("user_id");

-- CreateIndex
CREATE INDEX "memberships_tenant_id_role_idx" ON "memberships"("tenant_id", "role");

-- CreateIndex
CREATE INDEX "stores_tenant_id_idx" ON "stores"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "stores_tenant_id_id_key" ON "stores"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "salla_connections_store_id_key" ON "salla_connections"("store_id");

-- CreateIndex
CREATE UNIQUE INDEX "salla_connections_salla_merchant_id_key" ON "salla_connections"("salla_merchant_id");

-- CreateIndex
CREATE INDEX "salla_connections_status_access_expires_at_idx" ON "salla_connections"("status", "access_expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "salla_connections_tenant_id_store_id_key" ON "salla_connections"("tenant_id", "store_id");

-- CreateIndex
CREATE INDEX "categories_tenant_id_store_id_idx" ON "categories"("tenant_id", "store_id");

-- CreateIndex
CREATE UNIQUE INDEX "categories_store_id_salla_id_key" ON "categories"("store_id", "salla_id");

-- CreateIndex
CREATE INDEX "products_tenant_id_store_id_status_idx" ON "products"("tenant_id", "store_id", "status");

-- CreateIndex
CREATE INDEX "products_tenant_id_store_id_sku_idx" ON "products"("tenant_id", "store_id", "sku");

-- CreateIndex
CREATE UNIQUE INDEX "products_store_id_salla_id_key" ON "products"("store_id", "salla_id");

-- CreateIndex
CREATE INDEX "orders_tenant_id_store_id_placed_at_idx" ON "orders"("tenant_id", "store_id", "placed_at" DESC);

-- CreateIndex
CREATE INDEX "orders_tenant_id_store_id_counts_as_revenue_placed_at_idx" ON "orders"("tenant_id", "store_id", "counts_as_revenue", "placed_at");

-- CreateIndex
CREATE UNIQUE INDEX "orders_store_id_salla_id_key" ON "orders"("store_id", "salla_id");

-- CreateIndex
CREATE UNIQUE INDEX "webhook_events_idempotency_key_key" ON "webhook_events"("idempotency_key");

-- CreateIndex
CREATE INDEX "webhook_events_tenant_id_store_id_received_at_idx" ON "webhook_events"("tenant_id", "store_id", "received_at" DESC);

-- CreateIndex
CREATE INDEX "webhook_events_status_received_at_idx" ON "webhook_events"("status", "received_at");

-- CreateIndex
CREATE INDEX "raw_ingestions_tenant_id_store_id_source_fetched_at_idx" ON "raw_ingestions"("tenant_id", "store_id", "source", "fetched_at" DESC);

-- CreateIndex
CREATE INDEX "analytics_snapshots_tenant_id_store_id_day_idx" ON "analytics_snapshots"("tenant_id", "store_id", "day" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "analytics_snapshots_store_id_source_day_key" ON "analytics_snapshots"("store_id", "source", "day");

-- CreateIndex
CREATE INDEX "data_confidence_audits_tenant_id_store_id_created_at_idx" ON "data_confidence_audits"("tenant_id", "store_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "competitors_store_id_domain_key" ON "competitors"("store_id", "domain");

-- CreateIndex
CREATE UNIQUE INDEX "competitors_tenant_id_id_key" ON "competitors"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "competitor_observations_tenant_id_store_id_competitor_id_ob_idx" ON "competitor_observations"("tenant_id", "store_id", "competitor_id", "observed_at" DESC);

-- CreateIndex
CREATE INDEX "competitor_observations_tenant_id_store_id_matched_product__idx" ON "competitor_observations"("tenant_id", "store_id", "matched_product_salla_id", "observed_at" DESC);

-- CreateIndex
CREATE INDEX "decision_recommendations_tenant_id_store_id_status_severity_idx" ON "decision_recommendations"("tenant_id", "store_id", "status", "severity", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_tenant_id_store_id_fkey" FOREIGN KEY ("tenant_id", "store_id") REFERENCES "stores"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stores" ADD CONSTRAINT "stores_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "salla_connections" ADD CONSTRAINT "salla_connections_tenant_id_store_id_fkey" FOREIGN KEY ("tenant_id", "store_id") REFERENCES "stores"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_tenant_id_store_id_fkey" FOREIGN KEY ("tenant_id", "store_id") REFERENCES "stores"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_tenant_id_store_id_fkey" FOREIGN KEY ("tenant_id", "store_id") REFERENCES "stores"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_tenant_id_store_id_fkey" FOREIGN KEY ("tenant_id", "store_id") REFERENCES "stores"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_events" ADD CONSTRAINT "webhook_events_tenant_id_store_id_fkey" FOREIGN KEY ("tenant_id", "store_id") REFERENCES "stores"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "raw_ingestions" ADD CONSTRAINT "raw_ingestions_tenant_id_store_id_fkey" FOREIGN KEY ("tenant_id", "store_id") REFERENCES "stores"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analytics_snapshots" ADD CONSTRAINT "analytics_snapshots_tenant_id_store_id_fkey" FOREIGN KEY ("tenant_id", "store_id") REFERENCES "stores"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_confidence_audits" ADD CONSTRAINT "data_confidence_audits_tenant_id_store_id_fkey" FOREIGN KEY ("tenant_id", "store_id") REFERENCES "stores"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "competitors" ADD CONSTRAINT "competitors_tenant_id_store_id_fkey" FOREIGN KEY ("tenant_id", "store_id") REFERENCES "stores"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "competitor_observations" ADD CONSTRAINT "competitor_observations_tenant_id_store_id_fkey" FOREIGN KEY ("tenant_id", "store_id") REFERENCES "stores"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "competitor_observations" ADD CONSTRAINT "competitor_observations_tenant_id_competitor_id_fkey" FOREIGN KEY ("tenant_id", "competitor_id") REFERENCES "competitors"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decision_recommendations" ADD CONSTRAINT "decision_recommendations_tenant_id_store_id_fkey" FOREIGN KEY ("tenant_id", "store_id") REFERENCES "stores"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

