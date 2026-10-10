-- Scrape scheduling/backoff state for competitor listings.
ALTER TABLE "competitors"
  ADD COLUMN "scrape_failures" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "last_scrape_error" TEXT,
  ADD COLUMN "next_scrape_at" TIMESTAMPTZ(6);

CREATE INDEX "competitors_is_active_next_scrape_at_idx" ON "competitors"("is_active", "next_scrape_at");
