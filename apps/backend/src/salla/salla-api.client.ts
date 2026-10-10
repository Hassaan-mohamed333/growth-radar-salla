import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';

const API_BASE = 'https://api.salla.dev/admin/v2';
const HTTP_TIMEOUT_MS = 15_000;
/** Salla recommends the maximum page size and sequential paging. */
const PER_PAGE = 30;
/** Hard stop so a misbehaving pagination object can never loop forever. */
const MAX_PAGES = 500;

const money = z.object({ amount: z.coerce.number(), currency: z.string().optional() });

const orderSchema = z.object({
  id: z.union([z.string(), z.number()]).transform(String),
  /** `date.date` is "YYYY-MM-DD HH:mm:ss.ffffff" already expressed in `date.timezone`. */
  date: z.object({ date: z.string(), timezone: z.string().optional() }),
  status: z.object({ slug: z.string().nullish() }).nullish(),
  total: money.nullish(),
  items: z.array(z.object({ quantity: z.coerce.number().optional() })).nullish(),
  payment_actions: z
    .object({
      refund_action: z.object({ refund_amount: money.nullish() }).nullish(),
    })
    .nullish(),
});

const ordersPage = z.object({
  data: z.array(orderSchema),
  pagination: z
    .object({
      currentPage: z.coerce.number().optional(),
      totalPages: z.coerce.number().optional(),
    })
    .nullish(),
});

const pagination = z
  .object({
    currentPage: z.coerce.number().optional(),
    totalPages: z.coerce.number().optional(),
  })
  .nullish();

/** Salla returns money as `{ amount, currency }`; some fields (cost) may be a bare number. */
const moneyLike = z.union([money, z.coerce.number()]).nullish();

function amountOf(v: z.infer<typeof moneyLike>): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'number' ? v : v.amount;
  return Number.isFinite(n) ? n : null;
}

const productSchema = z.object({
  id: z.union([z.string(), z.number()]).transform(String),
  sku: z.string().nullish(),
  name: z.string().min(1),
  /** Current effective price (already reflects an active sale). */
  price: moneyLike,
  regular_price: moneyLike,
  /** `amount: 0` when no sale is running. */
  sale_price: moneyLike,
  cost_price: moneyLike,
  currency: z.string().nullish(),
  /** null / absent means unlimited stock. */
  quantity: z.coerce.number().nullish(),
  status: z.string().nullish(),
  url: z.string().nullish(),
  main_image: z.string().nullish(),
});

const productsPage = z.object({
  data: z.array(z.unknown()),
  pagination,
});

/** The subset of a Salla order the sales aggregation needs. */
export interface SallaOrder {
  id: string;
  /** Store-local calendar day, YYYY-MM-DD. */
  localDate: string;
  statusSlug: string | null;
  total: number;
  currency: string | null;
  units: number;
  refunded: number;
}

/** The subset of a Salla product the catalogue sync needs. Prices are major units (e.g. SAR). */
export interface SallaProduct {
  id: string;
  sku: string | null;
  name: string;
  /** Regular (non-sale) price. */
  price: number;
  /** Active sale price, strictly below `price`; null when not on sale. */
  salePrice: number | null;
  costPrice: number | null;
  currency: string | null;
  /** null = unlimited / not tracked. */
  quantity: number | null;
  /** Salla status slug: "sale" | "out" | "hidden" (others pass through). */
  statusSlug: string | null;
  url: string | null;
  imageUrl: string | null;
}

export interface SallaProductListing {
  products: SallaProduct[];
  /** True only when every page was read; false when MAX_PAGES cut the listing short. */
  complete: boolean;
  /** Entries Salla returned that did not look like a usable product. */
  skipped: number;
}

/**
 * Normalises one raw Salla product (API listing or webhook payload). Returns null
 * when it has no id/name or carries no price at all — a partial webhook payload
 * must never be written as a free product.
 */
export function parseSallaProduct(raw: unknown): SallaProduct | null {
  const r = productSchema.safeParse(raw);
  if (!r.success) return null;
  const p = r.data;

  const current = amountOf(p.price);
  const regularRaw = amountOf(p.regular_price);
  const saleRaw = amountOf(p.sale_price);
  if (current === null && regularRaw === null && saleRaw === null) return null;

  const regular = regularRaw !== null && regularRaw > 0 ? regularRaw : (current ?? regularRaw ?? 0);
  const sale = saleRaw !== null && saleRaw > 0 && saleRaw < regular ? saleRaw : null;
  const cost = amountOf(p.cost_price);
  const currencyOf = (v: z.infer<typeof moneyLike>) =>
    v !== null && v !== undefined && typeof v === 'object' ? (v.currency ?? null) : null;

  return {
    id: p.id,
    sku: p.sku?.trim() || null,
    name: p.name.trim(),
    price: regular,
    salePrice: sale,
    costPrice: cost !== null && cost > 0 ? cost : null,
    currency: (p.currency ?? currencyOf(p.price) ?? currencyOf(p.regular_price) ?? null)
      ?.toUpperCase()
      .slice(0, 3) ?? null,
    quantity: p.quantity === null || p.quantity === undefined ? null : Math.max(0, Math.trunc(p.quantity)),
    statusSlug: p.status?.toLowerCase() ?? null,
    url: p.url ?? null,
    imageUrl: p.main_image ?? null,
  };
}

export class SallaApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'SallaApiError';
  }
}

/** Thin HTTP layer for the Salla Merchant API. Never logs bodies (they contain PII). */
@Injectable()
export class SallaApiClient {
  private readonly logger = new Logger(SallaApiClient.name);

  /**
   * All orders created between `fromDate` and `toDate` (YYYY-MM-DD). Salla's
   * boundary inclusivity is not documented, so callers should pad the range and
   * filter by `localDate` themselves.
   */
  async listOrders(
    accessToken: string,
    range: { fromDate: string; toDate: string },
  ): Promise<SallaOrder[]> {
    const orders: SallaOrder[] = [];

    for (let page = 1; page <= MAX_PAGES; page++) {
      const body = await this.fetchPage(accessToken, 'orders', {
        from_date: range.fromDate,
        to_date: range.toDate,
        per_page: String(PER_PAGE),
        page: String(page),
        sort_by: 'created_at-asc',
      });

      const parsed = ordersPage.safeParse(body);
      if (!parsed.success) throw new SallaApiError(502, 'Unexpected orders response shape');

      for (const o of parsed.data.data) {
        orders.push({
          id: o.id,
          localDate: o.date.date.slice(0, 10),
          statusSlug: o.status?.slug ?? null,
          total: o.total?.amount ?? 0,
          currency: o.total?.currency ?? null,
          units: (o.items ?? []).reduce((n, i) => n + (i.quantity ?? 0), 0),
          refunded: o.payment_actions?.refund_action?.refund_amount?.amount ?? 0,
        });
      }

      const p = parsed.data.pagination;
      const current = p?.currentPage ?? page;
      const total = p?.totalPages ?? current;
      if (parsed.data.data.length === 0 || current >= total) return orders;
    }

    this.logger.warn(`Order listing stopped at ${MAX_PAGES} pages`);
    return orders;
  }

  /**
   * The store's whole catalogue (every status, hidden products included).
   * Malformed entries are skipped and counted, never fatal: one odd product must
   * not stop the rest of the catalogue from syncing.
   */
  async listProducts(accessToken: string): Promise<SallaProductListing> {
    const products: SallaProduct[] = [];
    let skipped = 0;

    for (let page = 1; page <= MAX_PAGES; page++) {
      const body = await this.fetchPage(accessToken, 'products', {
        per_page: String(PER_PAGE),
        page: String(page),
      });

      const parsed = productsPage.safeParse(body);
      if (!parsed.success) throw new SallaApiError(502, 'Unexpected products response shape');

      for (const raw of parsed.data.data) {
        const product = parseSallaProduct(raw);
        if (product) products.push(product);
        else skipped += 1;
      }

      const p = parsed.data.pagination;
      const current = p?.currentPage ?? page;
      const total = p?.totalPages ?? current;
      if (parsed.data.data.length === 0 || current >= total) {
        return { products, complete: true, skipped };
      }
    }

    this.logger.warn(`Product listing stopped at ${MAX_PAGES} pages`);
    return { products, complete: false, skipped };
  }

  private async fetchPage(
    accessToken: string,
    resource: 'orders' | 'products',
    params: Record<string, string>,
  ): Promise<unknown> {
    const url = new URL(`${API_BASE}/${resource}`);
    url.search = new URLSearchParams(params).toString();

    const res = await fetch(url, {
      headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' },
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
    if (!res.ok) {
      this.logger.warn(`Salla ${resource} endpoint responded ${res.status}`);
      throw new SallaApiError(res.status, `List ${resource} failed (${res.status})`);
    }
    return res.json();
  }
}
