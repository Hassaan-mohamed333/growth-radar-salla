import { z } from 'zod';

export const recommendationSchema = z.object({
  id: z.string().uuid(),
  title: z.string().max(200),
  summary: z.string().max(1000),
  category: z.enum(['TRACKING', 'PRICING', 'COMPETITOR', 'INVENTORY', 'CAMPAIGN']),
  severity: z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']),
  /** 0..1 */
  confidence: z.number().min(0).max(1),
  estimatedRevenueAtRisk: z.number().nonnegative(),
  currency: z.string().length(3),
  status: z.enum(['OPEN', 'ACCEPTED', 'DISMISSED', 'EXPIRED']),
});
export type RecommendationDto = z.infer<typeof recommendationSchema>;

export const checkResultSchema = z.object({
  id: z.string(),
  status: z.enum(['pass', 'warn', 'fail', 'unavailable', 'not_applicable']),
  weight: z.number(),
  earned: z.number(),
});

export const overviewSchema = z.object({
  storeId: z.string().uuid(),
  currency: z.string().length(3),
  generatedAt: z.string(),
  confidence: z.object({
    score: z.number().int().min(0).max(100).nullable(),
    level: z.enum(['high', 'medium', 'low', 'insufficient_data']),
    checks: z.array(checkResultSchema),
    auditedAt: z.string().nullable(),
  }),
  revenueAtRisk: z.object({ amount: z.number().nonnegative(), revenue30d: z.number().nonnegative() }),
  marketingHealthScore: z.number().int().min(0).max(100).nullable(),
  topDecisions: z.array(recommendationSchema).max(3),
});
export type OverviewDto = z.infer<typeof overviewSchema>;
