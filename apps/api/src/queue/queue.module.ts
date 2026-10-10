import { BullModule } from '@nestjs/bullmq';
import { Global, Module } from '@nestjs/common';
import { QUEUES } from '@radar/shared';
import { ENV, type Env } from '../config/env';

/**
 * Every external call (Salla, Google, Apify) runs inside a BullMQ job so it gets retries with
 * exponential backoff, persistence across restarts, and concurrency limits — never inline in a request.
 */
export const DEFAULT_JOB_OPTIONS = {
  attempts: 6,
  backoff: { type: 'exponential' as const, delay: 5_000 }, // 5s,10s,20s,40s,80s
  removeOnComplete: { age: 24 * 3600, count: 5_000 },
  removeOnFail: { age: 14 * 24 * 3600 },
};

@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [ENV],
      useFactory: (env: Env) => {
        const u = new URL(env.REDIS_URL);
        return {
          connection: {
            host: u.hostname,
            port: Number(u.port || 6379),
            username: u.username || undefined,
            password: u.password ? decodeURIComponent(u.password) : undefined,
            tls: u.protocol === 'rediss:' ? {} : undefined,
            maxRetriesPerRequest: null, // required by BullMQ workers
          },
          defaultJobOptions: DEFAULT_JOB_OPTIONS,
        };
      },
    }),
    BullModule.registerQueue(
      { name: QUEUES.SALLA_WEBHOOK },
      { name: QUEUES.SALLA_SYNC },
      { name: QUEUES.CONFIDENCE_AUDIT },
    ),
  ],
  exports: [BullModule],
})
export class QueueModule {}
