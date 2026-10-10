import { z } from 'zod';

/**
 * Salla webhook envelope: { event, merchant, created_at, data }.
 * `data` is intentionally opaque here: the immutable raw payload is stored verbatim and each
 * event handler validates only the slice it consumes.
 */
export const sallaWebhookEnvelopeSchema = z.object({
  event: z.string().min(1).max(100).regex(/^[a-z0-9_.]+$/i),
  merchant: z.union([z.number().int().positive(), z.string().regex(/^\d+$/)]).transform((v) => BigInt(v)),
  created_at: z.string().optional(),
  data: z.unknown(),
});
export type SallaWebhookEnvelope = z.infer<typeof sallaWebhookEnvelopeSchema>;

export const SYNCED_EVENT_PREFIXES = ['order.', 'product.', 'category.'] as const;

export const QUEUES = {
  SALLA_WEBHOOK: 'salla-webhook',
  SALLA_SYNC: 'salla-sync',
  CONFIDENCE_AUDIT: 'confidence-audit',
} as const;
