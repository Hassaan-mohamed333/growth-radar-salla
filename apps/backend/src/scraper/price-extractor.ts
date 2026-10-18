export interface ExtractedPrice {
  price: number;
  /** ISO 4217 when the page declares one. */
  currency: string | null;
  inStock: boolean | null;
}

const MAX_PRICE = 10_000_000;

/**
 * Pulls a product price out of a page without site-specific selectors:
 *   1. schema.org JSON-LD `Product.offers` (most storefronts, incl. Salla themes)
 *   2. Open Graph / product meta tags and `itemprop="price"`
 * Returns null when nothing trustworthy is found, which the caller treats as
 * "page structure changed".
 */
export function extractPrice(html: string): ExtractedPrice | null {
  return fromJsonLd(html) ?? fromMeta(html);
}

// ───────────────────────── JSON-LD ─────────────────────────

function fromJsonLd(html: string): ExtractedPrice | null {
  // Forward-only scans with bounded tags. A lazy `[\s\S]*?</script>` restarts at every
  // unclosed opening tag, which goes quadratic on hostile pages and blocks the event loop.
  const open = /<script\b[^<>]{0,1000}>/gi;
  const close = /<\/script\s*>/gi;
  for (let m = open.exec(html); m; m = open.exec(html)) {
    if (!LD_JSON_TYPE.test(m[0])) continue;
    close.lastIndex = open.lastIndex;
    const end = close.exec(html);
    if (!end) break; // no closing tag after this point, so none of the later blocks can match
    open.lastIndex = close.lastIndex;

    let doc: unknown;
    try {
      doc = JSON.parse(html.slice(m.index + m[0].length, end.index));
    } catch {
      continue;
    }
    for (const node of walk(doc)) {
      if (!hasType(node, 'Product')) continue;
      for (const offer of asArray(node.offers)) {
        const found = fromOffer(offer);
        if (found) return found;
      }
    }
  }
  return null;
}

const LD_JSON_TYPE = /\btype\s*=\s*["']application\/ld\+json["']/i;

function fromOffer(offer: unknown): ExtractedPrice | null {
  if (!isRecord(offer)) return null;
  // AggregateOffer carries lowPrice; nested `offers` appear on some themes.
  const nested = asArray(offer.offers).map(fromOffer).find(Boolean);
  const price = parsePrice(offer.price) ?? parsePrice(offer.lowPrice);
  if (price === null) return nested ?? null;
  const currency = typeof offer.priceCurrency === 'string' ? offer.priceCurrency.toUpperCase() : null;
  return { price, currency, inStock: availability(offer.availability) };
}

function availability(v: unknown): boolean | null {
  if (typeof v !== 'string') return null;
  if (/InStock|LimitedAvailability|OnlineOnly|InStoreOnly/i.test(v)) return true;
  if (/OutOfStock|SoldOut|Discontinued/i.test(v)) return false;
  return null;
}

function* walk(node: unknown): Generator<Record<string, unknown>> {
  if (Array.isArray(node)) {
    for (const n of node) yield* walk(n);
  } else if (isRecord(node)) {
    yield node;
    if (node['@graph']) yield* walk(node['@graph']);
  }
}

function hasType(node: Record<string, unknown>, type: string): boolean {
  const t = node['@type'];
  return Array.isArray(t) ? t.includes(type) : t === type;
}

// ───────────────────────── Meta tags ─────────────────────────

function fromMeta(html: string): ExtractedPrice | null {
  // Tags are bounded and cannot contain `<`, so each scan stops at the next tag.
  const metas = [...html.matchAll(/<meta\b[^<>]{0,1000}>/gi)].map((m) => attrs(m[0]));

  const content = (names: string[]) => {
    for (const a of metas) {
      const key = (a.property ?? a.name ?? a.itemprop ?? '').toLowerCase();
      if (names.includes(key) && a.content) return a.content;
    }
    return null;
  };

  const price = parsePrice(
    content(['product:price:amount', 'og:price:amount', 'twitter:data1', 'price']) ??
      itempropPrice(html),
  );
  if (price === null) return null;

  const currencyRaw = content(['product:price:currency', 'og:price:currency', 'pricecurrency']);
  const stockRaw = content(['product:availability', 'og:availability']);
  return {
    price,
    currency: currencyRaw ? currencyRaw.trim().toUpperCase() : null,
    inStock: stockRaw ? availability(stockRaw) ?? stockFromWords(stockRaw) : null,
  };
}

function itempropPrice(html: string): string | null {
  // Match the tag first, then test it: an unbounded `<[^>]+itemprop` is quadratic
  // on pages with many `<` and no `>`.
  for (const m of html.matchAll(/<[^<>]{0,2000}>/g)) {
    if (!/\bitemprop\s*=\s*["']price["']/i.test(m[0])) continue;
    const a = attrs(m[0]);
    return a.content ?? a.value ?? null;
  }
  return null;
}

function stockFromWords(v: string): boolean | null {
  if (/^\s*(in stock|instock|available)\s*$/i.test(v)) return true;
  if (/^\s*(out of stock|oos|unavailable)\s*$/i.test(v)) return false;
  return null;
}

function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  // Names are capped in length so a long run of letters cannot backtrack for long.
  for (const m of tag.matchAll(/([a-zA-Z_:][-a-zA-Z0-9_:.]{0,100})\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    out[m[1]!.toLowerCase()] = decodeEntities(m[2] ?? m[3] ?? '');
  }
  return out;
}

function decodeEntities(s: string): string {
  return s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

// ───────────────────────── Number parsing ─────────────────────────

/** Accepts numbers or strings such as "1,299.50", "1.299,50", "٣٤٫٥٠ ر.س". */
export function parsePrice(value: unknown): number | null {
  if (typeof value === 'number') return valid(value);
  if (typeof value !== 'string') return null;

  // A leading minus means a discount/negative amount, not a price.
  if (/^[\s ]*[-−–]/.test(value)) return null;

  let s = value
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)) // Arabic-Indic digits
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0)) // Persian digits
    .replace(/٫/g, '.') // Arabic decimal separator
    .replace(/[٬\s ']/g, '') // Arabic thousands separator, spaces
    .replace(/[^\d.,]/g, '');
  // Currency symbols such as "ر.س" / "د.إ" leave stray separators at the edges.
  s = trimSeparators(s);
  if (!/\d/.test(s)) return null;

  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  if (lastDot >= 0 && lastComma >= 0) {
    // Both present: the later one is the decimal separator.
    const dec = Math.max(lastDot, lastComma);
    s = s.slice(0, dec).replace(/[.,]/g, '') + '.' + s.slice(dec + 1);
  } else if (lastComma >= 0) {
    // "12,5" / "12,50" → decimal; "1,299" → thousands.
    s = /,\d{1,2}$/.test(s) ? s.replace(',', '.') : s.replace(/,/g, '');
  } else if ((s.match(/\./g) ?? []).length > 1) {
    s = s.replace(/\./g, ''); // "1.299.000"
  }
  return valid(Number(s));
}

/** Strips leading and trailing `.`/`,` in one linear pass (`/[.,]+$/` is quadratic on long runs). */
function trimSeparators(s: string): string {
  const isSep = (c: string) => c === '.' || c === ',';
  let start = 0;
  let end = s.length;
  while (start < end && isSep(s[start]!)) start++;
  while (end > start && isSep(s[end - 1]!)) end--;
  return s.slice(start, end);
}

function valid(n: number): number | null {
  return Number.isFinite(n) && n > 0 && n <= MAX_PRICE ? Math.round(n * 100) / 100 : null;
}

// ───────────────────────── helpers ─────────────────────────

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : v === undefined || v === null ? [] : [v];
}
