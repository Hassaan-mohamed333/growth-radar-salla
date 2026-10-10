import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS } from '../redis/redis.module';

const PROCESSING_TTL_SECONDS = 5 * 60; // lock while a delivery is being handled
const DONE_TTL_SECONDS = 7 * 24 * 60 * 60; // remember completed deliveries

/**
 * Redis-backed idempotency for webhook deliveries.
 *
 *   begin()    SET key processing NX EX 300  → true only for the first delivery
 *   complete() SET key done EX 7d             → duplicates keep being ignored
 *   release()  DEL key                        → handler failed; let Salla's retry through
 */
@Injectable()
export class WebhookIdempotencyService {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async begin(key: string): Promise<boolean> {
    const res = await this.redis.set(key, 'processing', 'EX', PROCESSING_TTL_SECONDS, 'NX');
    return res === 'OK';
  }

  async complete(key: string): Promise<void> {
    await this.redis.set(key, 'done', 'EX', DONE_TTL_SECONDS);
  }

  async release(key: string): Promise<void> {
    await this.redis.del(key);
  }
}
