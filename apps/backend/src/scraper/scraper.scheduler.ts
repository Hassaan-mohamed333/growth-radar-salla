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
import {
  CompetitorPriceScraperService,
  type ScrapeTarget,
} from './competitor-price-scraper.service';

const LOCK_KEY = 'scraper:lock:v1';
const LOCK_TTL_SECONDS = 15 * 60;
const TICK_MS = 5 * 60 * 1000;
const FIRST_RUN_DELAY_MS = 45_000;
/** Distinct domains fetched in parallel; requests to one domain stay sequential. */
const DOMAIN_CONCURRENCY = 4;

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Finds listings whose `next_scrape_at` has passed and scrapes them, politely:
 * one request at a time per domain with a delay in between, and a domain that
 * blocks us is left alone until the next tick.
 */
@Injectable()
export class ScraperScheduler implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(ScraperScheduler.name);
  private timer?: NodeJS.Timeout;
  private first?: NodeJS.Timeout;
  private running = false;
  private stopping = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly scraper: CompetitorPriceScraperService,
    private readonly config: ConfigService<Env, true>,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.config.get('SCRAPER_ENABLED', { infer: true })) {
      this.logger.log('Competitor price scraping is disabled (SCRAPER_ENABLED=false)');
      return;
    }
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    this.first = setTimeout(() => void this.tick(), FIRST_RUN_DELAY_MS);
    this.timer.unref();
    this.first.unref();
  }

  onModuleDestroy(): void {
    this.stopping = true;
    clearInterval(this.timer);
    clearTimeout(this.first);
  }

  /** One pass over due listings. `sleep` is injectable for tests. */
  async tick(sleep: (ms: number) => Promise<void> = realSleep, now = new Date()): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    let locked = false;
    try {
      locked = (await this.redis.set(LOCK_KEY, '1', 'EX', LOCK_TTL_SECONDS, 'NX')) === 'OK';
      if (!locked) return 0;

      const due = await this.loadDue(now);
      const byDomain = new Map<string, ScrapeTarget[]>();
      for (const c of due) {
        const group = byDomain.get(c.domain) ?? [];
        group.push(c.target);
        byDomain.set(c.domain, group);
      }

      const delayMs = this.config.get('SCRAPER_DOMAIN_DELAY_MS', { infer: true });
      let attempted = 0;
      await runPool([...byDomain.values()], DOMAIN_CONCURRENCY, async (group) => {
        for (const [i, target] of group.entries()) {
          if (this.stopping) return;
          if (i > 0) await sleep(delayMs);
          attempted++;
          try {
            const outcome = await this.scraper.scrape(target, now);
            // The site is refusing us: leave the rest of its listings for a later tick.
            if (!outcome.ok && outcome.kind === 'blocked') return;
          } catch (err) {
            this.logger.error(
              `Scrape crashed for competitor ${target.id}: ${err instanceof Error ? err.name : 'error'}`,
            );
          }
        }
      });
      return attempted;
    } catch (err) {
      this.logger.error(`Scraper tick failed: ${err instanceof Error ? err.name : 'error'}`);
      return 0;
    } finally {
      if (locked) await this.redis.del(LOCK_KEY).catch(() => undefined);
      this.running = false;
    }
  }

  private async loadDue(now: Date): Promise<Array<{ domain: string; target: ScrapeTarget }>> {
    const rows = await this.prisma.competitor.findMany({
      where: {
        isActive: true,
        productUrl: { not: null },
        store: { status: 'ACTIVE' },
        OR: [{ nextScrapeAt: null }, { nextScrapeAt: { lte: now } }],
      },
      orderBy: { nextScrapeAt: { sort: 'asc', nulls: 'first' } },
      take: this.config.get('SCRAPER_BATCH_SIZE', { infer: true }),
      select: {
        id: true,
        storeId: true,
        domain: true,
        productUrl: true,
        currency: true,
        scrapeFailures: true,
      },
    });

    return rows.flatMap((r) =>
      r.productUrl
        ? [
            {
              domain: r.domain,
              target: {
                id: r.id,
                storeId: r.storeId,
                productUrl: r.productUrl,
                currency: r.currency,
                scrapeFailures: r.scrapeFailures,
              },
            },
          ]
        : [],
    );
  }
}

async function runPool<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const lanes = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++]!;
      await worker(item);
    }
  });
  await Promise.all(lanes);
}
