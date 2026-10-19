-- CreateEnum
CREATE TYPE "discovery_status" AS ENUM ('SUGGESTED', 'ADDED', 'DISMISSED');

-- CreateTable
CREATE TABLE "competitor_discoveries" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "catalog_key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "country_code" VARCHAR(2) NOT NULL DEFAULT 'SA',
    "currency" VARCHAR(3) NOT NULL DEFAULT 'SAR',
    "niches" TEXT[],
    "score" INTEGER NOT NULL,
    "reasons" JSONB NOT NULL,
    "status" "discovery_status" NOT NULL DEFAULT 'SUGGESTED',
    "competitor_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "competitor_discoveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "niche_insights" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "niche" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "product_count" INTEGER NOT NULL,
    "share_pct" DECIMAL(5,1) NOT NULL,
    "tracked_competitors" INTEGER NOT NULL,
    "suggested_competitors" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "niche_insights_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "swot_reports" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "strengths" JSONB NOT NULL,
    "weaknesses" JSONB NOT NULL,
    "opportunities" JSONB NOT NULL,
    "threats" JSONB NOT NULL,
    "basis" JSONB NOT NULL,
    "generated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "swot_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "competitor_discoveries_tenant_id_idx" ON "competitor_discoveries"("tenant_id");

-- CreateIndex
CREATE INDEX "competitor_discoveries_store_id_status_score_idx" ON "competitor_discoveries"("store_id", "status", "score" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "competitor_discoveries_store_id_domain_key" ON "competitor_discoveries"("store_id", "domain");

-- CreateIndex
CREATE INDEX "niche_insights_tenant_id_idx" ON "niche_insights"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "niche_insights_store_id_niche_key" ON "niche_insights"("store_id", "niche");

-- CreateIndex
CREATE INDEX "swot_reports_tenant_id_idx" ON "swot_reports"("tenant_id");

-- CreateIndex
CREATE INDEX "swot_reports_store_id_generated_at_idx" ON "swot_reports"("store_id", "generated_at" DESC);

-- AddForeignKey
ALTER TABLE "competitor_discoveries" ADD CONSTRAINT "competitor_discoveries_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "competitor_discoveries" ADD CONSTRAINT "competitor_discoveries_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "competitor_discoveries" ADD CONSTRAINT "competitor_discoveries_competitor_id_fkey" FOREIGN KEY ("competitor_id") REFERENCES "competitors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "niche_insights" ADD CONSTRAINT "niche_insights_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "niche_insights" ADD CONSTRAINT "niche_insights_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "swot_reports" ADD CONSTRAINT "swot_reports_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "swot_reports" ADD CONSTRAINT "swot_reports_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

