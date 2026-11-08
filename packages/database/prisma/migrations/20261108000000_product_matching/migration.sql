-- CreateEnum
CREATE TYPE "product_match_status" AS ENUM ('SUGGESTED', 'LINKED', 'CONFIRMED', 'REJECTED');

-- CreateTable
CREATE TABLE "product_matches" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "domain" TEXT NOT NULL,
    "candidate_url" TEXT NOT NULL,
    "candidate_title" TEXT NOT NULL,
    "candidate_price" DECIMAL(12,2),
    "currency" VARCHAR(3) NOT NULL DEFAULT 'SAR',
    "score" INTEGER NOT NULL,
    "status" "product_match_status" NOT NULL DEFAULT 'SUGGESTED',
    "competitor_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "product_matches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "product_matches_tenant_id_idx" ON "product_matches"("tenant_id");

-- CreateIndex
CREATE INDEX "product_matches_store_id_status_score_idx" ON "product_matches"("store_id", "status", "score" DESC);

-- CreateIndex
CREATE INDEX "product_matches_product_id_idx" ON "product_matches"("product_id");

-- CreateIndex
CREATE UNIQUE INDEX "product_matches_store_id_product_id_candidate_url_key" ON "product_matches"("store_id", "product_id", "candidate_url");

-- AddForeignKey
ALTER TABLE "product_matches" ADD CONSTRAINT "product_matches_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_matches" ADD CONSTRAINT "product_matches_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_matches" ADD CONSTRAINT "product_matches_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_matches" ADD CONSTRAINT "product_matches_competitor_id_fkey" FOREIGN KEY ("competitor_id") REFERENCES "competitors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

