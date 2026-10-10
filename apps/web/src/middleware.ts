import { NextResponse, type NextRequest } from 'next/server';
import { DEFAULT_LOCALE, isLocale } from '@/i18n/config';

const isDev = process.env.NODE_ENV !== 'production';

export function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;

  // 1) Locale prefix: /dashboard -> /ar/dashboard (Arabic first; Accept-Language can switch to English).
  const first = pathname.split('/')[1];
  if (!isLocale(first)) {
    const pref = req.headers.get('accept-language')?.toLowerCase().startsWith('en') ? 'en' : DEFAULT_LOCALE;
    const url = req.nextUrl.clone();
    url.pathname = `/${pref}${pathname === '/' ? '/dashboard' : pathname}`;
    url.search = search;
    return NextResponse.redirect(url);
  }

  // 2) Per-request CSP nonce. 'strict-dynamic' lets Next's nonced bootstrap load its chunks; no 'unsafe-inline' for scripts.
  const nonce = btoa(crypto.randomUUID());
  const api = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
  const csp = [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ''}`,
    `style-src 'self' ${isDev ? "'unsafe-inline'" : `'nonce-${nonce}'`}`,
    `style-src-attr 'unsafe-inline'`, // style="" attributes only (e.g. progress widths); cannot execute script
    `img-src 'self' data: blob:`,
    `font-src 'self'`,
    `connect-src 'self' ${api}`,
    `form-action 'self' ${api}`, // login is a GET navigation to the API's OAuth start
    `frame-ancestors 'none'`,
    `base-uri 'none'`,
    `object-src 'none'`,
    ...(isDev ? [] : ['upgrade-insecure-requests']),
  ].join('; ');

  const headers = new Headers(req.headers);
  headers.set('x-nonce', nonce);
  headers.set('Content-Security-Policy', csp);
  const res = NextResponse.next({ request: { headers } });
  res.headers.set('Content-Security-Policy', csp);
  return res;
}

export const config = {
  matcher: [{ source: '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|ico|webp)$).*)' }],
};
