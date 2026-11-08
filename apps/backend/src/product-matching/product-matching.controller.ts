import { BadRequestException, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import { CurrentSession, SessionGuard } from '../session/session.guard';
import type { SessionContext } from '../session/session.service';
import {
  type MatchDto,
  type MatchingOverview,
  ProductMatchingService,
  type SearchResult,
} from './product-matching.service';

const idSchema = z.string().uuid();

function parseId(value: string): string {
  const r = idSchema.safeParse(value);
  if (!r.success) throw new BadRequestException('Invalid id');
  return r.data;
}

const listSchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(10),
  search: z
    .string()
    .trim()
    .max(100)
    .optional()
    .transform((v) => v || undefined),
});

/** A search fetches several third-party sites, so it gets a far tighter budget than ordinary reads. */
const SEARCH_LIMIT = { default: { limit: 6, ttl: 60_000 } };

@Controller('api/v1/product-matching')
@UseGuards(SessionGuard)
export class ProductMatchingController {
  constructor(private readonly matching: ProductMatchingService) {}

  /** Products with their linked competitor listings, price comparison and pending suggestions. */
  @Get()
  overview(@CurrentSession() s: SessionContext, @Query() query: unknown): Promise<MatchingOverview> {
    const parsed = listSchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException('Invalid query');
    return this.matching.overview(s.storeId, parsed.data);
  }

  /** Searches the tracked competitors' stores for products like this one. */
  @Post('products/:id/search')
  @HttpCode(200)
  @Throttle(SEARCH_LIMIT)
  search(@CurrentSession() s: SessionContext, @Param('id') id: string): Promise<SearchResult> {
    return this.matching.search(s, parseId(id));
  }

  @Post('matches/:id/confirm')
  @HttpCode(200)
  confirm(@CurrentSession() s: SessionContext, @Param('id') id: string): Promise<MatchDto> {
    return this.matching.confirm(s, parseId(id));
  }

  @Post('matches/:id/reject')
  @HttpCode(200)
  reject(@CurrentSession() s: SessionContext, @Param('id') id: string): Promise<MatchDto> {
    return this.matching.reject(s.storeId, parseId(id));
  }
}
