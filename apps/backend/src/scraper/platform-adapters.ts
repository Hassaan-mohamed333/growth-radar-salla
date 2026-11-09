import { ScrapeError } from './scrape-error';

/**
 * Tier 2 of the fetching engine: stores built on Shopify or WooCommerce publish their product data
 * as public JSON. That is far more stable than scraping the themed HTML (no JavaScript rendering,
 * no layout changes) and is meant for programmatic reads.
 *
 * An adapter turns a product page URL into the platform's JSON URL and turns the answer into a
 * minimal schema.org page, so the rest of the pipeline (`extractPrice`, `extractProductName`)
 * works unchanged whichever tier produced the HTML.
 */
export interface PlatformAdapter {
  platform: 'shopify' | 'woocommerce';
  /** Public JSON endpoint for this product. */
  apiUrl: string;
  /** Builds a schema.org Product page from the endpoint's response; throws `parse_failed`. */
  toHtml(body: unknown): string;
}

const SHOPIFY_PRODUCT = /\/products\/([^/?#]+)\/?$/i;
const WOO_PRODUCT = /\/product\/([^/?#]+)\/?$/i;

export function platformAdapterFor(rawUrl: string): PlatformAdapter | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }

  const shopify = SHOPIFY_PRODUCT.exec(url.pathname);
  if (shopify) {
    const base = url.pathname.slice(0, shopify.index); // keeps a locale prefix such as /ar
    return {
      platform: 'shopify',
      apiUrl: `${url.origin}${base}/products/${shopify[1]}.js`,
      toHtml: shopifyToHtml,
    };
  }

  const woo = WOO_PRODUCT.exec(url.pathname);
  if (woo) {
    return {
      platform: 'woocommerce',
      apiUrl: `${url.origin}/wp-json/wc/store/v1/products?slug=${woo[1]}`,
      toHtml: wooToHtml,
    };
  }
  return null;
}

// ───────────────────────── Shopify: /products/<handle>.js ─────────────────────────

function shopifyToHtml(body: unknown): string {
  const p = asRecord(body);
  const name = typeof p.title === 'string' ? p.title : null;
  const price = shopifyMoney(p.price);
  if (!name || price === null) throw new ScrapeError('parse_failed', 'Unexpected Shopify product shape');
  // The .js endpoint carries no currency; the caller's listing currency applies.
  return structuredPage(name, price, null, typeof p.available === 'boolean' ? p.available : null);
}

/** `.js` prices are integer minor units (9900 = 99.00); a decimal string is already major units. */
function shopifyMoney(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v / 100;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    if (!Number.isFinite(n)) return null;
    return v.includes('.') ? n : n / 100;
  }
  return null;
}

// ───────────────────────── WooCommerce: Store API ─────────────────────────

function wooToHtml(body: unknown): string {
  const first = Array.isArray(body) ? asRecord(body[0]) : {};
  const prices = asRecord(first.prices);
  const name = typeof first.name === 'string' ? first.name : null;
  const minor = typeof prices.currency_minor_unit === 'number' ? prices.currency_minor_unit : 2;
  const raw = Number(prices.price);
  if (!name || !Number.isFinite(raw) || minor < 0 || minor > 6) {
    throw new ScrapeError('parse_failed', 'Unexpected WooCommerce product shape');
  }
  const currency = typeof prices.currency_code === 'string' ? prices.currency_code.toUpperCase() : null;
  return structuredPage(name, raw / 10 ** minor, currency, typeof first.is_in_stock === 'boolean' ? first.is_in_stock : null);
}

// ───────────────────────── shared ─────────────────────────

function asRecord(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function structuredPage(name: string, price: number, currency: string | null, inStock: boolean | null): string {
  const offer: Record<string, unknown> = { '@type': 'Offer', price: price.toFixed(2) };
  if (currency) offer.priceCurrency = currency;
  if (inStock !== null) {
    offer.availability = inStock ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock';
  }
  const json = JSON.stringify({ '@context': 'https://schema.org', '@type': 'Product', name, offers: offer });
  // `<` is escaped so a product name can never close the script element.
  return `<script type="application/ld+json">${json.replace(/</g, '\\u003c')}</script>`;
}
