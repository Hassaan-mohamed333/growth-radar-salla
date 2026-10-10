import { isIP } from 'node:net';
import { ScrapeError } from './scrape-error';

/**
 * Competitor URLs are typed by merchants and fetched by our server, so they must
 * never be able to reach internal services (SSRF). This module is the single
 * place that decides what is an acceptable target; it is used both when a URL is
 * saved and, via the DNS `lookup` hook, at connect time (defeating rebinding).
 */

const MAX_URL_LENGTH = 2048;

/** Parses and validates a competitor URL. Throws ScrapeError('invalid_url' | 'forbidden_target'). */
export function parseCompetitorUrl(raw: string): URL {
  if (raw.length > MAX_URL_LENGTH) throw new ScrapeError('invalid_url', 'URL too long');
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ScrapeError('invalid_url', 'Not a valid URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ScrapeError('invalid_url', 'Only http(s) URLs are allowed');
  }
  if (url.username || url.password) {
    throw new ScrapeError('invalid_url', 'URLs with credentials are not allowed');
  }

  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    throw new ScrapeError('forbidden_target', 'Internal hostname');
  }
  if (isIP(host) && !isPublicAddress(host)) {
    throw new ScrapeError('forbidden_target', 'Private address');
  }
  // A bare single-label host ("intranet") can only resolve internally.
  if (!isIP(host) && !host.includes('.')) {
    throw new ScrapeError('invalid_url', 'Hostname must be a public domain');
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
  if (addr === '::' || addr === '::1') return false;
  const first = parseInt(addr.split(':')[0] || '0', 16);
  if ((first & 0xfe00) === 0xfc00) return false; // fc00::/7 unique local
  if ((first & 0xffc0) === 0xfe80) return false; // fe80::/10 link-local
  if ((first & 0xff00) === 0xff00) return false; // ff00::/8 multicast
  return true;
}
