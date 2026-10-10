import { Module } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { REDIS } from './infra/redis.module';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from './common/auth/auth.module';
import { PermissionsGuard } from './common/auth/permissions.guard';
import { SessionGuard } from './common/auth/session.guard';
import { TenantInterceptor } from './common/auth/tenant.interceptor';
import { RedisThrottlerStorage } from './common/throttle/redis-throttler.storage';
import { ConfigModule } from './config/config.module';
import { ConfidenceModule } from './confidence/confidence.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { InfraModule } from './infra/infra.module';
import { QueueModule } from './queue/queue.module';
import { SallaModule } from './salla/salla.module';
import { HealthController } from './health.controller';

@Module({
  imports: [
    ConfigModule,
    InfraModule,
    QueueModule,
    // Redis-backed so limits hold across API replicas. Per-route @Throttle tightens/loosens this default.
    ThrottlerModule.forRootAsync({
      inject: [REDIS],
      useFactory: (redis: Redis) => ({
        throttlers: [{ name: 'default', ttl: 60_000, limit: 120 }],
        storage: new RedisThrottlerStorage(redis),
      }),
    }),
    AuthModule,
    SallaModule,
    ConfidenceModule,
    DashboardModule,
  ],
  controllers: [HealthController],
  providers: [
    // Order matters: rate-limit -> authenticate -> authorise (RBAC) -> bind tenant context.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: SessionGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_INTERCEPTOR, useClass: TenantInterceptor },
  ],
})
export class AppModule {}
