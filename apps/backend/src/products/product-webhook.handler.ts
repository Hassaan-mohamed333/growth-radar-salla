import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SallaApiError, parseSallaProduct } from '../salla/salla-api.client';
import { SallaConnectionUnavailableError } from '../salla/salla-connections.service';
import { ProductSyncService } from './product-sync.service';

/** Turns `product.*` webhooks into catalogue updates. */
@Injectable()
export class ProductWebhookHandler {
  private readonly logger = new Logger(ProductWebhookHandler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sync: ProductSyncService,
  ) {}

  static handles(event: string): boolean {
    return event.startsWith('product.');
  }

  /**
   * Throws on transient failures so the idempotency interceptor releases the key
   * and Salla's retry is processed; unrecoverable cases are logged and swallowed.
   */
  async handle(event: string, merchant: number | string | undefined, data: unknown): Promise<void> {
    if (merchant === undefined || merchant === null) return;

    const store = await this.prisma.store.findUnique({
      where: { sallaMerchantId: String(merchant) },
      select: { id: true },
    });
    if (!store) {
      this.logger.debug(`Product event for unknown merchant ${merchant}`);
      return;
    }

    if (event === 'product.deleted') {
      const id = rawId(data);
      if (id) await this.sync.markDeleted(store.id, id);
      return;
    }

    // Prefer the payload (no API round-trip); a partial payload falls back to a full sync.
    const product = parseSallaProduct(data);
    try {
      if (product) {
        await this.sync.upsertOne(store.id, product);
      } else {
        await this.sync.syncStore(store.id);
      }
    } catch (err) {
      // Retrying cannot fix a missing connection or a missing products.read scope.
      const unrecoverable =
        err instanceof SallaConnectionUnavailableError ||
        (err instanceof SallaApiError && (err.status === 401 || err.status === 403));
      if (unrecoverable) {
        this.logger.warn(`Product event ignored for store ${store.id}: connection unavailable`);
        return;
      }
      throw err;
    }
  }
}

function rawId(data: unknown): string | null {
  if (typeof data !== 'object' || data === null) return null;
  const id = (data as { id?: unknown }).id;
  if (typeof id === 'string' && id) return id;
  if (typeof id === 'number' && Number.isFinite(id)) return String(id);
  return null;
}
