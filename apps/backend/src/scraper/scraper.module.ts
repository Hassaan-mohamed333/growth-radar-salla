import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CompetitorsModule } from '../competitors/competitors.module';
import type { Env } from '../config/env';
import { CompetitorPriceScraperService } from './competitor-price-scraper.service';
import { HttpPageFetcher, PageFetcher } from './page-fetcher';
import { ScraperScheduler } from './scraper.scheduler';

@Module({
  imports: [CompetitorsModule],
  providers: [
    {
      provide: PageFetcher,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        new HttpPageFetcher({ userAgent: config.get('SCRAPER_USER_AGENT', { infer: true }) }),
    },
    CompetitorPriceScraperService,
    ScraperScheduler,
  ],
  exports: [CompetitorPriceScraperService],
})
export class ScraperModule {}
