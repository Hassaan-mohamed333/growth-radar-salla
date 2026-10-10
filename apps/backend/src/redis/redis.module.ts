import { Global, Inject, Injectable, Module, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import type { Env } from '../config/env';

export const REDIS = Symbol('REDIS');

@Injectable()
class RedisShutdown implements OnApplicationShutdown {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async onApplicationShutdown(): Promise<void> {
    await this.redis.quit();
  }
}

@Global()
@Module({
  providers: [
    {
      provide: REDIS,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        new Redis(config.get('REDIS_URL', { infer: true }), {
          maxRetriesPerRequest: 3,
          enableReadyCheck: true,
        }),
    },
    RedisShutdown,
  ],
  exports: [REDIS],
})
export class RedisModule {}
