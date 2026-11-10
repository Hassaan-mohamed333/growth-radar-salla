import { Inject, Injectable, Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import { PrismaService } from '../prisma/prisma.service';
import { REDIS } from '../redis/redis.module';

export interface HealthReport {
  status: 'ok' | 'down';
  checks: { database: 'up' | 'down'; redis: 'up' | 'down' };
}

const CHECK_TIMEOUT_MS = 3_000;

/**
 * Liveness for uptime monitors and load balancers: can we reach PostgreSQL and Redis right now.
 * Public by design, so it reports only up/down per dependency, never versions, hosts or errors.
 */
@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async check(): Promise<HealthReport> {
    const [database, redis] = await Promise.all([
      this.probe('database', () => this.prisma.$queryRaw`SELECT 1`),
      this.probe('redis', () => this.redis.ping()),
    ]);
    return { status: database === 'up' && redis === 'up' ? 'ok' : 'down', checks: { database, redis } };
  }

  private async probe(name: string, fn: () => PromiseLike<unknown>): Promise<'up' | 'down'> {
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        Promise.resolve(fn()),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('timeout')), CHECK_TIMEOUT_MS);
        }),
      ]);
      return 'up';
    } catch (err) {
      // Name only: connection errors can embed hostnames or credentials.
      this.logger.error(`Health check failed: ${name} (${err instanceof Error ? err.name : 'error'})`);
      return 'down';
    } finally {
      clearTimeout(timer);
    }
  }
}
