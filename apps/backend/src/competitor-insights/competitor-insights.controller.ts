import { BadRequestException, Controller, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import { CurrentSession, SessionGuard } from '../session/session.guard';
import type { SessionContext } from '../session/session.service';
import {
  type AddedDiscovery,
  CompetitorInsightsService,
  type DiscoveryDto,
  type InsightsOverview,
} from './competitor-insights.service';

const idSchema = z.string().uuid();

function parseId(value: string): string {
  const r = idSchema.safeParse(value);
  if (!r.success) throw new BadRequestException('Invalid id');
  return r.data;
}

/** A recompute reads the whole catalogue, so it gets a tighter budget than ordinary reads. */
const SCAN_LIMIT = { default: { limit: 6, ttl: 60_000 } };

@Controller('api/v1/competitor-insights')
@UseGuards(SessionGuard)
export class CompetitorInsightsController {
  constructor(private readonly insights: CompetitorInsightsService) {}

  /** Stored niches, suggestions and the latest SWOT. Never triggers a scan. */
  @Get()
  overview(@CurrentSession() s: SessionContext): Promise<InsightsOverview> {
    return this.insights.overview(s.storeId);
  }

  /** Recomputes niches, suggestions and the SWOT from the store's current data. */
  @Post('refresh')
  @HttpCode(200)
  @Throttle(SCAN_LIMIT)
  refresh(@CurrentSession() s: SessionContext): Promise<InsightsOverview> {
    return this.insights.refresh(s);
  }

  /** One-click add of a suggested competitor to the tracked list. */
  @Post('discoveries/:id/add')
  @HttpCode(200)
  add(@CurrentSession() s: SessionContext, @Param('id') id: string): Promise<AddedDiscovery> {
    return this.insights.add(s, parseId(id));
  }

  @Post('discoveries/:id/dismiss')
  @HttpCode(200)
  dismiss(@CurrentSession() s: SessionContext, @Param('id') id: string): Promise<DiscoveryDto> {
    return this.insights.dismiss(s.storeId, parseId(id));
  }
}
