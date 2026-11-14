import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { CurrentSession, SessionGuard } from '../session/session.guard';
import type { SessionContext } from '../session/session.service';
import { AnalyticsService, type AnalyticsSummaryResponse } from './analytics.service';

@Controller('api/v1/analytics')
@UseGuards(SessionGuard)
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get('store-health')
  storeHealth(@CurrentSession() session: SessionContext) {
    return this.analytics.getStoreHealth(session.storeId);
  }

  @Get('product-report')
  productReport(@CurrentSession() session: SessionContext) {
    return this.analytics.getProductReport(session.storeId);
  }

  /** ?period=week (default) or month; anything else falls back to week. */
  @Get('period-report')
  periodReport(@CurrentSession() session: SessionContext, @Query('period') period?: string) {
    return this.analytics.getPeriodReport(session.storeId, period === 'month' ? 'month' : 'week');
  }

  @Get('summary')
  summary(@CurrentSession() session: SessionContext): Promise<AnalyticsSummaryResponse> {
    return this.analytics.getSummary(session.storeId);
  }
}
