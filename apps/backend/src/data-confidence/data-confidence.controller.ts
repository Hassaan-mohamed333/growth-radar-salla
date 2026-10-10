import { BadRequestException, Controller, Get, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { CurrentSession, SessionGuard } from '../session/session.guard';
import type { SessionContext } from '../session/session.service';
import { type DataConfidenceResponse, DataConfidenceService } from './data-confidence.service';

const querySchema = z.object({
  status: z.enum(['ALL', 'PASSED', 'WARNING', 'FAILED']).default('ALL'),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

@Controller('api/v1/data-confidence')
@UseGuards(SessionGuard)
export class DataConfidenceController {
  constructor(private readonly confidence: DataConfidenceService) {}

  @Get()
  get(
    @CurrentSession() s: SessionContext,
    @Query() query: Record<string, unknown>,
  ): Promise<DataConfidenceResponse> {
    const parsed = querySchema.safeParse(query);
    if (!parsed.success) {
      throw new BadRequestException(
        parsed.error.issues.map((i) => `${i.path.join('.') || 'query'}: ${i.message}`),
      );
    }
    return this.confidence.get(s.storeId, parsed.data);
  }
}
