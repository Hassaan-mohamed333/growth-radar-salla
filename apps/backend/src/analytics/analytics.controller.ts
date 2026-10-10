import { Controller, Get, UseGuards } from '@nestjs/common';
import { CurrentSession, SessionGuard } from '../session/session.guard';
import type { SessionContext } from '../session/session.service';
import { AnalyticsService, type AnalyticsSummaryResponse } from './analytics.service';

@Controller('api/v1/analytics')
@UseGuards(SessionGuard)
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get('summary')
  summary(@CurrentSession() session: SessionContext): Promise<AnalyticsSummaryResponse> {
    return this.analytics.getSummary(session.storeId);
  }
}
