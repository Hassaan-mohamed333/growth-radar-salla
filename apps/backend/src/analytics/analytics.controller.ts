import { Controller, Get, UseGuards } from '@nestjs/common';
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

  @Get('summary')
  summary(@CurrentSession() session: SessionContext): Promise<AnalyticsSummaryResponse> {
    return this.analytics.getSummary(session.storeId);
  }
}
