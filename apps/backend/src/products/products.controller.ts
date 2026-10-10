import { BadRequestException, Controller, Get, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { CurrentSession, SessionGuard } from '../session/session.guard';
import type { SessionContext } from '../session/session.service';
import { type ProductListResponse, ProductsService } from './products.service';

const listSchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  search: z
    .string()
    .trim()
    .max(100)
    .optional()
    .transform((v) => (v ? v : undefined)),
  monitored: z.enum(['true', 'false']).optional().transform((v) => (v === undefined ? undefined : v === 'true')),
});

@Controller('api/v1/products')
@UseGuards(SessionGuard)
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Get()
  list(
    @CurrentSession() s: SessionContext,
    @Query() query: Record<string, unknown>,
  ): Promise<ProductListResponse> {
    const parsed = listSchema.safeParse(query);
    if (!parsed.success) {
      throw new BadRequestException(
        parsed.error.issues.map((i) => `${i.path.join('.') || 'query'}: ${i.message}`),
      );
    }
    return this.products.list(s.storeId, parsed.data);
  }
}
