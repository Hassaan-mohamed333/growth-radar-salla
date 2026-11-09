import { Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CompetitorsModule } from '../competitors/competitors.module';
import type { Env } from '../config/env';
import { CompetitorPriceScraperService } from './competitor-price-scraper.service';
import { HttpPageFetcher, PageFetcher } from './page-fetcher';
import { RenderApiFetcher } from './render-fetcher';
import { ScraperScheduler } from './scraper.scheduler';
import { TieredPageFetcher } from './tiered-page-fetcher';

@Module({
  imports: [CompetitorsModule],
  providers: [
    {
      provide: PageFetcher,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => {
        const renderUrl = config.get('SCRAPER_RENDER_API_URL', { infer: true });
        new Logger('ScraperModule').log(
          `Fetch tiers: http, platform-api${renderUrl ? ', rendering-service' : ' (rendering tier not configured)'}`,
        );
        return new TieredPageFetcher({
          http: new HttpPageFetcher({ userAgent: config.get('SCRAPER_USER_AGENT', { infer: true }) }),
          render: renderUrl ? new RenderApiFetcher(renderUrl) : undefined,
          blockThreshold: config.get('SCRAPER_BLOCK_THRESHOLD', { infer: true }),
          cooldownMs: config.get('SCRAPER_BLOCK_COOLDOWN_MINUTES', { infer: true }) * 60_000,
        });
      },
    },
    CompetitorPriceScraperService,
    ScraperScheduler,
  ],
  exports: [CompetitorPriceScraperService, PageFetcher],
})
export class ScraperModule {}
