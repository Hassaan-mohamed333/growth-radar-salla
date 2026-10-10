import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { CurrentSession, SessionGuard } from '../session/session.guard';
import type { SessionContext } from '../session/session.service';
import { CompetitorPricesService, type RecordedPrice } from './competitor-prices.service';
import {
  type CompetitorDto,
  type CompetitorListResponse,
  CompetitorsService,
} from './competitors.service';

const id = z.string().uuid();
const currency = z
  .string()
  .length(3)
  .regex(/^[A-Za-z]{3}$/)
  .transform((v) => v.toUpperCase());
const url = z.string().min(1).max(2048);

const createSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    domain: z.string().trim().min(1).max(253).optional(),
    productUrl: url.optional(),
    productId: id.optional(),
    currency: currency.optional(),
  })
  .strict()
  .refine((v) => v.domain || v.productUrl, { message: 'domain or productUrl is required' });

const updateSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    productUrl: url.nullable().optional(),
    isActive: z.boolean().optional(),
    currency: currency.optional(),
    productId: id.nullable().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' });

const listSchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  search: z
    .string()
    .trim()
    .max(100)
    .optional()
    .transform((v) => (v ? v : undefined)),
});

const linkSchema = z
  .object({
    productUrl: url,
    name: z.string().trim().min(1).max(120).optional(),
    currency: currency.optional(),
  })
  .strict();

const priceSchema = z.object({
  price: z.number().positive().max(10_000_000),
  inStock: z.boolean().optional(),
});

function parse<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, value: unknown): T {
  const r = schema.safeParse(value);
  if (!r.success) {
    // Field paths + messages only; zod never includes the rejected values.
    throw new BadRequestException(
      r.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`),
    );
  }
  return r.data;
}

function parseId(value: string): string {
  const r = id.safeParse(value);
  if (!r.success) throw new BadRequestException('Invalid id');
  return r.data;
}

@Controller('api/v1/competitors')
@UseGuards(SessionGuard)
export class CompetitorsController {
  constructor(
    private readonly competitors: CompetitorsService,
    private readonly prices: CompetitorPricesService,
  ) {}

  @Get()
  list(
    @CurrentSession() s: SessionContext,
    @Query() query: Record<string, unknown>,
  ): Promise<CompetitorListResponse> {
    return this.competitors.list(s.storeId, parse(listSchema, query));
  }

  @Post()
  create(@CurrentSession() s: SessionContext, @Body() body: unknown): Promise<CompetitorDto> {
    return this.competitors.create(s, parse(createSchema, body));
  }

  @Patch(':id')
  update(
    @CurrentSession() s: SessionContext,
    @Param('id') competitorId: string,
    @Body() body: unknown,
  ): Promise<CompetitorDto> {
    return this.competitors.update(s.storeId, parseId(competitorId), parse(updateSchema, body));
  }

  /** Manually record an observed competitor price (the scraper uses the service directly). */
  @Post(':id/prices')
  @HttpCode(200)
  record(
    @CurrentSession() s: SessionContext,
    @Param('id') competitorId: string,
    @Body() body: unknown,
  ): Promise<RecordedPrice> {
    return this.prices.record(s.storeId, parseId(competitorId), {
      ...parse(priceSchema, body),
      source: 'manual',
    });
  }
}

@Controller('api/v1/products')
@UseGuards(SessionGuard)
export class ProductCompetitorsController {
  constructor(private readonly competitors: CompetitorsService) {}

  /** Link a competitor's product page to one of the store's products. */
  @Post(':id/competitors')
  link(
    @CurrentSession() s: SessionContext,
    @Param('id') productId: string,
    @Body() body: unknown,
  ): Promise<CompetitorDto> {
    return this.competitors.linkToProduct(s, parseId(productId), parse(linkSchema, body));
  }
}
