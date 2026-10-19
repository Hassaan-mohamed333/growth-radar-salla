import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { validateEnv } from './config/env';
import { AuthModule } from './auth/auth.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { CompetitorsModule } from './competitors/competitors.module';
import { DataConfidenceModule } from './data-confidence/data-confidence.module';
import { StoreModule } from './store/store.module';
import { SecurityModule } from './security/security.module';
import { SessionModule } from './session/session.module';
import { SessionThrottlerGuard } from './session/session-throttler.guard';
import { PrismaModule } from './prisma/prisma.module';
import { ProductsModule } from './products/products.module';
import { RecommendationsModule } from './recommendations/recommendations.module';
import { RedisModule } from './redis/redis.module';
import { SallaModule } from './salla/salla.module';
import { ScraperModule } from './scraper/scraper.module';
import { SyncModule } from './sync/sync.module';
import { WebhooksModule } from './webhooks/webhooks.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
      envFilePath: ['.env', '../../.env'],
    }),
    // Budget per merchant store (per client IP when anonymous) for every route; see
    // SessionThrottlerGuard. Webhooks opt out (see WebhooksController): Salla retries on error,
    // and a 429 there would drop real events.
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
    SessionModule,
    PrismaModule,
    RedisModule,
    SecurityModule,
    SallaModule,
    SyncModule,
    ProductsModule,
    WebhooksModule,
    AuthModule,
    StoreModule,
    AnalyticsModule,
    CompetitorsModule,
    DataConfidenceModule,
    ScraperModule,
    RecommendationsModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: SessionThrottlerGuard }],
})
export class AppModule {}
