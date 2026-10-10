import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnv } from './config/env';
import { AuthModule } from './auth/auth.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { CompetitorsModule } from './competitors/competitors.module';
import { DataConfidenceModule } from './data-confidence/data-confidence.module';
import { StoreModule } from './store/store.module';
import { SecurityModule } from './security/security.module';
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
    ScraperModule,
    RecommendationsModule,
  ],
})
export class AppModule {}
