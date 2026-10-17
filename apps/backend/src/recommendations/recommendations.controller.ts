import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { recommendationsToCsv } from './recommendations-csv';
import { CurrentSession, SessionGuard } from '../session/session.guard';
import type { SessionContext } from '../session/session.service';
import {
  type RecommendationBlockersDto,
  type RecommendationDto,
  type RecommendationListResponse,
  RecommendationsService,
} from './recommendations.service';

const listSchema = z.object({
  status: z.enum(['PENDING', 'ACCEPTED', 'DISMISSED', 'ALL']).default('PENDING'),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

const exportSchema = z.object({
  status: z.enum(['PENDING', 'ACCEPTED', 'DISMISSED', 'ALL']).default('PENDING'),
});

const decisionSchema =z.object({ decision: z.enum(['ACCEPTED', 'DISMISSED']) }).strict();
const idSchema = z.string().uuid();

function parse<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, value: unknown): T {
  const r = schema.safeParse(value);
  if (!r.success) {
    throw new BadRequestException(
      r.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`),
    );
  }
  return r.data;
}

@Controller('api/v1/recommendations')
@UseGuards(SessionGuard)
export class RecommendationsController {
  constructor(private readonly recommendations: RecommendationsService) {}

  @Get()
  list(
    @CurrentSession() s: SessionContext,
    @Query() query: Record<string, unknown>,
  ): Promise<RecommendationListResponse> {
    return this.recommendations.list(s.storeId, parse(listSchema, query));
  }

  @Get('blockers')
  blockers(@CurrentSession() s: SessionContext): Promise<RecommendationBlockersDto> {
    return this.recommendations.blockers(s.storeId);
  }

  /** CSV of the chosen status, for the merchant's own records. Not cached: it is personal data. */
  @Get('export.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="recommendations.csv"')
  @Header('Cache-Control', 'no-store')
  async exportCsv(
    @CurrentSession() s: SessionContext,
    @Query() query: Record<string, unknown>,
  ): Promise<string> {
    const { status } = parse(exportSchema, query);
    return recommendationsToCsv(await this.recommendations.exportRows(s.storeId, status));
  }

  /** Accept or dismiss a pending recommendation. Accepting never changes the Salla price. */
  @Post(':id/decision')
  @HttpCode(200)
  decide(
    @CurrentSession() s: SessionContext,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<RecommendationDto> {
    const rec = idSchema.safeParse(id);
    if (!rec.success) throw new BadRequestException('Invalid id');
    return this.recommendations.decide(s.storeId, rec.data, parse(decisionSchema, body).decision);
  }
}
