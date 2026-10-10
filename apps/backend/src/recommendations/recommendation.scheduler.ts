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
import { RecommendationEngineService } from './recommendation-engine.service';

const LOCK_KEY = 'recommendations:lock:v1';
const FIRST_RUN_DELAY_MS = 90_000;

/** Periodic pass of the recommendation engine over every active store. */
@Injectable()
export class RecommendationScheduler implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(RecommendationScheduler.name);
  private timer?: NodeJS.Timeout;
  private first?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly engine: RecommendationEngineService,
    private readonly config: ConfigService<Env, true>,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.config.get('RECOMMENDATIONS_ENABLED', { infer: true })) {
      this.logger.log('Recommendation engine is disabled (RECOMMENDATIONS_ENABLED=false)');
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

  /** One pass over every active store. Exposed for tests. */
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const ttl = Math.max(60, Math.floor(this.intervalMs() / 1000) - 5);
      const acquired = await this.redis.set(LOCK_KEY, '1', 'EX', ttl, 'NX');
      if (!acquired) return;

      const stores = await this.prisma.store.findMany({
        where: { status: 'ACTIVE' },
        select: { id: true },
      });

      for (const { id } of stores) {
        try {
          const r = await this.engine.generateForStore(id);
          if (r.created + r.updated + r.expired > 0) {
            this.logger.log(
              `Store ${id}: ${r.created} new, ${r.updated} updated, ${r.expired} expired recommendation(s)`,
            );
          }
        } catch (err) {
          // One store's failure must not stop the others. Log the class only.
          this.logger.warn(
            `Recommendation run skipped store ${id}: ${err instanceof Error ? err.name : 'error'}`,
          );
        }
      }
    } catch (err) {
      this.logger.error(`Recommendation tick failed: ${err instanceof Error ? err.name : 'error'}`);
    } finally {
      this.running = false;
    }
  }

  private intervalMs(): number {
    return this.config.get('RECOMMENDATIONS_INTERVAL_MINUTES', { infer: true }) * 60_000;
  }
}
