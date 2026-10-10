-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "tenant_status" AS ENUM ('ACTIVE', 'SUSPENDED', 'CLOSED');

-- CreateEnum
CREATE TYPE "store_status" AS ENUM ('ACTIVE', 'UNINSTALLED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "user_role" AS ENUM ('OWNER', 'ADMIN', 'ANALYST', 'VIEWER');

-- CreateEnum
CREATE TYPE "connection_status" AS ENUM ('ACTIVE', 'EXPIRED', 'REVOKED', 'ERROR');

-- CreateEnum
CREATE TYPE "product_status" AS ENUM ('SALE', 'OUT', 'HIDDEN', 'DELETED');

-- CreateEnum
CREATE TYPE "audit_status" AS ENUM ('PASSED', 'WARNING', 'FAILED');

-- CreateEnum
CREATE TYPE "recommendation_type" AS ENUM ('PRICE_ADJUSTMENT', 'RESTOCK', 'PROMOTION', 'COMPETITOR_ALERT', 'LISTING_IMPROVEMENT');

-- CreateEnum
CREATE TYPE "recommendation_status" AS ENUM ('PENDING', 'ACCEPTED', 'DISMISSED', 'EXPIRED', 'APPLIED');

-- CreateTable
CREATE TABLE "tenants" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" "tenant_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stores" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "salla_merchant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "domain" TEXT,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'SAR',
    "locale" VARCHAR(10) NOT NULL DEFAULT 'ar',
    "status" "store_status" NOT NULL DEFAULT 'ACTIVE',
    "installed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uninstalled_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "stores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "role" "user_role" NOT NULL DEFAULT 'VIEWER',
    "salla_user_id" TEXT,
    "last_login_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "encrypted_salla_connections" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "access_token_enc" TEXT NOT NULL,
    "refresh_token_enc" TEXT,
    "key_version" INTEGER NOT NULL DEFAULT 1,
    "scopes" TEXT[],
    "access_token_expires_at" TIMESTAMPTZ(6),
    "last_refreshed_at" TIMESTAMPTZ(6),
    "status" "connection_status" NOT NULL DEFAULT 'ACTIVE',
    "last_error" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "encrypted_salla_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "salla_product_id" TEXT NOT NULL,
    "sku" TEXT,
    "name" TEXT NOT NULL,
    "price" DECIMAL(12,2) NOT NULL,
    "sale_price" DECIMAL(12,2),
    "cost_price" DECIMAL(12,2),
    "currency" VARCHAR(3) NOT NULL DEFAULT 'SAR',
    "quantity" INTEGER,
    "status" "product_status" NOT NULL DEFAULT 'SALE',
    "url" TEXT,
    "image_url" TEXT,
    "raw_payload" JSONB,
    "synced_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "competitors" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "product_id" UUID,
    "name" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "product_url" TEXT,
    "last_price" DECIMAL(12,2),
    "currency" VARCHAR(3) NOT NULL DEFAULT 'SAR',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_checked_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "competitors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "competitor_price_history" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "competitor_id" UUID NOT NULL,
    "price" DECIMAL(12,2) NOT NULL,
    "previous_price" DECIMAL(12,2),
    "currency" VARCHAR(3) NOT NULL DEFAULT 'SAR',
    "in_stock" BOOLEAN,
    "source" TEXT NOT NULL,
    "observed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "competitor_price_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_snapshots" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "orders_count" INTEGER NOT NULL DEFAULT 0,
    "units_sold" INTEGER NOT NULL DEFAULT 0,
    "gross_revenue" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "refunded_revenue" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'SAR',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "sales_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "data_confidence_audits" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" UUID NOT NULL,
    "source" TEXT NOT NULL,
    "confidence_score" DECIMAL(4,3) NOT NULL,
    "status" "audit_status" NOT NULL,
    "checks" JSONB NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "data_confidence_audits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "decision_recommendations" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "product_id" UUID,
    "confidence_audit_id" UUID,
    "type" "recommendation_type" NOT NULL,
    "status" "recommendation_status" NOT NULL DEFAULT 'PENDING',
    "title" TEXT NOT NULL,
    "rationale" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "expires_at" TIMESTAMPTZ(6),
    "decided_by_user_id" UUID,
    "decided_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "decision_recommendations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenants_slug_key" ON "tenants"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "stores_salla_merchant_id_key" ON "stores"("salla_merchant_id");

-- CreateIndex
CREATE INDEX "stores_tenant_id_idx" ON "stores"("tenant_id");

-- CreateIndex
CREATE INDEX "users_tenant_id_idx" ON "users"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_tenant_id_email_key" ON "users"("tenant_id", "email");

-- CreateIndex
CREATE UNIQUE INDEX "encrypted_salla_connections_store_id_key" ON "encrypted_salla_connections"("store_id");

-- CreateIndex
CREATE INDEX "encrypted_salla_connections_tenant_id_idx" ON "encrypted_salla_connections"("tenant_id");

-- CreateIndex
CREATE INDEX "encrypted_salla_connections_status_access_token_expires_at_idx" ON "encrypted_salla_connections"("status", "access_token_expires_at");

-- CreateIndex
CREATE INDEX "products_tenant_id_idx" ON "products"("tenant_id");

-- CreateIndex
CREATE INDEX "products_store_id_status_idx" ON "products"("store_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "products_store_id_salla_product_id_key" ON "products"("store_id", "salla_product_id");

-- CreateIndex
CREATE INDEX "competitors_tenant_id_idx" ON "competitors"("tenant_id");

-- CreateIndex
CREATE INDEX "competitors_store_id_is_active_idx" ON "competitors"("store_id", "is_active");

-- CreateIndex
CREATE INDEX "competitors_product_id_idx" ON "competitors"("product_id");

-- CreateIndex
CREATE UNIQUE INDEX "competitors_store_id_domain_product_url_key" ON "competitors"("store_id", "domain", "product_url");

-- CreateIndex
CREATE INDEX "competitor_price_history_competitor_id_observed_at_idx" ON "competitor_price_history"("competitor_id", "observed_at" DESC);

-- CreateIndex
CREATE INDEX "competitor_price_history_store_id_observed_at_idx" ON "competitor_price_history"("store_id", "observed_at" DESC);

-- CreateIndex
CREATE INDEX "competitor_price_history_tenant_id_idx" ON "competitor_price_history"("tenant_id");

-- CreateIndex
CREATE INDEX "sales_snapshots_tenant_id_idx" ON "sales_snapshots"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "sales_snapshots_store_id_date_key" ON "sales_snapshots"("store_id", "date");

-- CreateIndex
CREATE INDEX "data_confidence_audits_tenant_id_idx" ON "data_confidence_audits"("tenant_id");

-- CreateIndex
CREATE INDEX "data_confidence_audits_store_id_entity_type_entity_id_idx" ON "data_confidence_audits"("store_id", "entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "data_confidence_audits_store_id_created_at_idx" ON "data_confidence_audits"("store_id", "created_at");

-- CreateIndex
CREATE INDEX "decision_recommendations_tenant_id_idx" ON "decision_recommendations"("tenant_id");

-- CreateIndex
CREATE INDEX "decision_recommendations_store_id_status_created_at_idx" ON "decision_recommendations"("store_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "decision_recommendations_product_id_idx" ON "decision_recommendations"("product_id");

-- AddForeignKey
ALTER TABLE "stores" ADD CONSTRAINT "stores_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "encrypted_salla_connections" ADD CONSTRAINT "encrypted_salla_connections_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "encrypted_salla_connections" ADD CONSTRAINT "encrypted_salla_connections_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "competitors" ADD CONSTRAINT "competitors_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "competitors" ADD CONSTRAINT "competitors_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "competitors" ADD CONSTRAINT "competitors_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "competitor_price_history" ADD CONSTRAINT "competitor_price_history_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "competitor_price_history" ADD CONSTRAINT "competitor_price_history_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "competitor_price_history" ADD CONSTRAINT "competitor_price_history_competitor_id_fkey" FOREIGN KEY ("competitor_id") REFERENCES "competitors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_snapshots" ADD CONSTRAINT "sales_snapshots_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_snapshots" ADD CONSTRAINT "sales_snapshots_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_confidence_audits" ADD CONSTRAINT "data_confidence_audits_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_confidence_audits" ADD CONSTRAINT "data_confidence_audits_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decision_recommendations" ADD CONSTRAINT "decision_recommendations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decision_recommendations" ADD CONSTRAINT "decision_recommendations_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decision_recommendations" ADD CONSTRAINT "decision_recommendations_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decision_recommendations" ADD CONSTRAINT "decision_recommendations_confidence_audit_id_fkey" FOREIGN KEY ("confidence_audit_id") REFERENCES "data_confidence_audits"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decision_recommendations" ADD CONSTRAINT "decision_recommendations_decided_by_user_id_fkey" FOREIGN KEY ("decided_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

