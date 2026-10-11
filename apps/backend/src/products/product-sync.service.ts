import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SallaApiClient, type SallaProduct } from '../salla/salla-api.client';
import { SallaConnectionsService } from '../salla/salla-connections.service';
import { toProductValues } from './product-mapping';

/** Upserts per transaction: keeps each transaction short on large catalogues. */
const CHUNK = 100;
/** Below this size the mass-deletion guard does not apply (small shops do clear out). */
const MASS_DELETE_MIN_CATALOGUE = 20;

export interface ProductSyncResult {
  fetched: number;
  skipped: number;
  /** Products no longer in Salla's catalogue, now marked DELETED. */
  removed: number;
}

/**
 * Mirrors the merchant's Salla catalogue into `products`.
 *
 * Idempotent: every run overwrites Salla-owned columns from source data, so the
 * scheduler, product webhooks and the post-login sync can overlap safely.
 */
@Injectable()
export class ProductSyncService {
  private readonly logger = new Logger(ProductSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly connections: SallaConnectionsService,
    private readonly api: SallaApiClient,
  ) {}

  async syncStore(storeId: string): Promise<ProductSyncResult> {
    const store = await this.loadStore(storeId);
    if (!store) return { fetched: 0, skipped: 0, removed: 0 };

    const accessToken = await this.connections.getValidAccessToken(storeId);
    const listing = await this.api.listProducts(accessToken);

    for (let i = 0; i < listing.products.length; i += CHUNK) {
      await this.upsertMany(store, listing.products.slice(i, i + CHUNK));
    }

    const removed = listing.complete ? await this.markMissingDeleted(storeId, listing.products) : 0;
    if (listing.skipped > 0) {
      this.logger.warn(
        `Product sync for store ${storeId} skipped ${listing.skipped} malformed entries`,
      );
    }
    return { fetched: listing.products.length, skipped: listing.skipped, removed };
  }

  /** Single product from a webhook payload. Returns false when the store is unknown/inactive. */
  async upsertOne(storeId: string, product: SallaProduct): Promise<boolean> {
    const store = await this.loadStore(storeId);
    if (!store) return false;
    await this.upsertMany(store, [product]);
    return true;
  }

  /** Soft-deletes: competitor links and recommendations that reference it stay intact. */
  async markDeleted(storeId: string, sallaProductId: string): Promise<void> {
    await this.prisma.product.updateMany({
      where: { storeId, sallaProductId, status: { not: 'DELETED' } },
      data: { status: 'DELETED', syncedAt: new Date() },
    });
  }

  private async markMissingDeleted(
    storeId: string,
    seen: readonly SallaProduct[],
  ): Promise<number> {
    const known = await this.prisma.product.findMany({
      where: { storeId, status: { not: 'DELETED' } },
      select: { sallaProductId: true },
    });
    const seenIds = new Set(seen.map((p) => p.id));
    const missing = known
      .filter((k) => !seenIds.has(k.sallaProductId))
      .map((k) => k.sallaProductId);
    if (missing.length === 0) return 0;

    // Soft-deleting most of a large catalogue in one pass is far more likely a partial or
    // misparsed listing than a merchant clearing their store (product.deleted webhooks
    // cover deletions one by one). Keep the rows and surface it.
    if (known.length >= MASS_DELETE_MIN_CATALOGUE && missing.length > known.length / 2) {
      this.logger.warn(
        `Store ${storeId}: listing is missing ${missing.length}/${known.length} products; keeping rows`,
      );
      return 0;
    }

    // An empty listing next to a populated table is more likely an API hiccup than
    // a merchant deleting everything; product.deleted webhooks cover the real case.
    if (seen.length === 0) {
      this.logger.warn(`Empty product listing for store ${storeId}; keeping ${missing.length} rows`);
      return 0;
    }

    const res = await this.prisma.product.updateMany({
      where: { storeId, sallaProductId: { in: missing }, status: { not: 'DELETED' } },
      data: { status: 'DELETED', syncedAt: new Date() },
    });
    return res.count;
  }

  private async upsertMany(
    store: { tenantId: string; storeId: string; currency: string },
    products: readonly SallaProduct[],
  ): Promise<void> {
    if (products.length === 0) return;
    const now = new Date();
    await this.prisma.$transaction(
      products.map((p) => {
        const values = { ...toProductValues(p, store.currency), syncedAt: now };
        return this.prisma.product.upsert({
          where: { storeId_sallaProductId: { storeId: store.storeId, sallaProductId: p.id } },
          create: {
            tenantId: store.tenantId,
            storeId: store.storeId,
            sallaProductId: p.id,
            ...values,
          },
          update: values,
        });
      }),
    );
  }

  private async loadStore(storeId: string) {
    const store = await this.prisma.store.findUnique({
      where: { id: storeId },
      select: { tenantId: true, currency: true, status: true },
    });
    if (!store || store.status !== 'ACTIVE') return null;
    return { storeId, tenantId: store.tenantId, currency: store.currency };
  }
}
