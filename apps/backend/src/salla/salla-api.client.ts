import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';

const API_BASE = 'https://api.salla.dev/admin/v2';
const HTTP_TIMEOUT_MS = 15_000;
/** Salla recommends the maximum page size and sequential paging. */
const PER_PAGE = 30;
/** Hard stop so a misbehaving pagination object can never loop forever. */
const MAX_PAGES = 500;
/**
 * Stricter stop for responses with no usable pagination metadata: without it we cannot
 * tell "more pages" from "same page again", so we only keep going for a small number.
 */
const MAX_PAGES_WITHOUT_METADATA = 20;

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

/**
 * Key names and value types of an unknown response body, with no values. Safe to log:
 * it shows where Salla's shape differs without exposing customer data.
 */
export function describeShape(body: unknown, depth = 0): string {
  if (body === null) return 'null';
  if (Array.isArray(body)) {
    return depth > 1 ? `array(${body.length})` : `array(${body.length}) of ${describeShape(body[0], depth + 1)}`;
  }
  if (typeof body === 'object') {
    if (depth > 1) return 'object';
    const entries = Object.entries(body as Record<string, unknown>).map(
      ([k, v]) => `${k}:${describeShape(v, depth + 1)}`,
    );
    return `{${entries.join(', ')}}`;
  }
  return typeof body;
}

/** `.nullish()` goes outside the coerce: `z.coerce.number()` turns null into 0. */
const pageCount = z.coerce.number().nullish();

const ordersPage = z.object({
  data: z.array(orderSchema),
  pagination: z
    .object({
      currentPage: pageCount,
      totalPages: pageCount,
    })
    .nullish(),
});

/**
 * Salla's pagination object differs between docs and endpoints
 * ({currentPage,totalPages,links.next} vs {current,next}), so every field is optional
 * and `hasMorePages` decides conservatively.
 */
const pagination = z
  .object({
    currentPage: pageCount,
    totalPages: pageCount,
    next: z.string().nullish(),
    links: z.object({ next: z.string().nullish() }).nullish(),
  })
  .nullish();

type Pagination = z.infer<typeof pagination>;

/** Whether the response carries any field that says where paging ends. */
function hasPagingMetadata(p: Pagination): boolean {
  return (p?.totalPages != null && Number.isFinite(p.totalPages)) || p?.links != null || p?.next != null;
}

/**
 * Whether to request another page. Never assumes "one page" from missing metadata:
 * a silent truncation would make the catalogue sync soft-delete the products it did
 * not see. With no usable metadata it keeps going until an empty page (or the
 * metadata-less cap, which marks the listing incomplete).
 */
function hasMorePages(page: number, itemCount: number, p: Pagination): boolean {
  if (itemCount === 0) return false;
  if (p?.totalPages != null && Number.isFinite(p.totalPages)) return page < p.totalPages;
  if (p?.links) return Boolean(p.links.next);
  if (p?.next !== undefined) return Boolean(p.next);
  return true;
}

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
  /** When true the `quantity` field is meaningless (it can be 0 or stale). */
  unlimited_quantity: z.boolean().nullish(),
  status: z.string().nullish(),
  url: z.string().nullish(),
  main_image: z.string().nullish(),
  images: z
    .array(z.object({ url: z.string().nullish(), main: z.boolean().nullish() }))
    .nullish(),
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
    quantity:
      p.unlimited_quantity === true || p.quantity === null || p.quantity === undefined
        ? null
        : Math.max(0, Math.trunc(p.quantity)),
    statusSlug: p.status?.toLowerCase() ?? null,
    url: p.url ?? null,
    imageUrl:
      p.main_image ??
      p.images?.find((i) => i.main && i.url)?.url ??
      p.images?.find((i) => i.url)?.url ??
      null,
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
    const seen = new Set<string>();

    for (let page = 1; page <= MAX_PAGES; page++) {
      const body = await this.fetchPage(accessToken, 'orders', {
        from_date: range.fromDate,
        to_date: range.toDate,
        per_page: String(PER_PAGE),
        page: String(page),
        sort_by: 'created_at-asc',
      });

      const parsed = ordersPage.safeParse(body);
      if (!parsed.success) {
        this.logger.warn(`Unexpected orders response: ${describeShape(body)}`);
        throw new SallaApiError(502, 'Unexpected orders response shape');
      }

      let fresh = 0;
      for (const o of parsed.data.data) {
        // A repeated order would be counted twice in the sales totals.
        if (seen.has(o.id)) continue;
        seen.add(o.id);
        fresh += 1;
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

      // A page of only repeats means the endpoint is ignoring `page`: more requests won't help.
      if (fresh === 0) return orders;
      if (!hasMorePages(page, parsed.data.data.length, parsed.data.pagination)) return orders;
      if (!hasPagingMetadata(parsed.data.pagination) && page >= MAX_PAGES_WITHOUT_METADATA) {
        this.logger.warn(`Order listing without pagination metadata stopped at page ${page}`);
        return orders;
      }
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
    const seen = new Set<string>();
    let skipped = 0;

    for (let page = 1; page <= MAX_PAGES; page++) {
      const body = await this.fetchPage(accessToken, 'products', {
        per_page: String(PER_PAGE),
        page: String(page),
      });

      const parsed = productsPage.safeParse(body);
      if (!parsed.success) {
        // TEMP diagnostics: key names and value types only, never values (they hold customer data).
        this.logger.warn(`Unexpected products response: ${describeShape(body)}`);
        throw new SallaApiError(502, 'Unexpected products response shape');
      }

      let fresh = 0;
      for (const raw of parsed.data.data) {
        const product = parseSallaProduct(raw);
        if (!product) {
          skipped += 1;
          continue;
        }
        if (seen.has(product.id)) continue;
        seen.add(product.id);
        fresh += 1;
        products.push(product);
      }

      // A page of only repeats (or only malformed entries) is not a finished listing:
      // report it incomplete so nothing is soft-deleted on the strength of it.
      if (fresh === 0 && parsed.data.data.length > 0) {
        this.logger.warn(`Product listing stopped at page ${page}: no new entries`);
        return { products, complete: false, skipped };
      }
      if (!hasMorePages(page, parsed.data.data.length, parsed.data.pagination)) {
        return { products, complete: true, skipped };
      }
      if (!hasPagingMetadata(parsed.data.pagination) && page >= MAX_PAGES_WITHOUT_METADATA) {
        this.logger.warn(`Product listing without pagination metadata stopped at page ${page}`);
        return { products, complete: false, skipped };
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
