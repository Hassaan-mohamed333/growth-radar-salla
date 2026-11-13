import { Inject, Injectable, Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import { PrismaService } from '../prisma/prisma.service';
import { REDIS } from '../redis/redis.module';

export interface HealthReport {
  status: 'ok' | 'down';
  checks: { database: 'up' | 'down'; redis: 'up' | 'down' };
  /** Which deployment answered: the host platform's service name and short commit. */
  instance: { service: string | null; commit: string | null };
}

const CHECK_TIMEOUT_MS = 3_000;

/**
 * Liveness for uptime monitors and load balancers: can we reach PostgreSQL and Redis right now.
 * Public by design, so it reports up/down per dependency and which deployment answered (service
 * name and short commit, so a cut-over between two backends can be verified), never hosts,
 * credentials or error details.
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
    return {
      status: database === 'up' && redis === 'up' ? 'ok' : 'down',
      checks: { database, redis },
      instance: {
        // Render sets both; absent elsewhere (local runs, tests). Not secrets: the service name is
        // already in its public hostname and the commit is public in the repository.
        service: process.env.RENDER_SERVICE_NAME ?? null,
        commit: process.env.RENDER_GIT_COMMIT?.slice(0, 7) ?? null,
      },
    };
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
