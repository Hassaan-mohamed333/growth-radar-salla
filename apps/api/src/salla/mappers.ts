import { z } from 'zod';

/**
 * Salla payloads are untrusted external input (even when the HMAC is valid, the merchant controls
 * names/descriptions). Everything that reaches the DB goes through these schemas: only the fields we
 * consume are kept, with bounded lengths. Unknown fields are dropped, never persisted or echoed.
 */

const id = z.union([z.number().int().nonnegative(), z.string().regex(/^\d{1,18}$/)]).transform((v) => BigInt(v));
const str = (max: number) => z.string().transform((s) => s.slice(0, max));
const money = z.object({ amount: z.coerce.number().finite().nonnegative(), currency: z.string().length(3).optional() });

/** Statuses that must NOT count as realised revenue. Tune against the slugs your Salla stores return. */
export const NON_REVENUE_STATUS_SLUGS = new Set(['canceled', 'cancelled', 'restored', 'restoring', 'payment_pending', 'failed']);

/** Salla dates: {date:"2024-05-01 13:45:00.000000", timezone:"Asia/Riyadh"} | ISO string | unix seconds. */
export function parseSallaDate(v: unknown): Date | null {
  if (v == null) return null;
  if (typeof v === 'number') return new Date(v * 1000);
  if (typeof v === 'string') return toDate(v, 'Asia/Riyadh');
  if (typeof v === 'object' && 'date' in v && typeof (v as { date: unknown }).date === 'string') {
    const o = v as { date: string; timezone?: unknown };
    return toDate(o.date, typeof o.timezone === 'string' ? o.timezone : 'Asia/Riyadh');
  }
  return null;
}
function toDate(s: string, tz: string): Date | null {
  const hasZone = /(Z|[+-]\d{2}:?\d{2})$/.test(s);
  // Saudi Arabia has no DST (UTC+3 year-round); other zones in naive strings are treated as UTC (documented limitation).
  const iso = hasZone ? s : s.replace(' ', 'T').replace(/(\.\d{3})\d*$/, '$1') + (tz === 'Asia/Riyadh' ? '+03:00' : 'Z');
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

const orderSchema = z.object({
  id,
  reference_id: z.union([z.string(), z.number()]).transform((v) => String(v).slice(0, 64)).optional(),
  status: z.object({ slug: str(60).optional() }).partial().optional(),
  date: z.unknown().optional(),
  payment_method: str(60).nullish(),
  amounts: z.object({ total: money.optional() }).optional(),
  total: z.union([money, z.coerce.number().finite().nonnegative()]).optional(),
  currency: z.string().length(3).optional(),
  customer: z.object({ id: id.optional() }).optional(),
  updated_at: z.unknown().optional(),
});

export interface MappedOrder {
  sallaId: bigint;
  referenceId: string | null;
  statusSlug: string | null;
  countsAsRevenue: boolean;
  totalAmount: number;
  currency: string;
  paymentMethod: string | null;
  customerId: bigint | null;
  placedAt: Date;
  sallaUpdatedAt: Date | null;
}

export function mapOrder(raw: unknown): MappedOrder | null {
  const p = orderSchema.safeParse(raw);
  if (!p.success) return null;
  const o = p.data;
  const totalObj = o.amounts?.total ?? (typeof o.total === 'object' ? o.total : undefined);
  const amount = totalObj?.amount ?? (typeof o.total === 'number' ? o.total : undefined);
  const currency = (totalObj?.currency ?? o.currency)?.toUpperCase();
  const placedAt = parseSallaDate(o.date);
  if (amount === undefined || !currency || !placedAt) return null;
  const slug = o.status?.slug?.toLowerCase() ?? null;
  return {
    sallaId: o.id,
    referenceId: o.reference_id ?? null,
    statusSlug: slug,
    countsAsRevenue: slug !== null && !NON_REVENUE_STATUS_SLUGS.has(slug),
    totalAmount: Math.round(amount * 100) / 100,
    currency,
    paymentMethod: o.payment_method ?? null,
    customerId: o.customer?.id ?? null,
    placedAt,
    sallaUpdatedAt: parseSallaDate(o.updated_at),
  };
}

const productSchema = z.object({
  id,
  sku: str(120).nullish(),
  name: str(500),
  status: str(40).nullish(),
  price: z.union([money, z.coerce.number().nonnegative()]).nullish(),
  sale_price: z.union([money, z.coerce.number().nonnegative()]).nullish(),
  regular_price: z.union([money, z.coerce.number().nonnegative()]).nullish(),
  quantity: z.coerce.number().int().nullish(),
  categories: z.array(z.object({ id })).optional(),
  updated_at: z.unknown().optional(),
});
const amountOf = (v: z.infer<typeof money> | number | null | undefined) =>
  v == null ? null : typeof v === 'number' ? v : v.amount;

export function mapProduct(raw: unknown) {
  const p = productSchema.safeParse(raw);
  if (!p.success) return null;
  const x = p.data;
  const price = amountOf(x.regular_price) ?? amountOf(x.price);
  const sale = amountOf(x.sale_price);
  const cur = [x.price, x.sale_price, x.regular_price].map((m) => (typeof m === 'object' && m ? m.currency : undefined)).find(Boolean);
  return {
    sallaId: x.id,
    sku: x.sku ?? null,
    name: x.name,
    status: x.status ?? null,
    price,
    salePrice: sale,
    currency: cur?.toUpperCase() ?? null,
    quantity: x.quantity ?? null,
    categorySallaIds: (x.categories ?? []).map((c) => c.id),
    sallaUpdatedAt: parseSallaDate(x.updated_at),
  };
}

const categorySchema = z.object({
  id,
  name: str(300),
  status: str(40).nullish(),
  parent_id: id.nullish(),
});
export function mapCategory(raw: unknown) {
  const p = categorySchema.safeParse(raw);
  if (!p.success) return null;
  return { sallaId: p.data.id, name: p.data.name, status: p.data.status ?? null, parentSallaId: p.data.parent_id ?? null };
}

export const paginationSchema = z.object({
  data: z.array(z.unknown()),
  pagination: z
    .object({ currentPage: z.number().int().optional(), totalPages: z.number().int().optional() })
    .partial()
    .optional(),
});
