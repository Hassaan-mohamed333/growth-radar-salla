import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type Redis from 'ioredis';
import type { Env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { REDIS } from '../redis/redis.module';
import { SallaApiError } from '../salla/salla-api.client';
import { SallaConnectionUnavailableError } from '../salla/salla-connections.service';
import { ProductSyncService } from './product-sync.service';

const LOCK_KEY = 'sync:products:lock:v1';
const FIRST_RUN_DELAY_MS = 45_000;

/**
 * In-process interval worker for the catalogue sync. A Redis lock makes it safe
 * to run on several instances: only one of them syncs per interval.
 */
@Injectable()
export class ProductSyncScheduler implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(ProductSyncScheduler.name);
  private timer?: NodeJS.Timeout;
  private first?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly sync: ProductSyncService,
    private readonly config: ConfigService<Env, true>,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.config.get('PRODUCT_SYNC_ENABLED', { infer: true })) {
      this.logger.log('Scheduled product sync is disabled (PRODUCT_SYNC_ENABLED=false)');
      return;
    }
    this.timer = setInterval(() => void this.tick(), this.intervalMs());
    this.first = setTimeout(() => void this.tick(), FIRST_RUN_DELAY_MS);
    this.timer.unref();
    this.first.unref();
  }

  onModuleDestroy(): void {
    clearInterval(this.timer);
    clearTimeout(this.first);
  }

  /** One pass over every active, connected store. Exposed for tests. */
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const ttl = Math.max(60, Math.floor(this.intervalMs() / 1000) - 5);
      const acquired = await this.redis.set(LOCK_KEY, '1', 'EX', ttl, 'NX');
      if (!acquired) return;

      const stores = await this.prisma.store.findMany({
        where: { status: 'ACTIVE', connection: { is: { status: 'ACTIVE' } } },
        select: { id: true },
      });

      for (const { id } of stores) {
        try {
          await this.sync.syncStore(id);
        } catch (err) {
          // One merchant's failure must not stop the others. Log the class only.
          const reauth =
            err instanceof SallaConnectionUnavailableError ||
            (err instanceof SallaApiError && (err.status === 401 || err.status === 403));
          this.logger.warn(
            `Product sync skipped store ${id}: ${err instanceof Error ? err.name : 'error'}${reauth ? ' (needs re-authorization / products.read scope)' : ''}`,
          );
        }
      }
    } catch (err) {
      this.logger.error(`Product sync tick failed: ${err instanceof Error ? err.name : 'error'}`);
    } finally {
      this.running = false;
    }
  }

  private intervalMs(): number {
    return this.config.get('PRODUCT_SYNC_INTERVAL_MINUTES', { infer: true }) * 60_000;
  }
}
