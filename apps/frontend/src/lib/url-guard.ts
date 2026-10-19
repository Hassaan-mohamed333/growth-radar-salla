// Client-side pre-check for competitor URLs. It MIRRORS apps/backend/src/scraper/url-guard.ts
// (same rules, same order, same merchant text) so the merchant sees a clear reason before any
// request is sent. It is a convenience only: the backend stays the authority and re-validates
// every URL, including DNS resolution and redirects, which a browser cannot check.
//
// Keep the rules and the texts in sync with the backend file when either changes.

export type UrlRejectionReason =
  | 'too_long'
  | 'malformed'
  | 'unsupported_scheme'
  | 'has_credentials'
  | 'internal_host'
  | 'private_address'
  | 'single_label_host'
  | 'unsupported_port';

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

export type UrlCheck = { ok: true } | { ok: false; reason: UrlRejectionReason; message: string };

const MAX_URL_LENGTH = 2048;

const reject = (reason: UrlRejectionReason): UrlCheck => ({
  ok: false,
  reason,
  message: URL_REJECTION_TEXT[reason],
});

/** Validates a merchant-typed competitor URL. The value is trimmed first. */
export function checkCompetitorUrl(input: string): UrlCheck {
  const raw = input.trim();
  if (raw.length > MAX_URL_LENGTH) return reject('too_long');

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return reject('malformed');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return reject('unsupported_scheme');
  if (url.username || url.password) return reject('has_credentials');

  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal')
  ) {
    return reject('internal_host');
  }

  const v4 = isIPv4(host);
  const v6 = !v4 && host.includes(':');
  if ((v4 && !isPublicV4(host)) || (v6 && !isPublicV6(host))) return reject('private_address');
  // A bare single-label host ("intranet") can only resolve internally.
  if (!v4 && !v6 && !host.includes('.')) return reject('single_label_host');
  // `port` is empty for the scheme default, so only 80 and 443 pass.
  if (url.port) return reject('unsupported_port');

  return { ok: true };
}

function isIPv4(host: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
}

function isPublicV4(address: string): boolean {
  const [o1, o2, o3] = address.split('.').map(Number) as [number, number, number, number];
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

function isPublicV6(address: string): boolean {
  const addr = address.toLowerCase();
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
  if (first === 0) return false; // ::/16: unspecified, loopback, IPv4-compatible
  if (first === 0x2002) return false; // 6to4 embeds an IPv4 address
  if (first === 0x64 && parseInt(hextets[1] || '0', 16) === 0xff9b) return false; // NAT64
  if ((first & 0xfe00) === 0xfc00) return false; // fc00::/7 unique local
  if ((first & 0xffc0) === 0xfe80) return false; // fe80::/10 link-local
  if ((first & 0xff00) === 0xff00) return false; // ff00::/8 multicast
  return true;
}
