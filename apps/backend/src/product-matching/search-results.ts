import { attrs, decodeEntities } from '../scraper/price-extractor';

export interface Candidate {
  /** Absolute product page URL, on the competitor's own domain. */
  url: string;
  /** The title as the search page shows it; the product page's own name is checked later. */
  title: string;
}

/**
 * Search URLs to try on a competitor's site, most common first. Salla and Shopify stores answer
 * `/search?q=`, Salla also under the language prefix, WooCommerce uses `?s=`. The first one that
 * yields product links wins, so an unknown platform costs at most a few requests.
 */
export function searchUrls(domain: string, query: string): string[] {
  const q = encodeURIComponent(query);
  return [
    `https://${domain}/search?q=${q}`,
    `https://${domain}/ar/search?q=${q}`,
    `https://${domain}/?s=${q}&post_type=product`,
  ];
}

/**
 * Product page paths on the platforms Saudi stores run on: Shopify `/products/x`, WooCommerce
 * `/product/x`, Salla `/ar/slug/p123456`, noon `/slug/N123/p/`, Amazon `/dp/B0...`.
 */
const PRODUCT_PATH = /\/(?:products?|dp|item)\/[^/]|\/p\/?(?:[?#]|$)|\/p\d{4,}(?:[/?#]|$)/i;

const MAX_ANCHOR_TEXT = 3000;
const MAX_TITLE_LENGTH = 300;

/**
 * Product links found in a search results page, best-titled first occurrence kept per product.
 * Only links on `domain` (or a subdomain) are returned: a search page full of ads and partner
 * links must never make us fetch someone else's site on a merchant's behalf.
 *
 * Linear scans only. Pages are untrusted, and an unanchored lazy match over a megabyte of markup
 * is how a request gets stuck, so each tag is matched by a bounded pattern and the text after it
 * is located with indexOf.
 */
export function extractCandidates(html: string, pageUrl: URL, domain: string, max = 10): Candidate[] {
  const byProduct = new Map<string, Candidate>();

  for (const m of html.matchAll(/<a\b[^<>]{0,1500}>/gi)) {
    const a = attrs(m[0]);
    const url = resolveProductUrl(a.href, pageUrl, domain);
    if (!url) continue;

    const title = anchorTitle(a, html, m.index + m[0].length);
    if (title.length < 3) continue;

    const key = url.origin + url.pathname;
    const prev = byProduct.get(key);
    // The same product is usually linked from its image and from its name: keep the longer title.
    if (!prev || title.length > prev.title.length) {
      byProduct.set(key, { url: url.toString(), title });
    }
    if (byProduct.size >= max * 3) break; // enough to rank; never walk a huge page to the end
  }
  return [...byProduct.values()].slice(0, max);
}

export function isOnDomain(hostname: string, domain: string): boolean {
  const host = hostname.toLowerCase().replace(/^www\./, '');
  const d = domain.toLowerCase().replace(/^www\./, '');
  return host === d || host.endsWith(`.${d}`);
}

function resolveProductUrl(href: string | undefined, base: URL, domain: string): URL | null {
  if (!href || href.length > 2048) return null;
  let url: URL;
  try {
    url = new URL(decodeEntities(href), base);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.username || url.password || url.port) return null;
  if (!isOnDomain(url.hostname, domain)) return null;
  if (!PRODUCT_PATH.test(decodeSafe(url.pathname))) return null;
  url.hash = '';
  return url;
}

function anchorTitle(a: Record<string, string>, html: string, from: number): string {
  const direct = clean(a.title ?? a['aria-label']);
  if (direct) return direct;

  const end = html.indexOf('</a', from);
  const inner = html.slice(from, end < 0 ? from + MAX_ANCHOR_TEXT : Math.min(end, from + MAX_ANCHOR_TEXT));

  const text = clean(inner.replace(/<[^<>]{0,500}>/g, ' '));
  if (text) return text;

  // An image-only link: the picture's alt text is usually the product name.
  const img = /<img\b[^<>]{0,1000}>/i.exec(inner);
  return img ? clean(attrs(img[0]).alt) : '';
}

function clean(v: string | undefined): string {
  if (!v) return '';
  return decodeEntities(v).replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE_LENGTH);
}

function decodeSafe(path: string): string {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}
