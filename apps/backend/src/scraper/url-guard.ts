import { isIP } from 'node:net';
import { ScrapeError, type UrlRejectionReason } from './scrape-error';

/**
 * Merchant-facing text for each rejection reason. Fixed strings only: they never
 * contain the submitted URL or any hint about our internal network.
 */
export const URL_REJECTION_TEXT: Record<UrlRejectionReason, string> = {
  too_long: 'الرابط طويل جدًا. الحد الأقصى 2048 حرفًا.',
  malformed: 'الرابط غير صالح. تأكد من كتابته كاملًا، مثل https://example.com/product',
  unsupported_scheme: 'الرابط يجب أن يبدأ بـ http:// أو https://.',
  has_credentials: 'الرابط يحتوي على اسم مستخدم أو كلمة مرور، وهذا غير مسموح.',
  internal_host: 'الرابط يشير لعنوان محلي أو داخلي، ولا يمكن فحصه.',
  private_address: 'الرابط يشير لعنوان IP خاص، ولا يمكن فحصه.',
  single_label_host: 'اسم النطاق غير صالح. استخدم نطاقًا عامًا مثل example.com.',
  unsupported_port: 'الرابط يحتوي على منفذ غير مدعوم. استخدم الرابط بدون رقم منفذ.',
};

/**
 * Competitor URLs are typed by merchants and fetched by our server, so they must
 * never be able to reach internal services (SSRF). This module is the single
 * place that decides what is an acceptable target; it is used both when a URL is
 * saved and, via the DNS `lookup` hook, at connect time (defeating rebinding).
 */

const MAX_URL_LENGTH = 2048;

export interface CompetitorUrlOptions {
  /** Tests only: the fetch specs listen on an ephemeral port. Never set in production. */
  allowNonStandardPorts?: boolean;
}

/** Parses and validates a competitor URL. Throws ScrapeError('invalid_url' | 'forbidden_target'). */
export function parseCompetitorUrl(raw: string, opts: CompetitorUrlOptions = {}): URL {
  if (raw.length > MAX_URL_LENGTH) {
    throw new ScrapeError('invalid_url', 'URL too long', { reason: 'too_long' });
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ScrapeError('invalid_url', 'Not a valid URL', { reason: 'malformed' });
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ScrapeError('invalid_url', 'Only http(s) URLs are allowed', {
      reason: 'unsupported_scheme',
    });
  }
  if (url.username || url.password) {
    throw new ScrapeError('invalid_url', 'URLs with credentials are not allowed', {
      reason: 'has_credentials',
    });
  }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    throw new ScrapeError('forbidden_target', 'Internal hostname', { reason: 'internal_host' });
  }
  if (isIP(host) && !isPublicAddress(host)) {
    throw new ScrapeError('forbidden_target', 'Private address', { reason: 'private_address' });
  }
  // A bare single-label host ("intranet") can only resolve internally.
  if (!isIP(host) && !host.includes('.')) {
    throw new ScrapeError('invalid_url', 'Hostname must be a public domain', {
      reason: 'single_label_host',
    });
  }
  // Checked after the host rules so internal targets still report as forbidden_target.
  // `port` is empty when it is the scheme default, so only 80 and 443 pass.
  if (url.port && !opts.allowNonStandardPorts) {
    throw new ScrapeError('invalid_url', 'Only standard web ports are allowed', {
      reason: 'unsupported_port',
    });
  }
  return url;
}

/** Normalised registrable-ish host used for the `competitors.domain` column. */
export function domainOf(url: URL): string {
  return url.hostname.toLowerCase().replace(/^www\./, '');
}

/** True only for globally routable unicast addresses. */
export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return isPublicV4(address);
  if (family === 6) return isPublicV6(address);
  return false;
}

function isPublicV4(a: string): boolean {
  const [o1, o2, o3] = a.split('.').map(Number) as [number, number, number, number];
  if (o1 === 0 || o1 === 10 || o1 === 127) return false;
  if (o1 === 100 && o2 >= 64 && o2 <= 127) return false; // CGNAT
  if (o1 === 169 && o2 === 254) return false; // link-local, cloud metadata
  if (o1 === 172 && o2 >= 16 && o2 <= 31) return false;
  if (o1 === 192 && o2 === 0 && o3 === 0) return false;
  if (o1 === 192 && o2 === 168) return false;
  if (o1 === 198 && (o2 === 18 || o2 === 19)) return false; // benchmarking
  if (o1 >= 224) return false; // multicast + reserved + broadcast
  return true;
}

function isPublicV6(a: string): boolean {
  const addr = a.toLowerCase();
  // IPv4-mapped (::ffff:a.b.c.d or ::ffff:hhhh:hhhh): judge the embedded v4.
  const mappedDotted = /^(?:0{0,4}:){0,5}ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(addr);
  if (mappedDotted) return isPublicV4(mappedDotted[1]!);
  const mappedHex = /^(?:0{0,4}:){0,5}ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(addr);
  if (mappedHex) {
    const hi = parseInt(mappedHex[1]!, 16);
    const lo = parseInt(mappedHex[2]!, 16);
    return isPublicV4(`${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`);
  }
  const hextets = addr.split(':');
  const first = parseInt(hextets[0] || '0', 16);
  // ::/16 holds unspecified, loopback and IPv4-compatible (::a.b.c.d) addresses. None are public.
  if (first === 0) return false;
  // NAT64 (64:ff9b::/96) and 6to4 (2002::/16) embed an IPv4 address, which can be private.
  if (first === 0x2002) return false;
  if (first === 0x64 && parseInt(hextets[1] || '0', 16) === 0xff9b) return false;
  if ((first & 0xfe00) === 0xfc00) return false; // fc00::/7 unique local
  if ((first & 0xffc0) === 0xfe80) return false; // fe80::/10 link-local
  if ((first & 0xff00) === 0xff00) return false; // ff00::/8 multicast
  return true;
}
