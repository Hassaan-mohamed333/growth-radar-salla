// Shared dashboard chrome: sidebar + header. Server component.
// RTL: only logical utilities (ms/me/ps/pe/start/end, text-start) so the layout mirrors with dir="rtl".

import Link from 'next/link';
import type { ReactNode } from 'react';
import {
  api,
  settle,
  SALLA_LOGIN_URL,
  type ConnectionState,
  type StoreStatus,
} from '../lib/api';
import { nf } from '../lib/format';
import { BrandLogo, BrandLogoFull, BrandMark } from './brand';
import { UserMenu } from './user-menu';

export type NavKey =
  | 'overview'
  | 'products'
  | 'competitors'
  | 'recommendations'
  | 'confidence';

/** Entries without `href` are planned sections and render as inert text, not dead links. */
export const nav: Array<{ key?: NavKey; label: string; href?: string }> = [
  { key: 'overview', label: 'نظرة عامة', href: '/' },
  { key: 'products', label: 'المنتجات', href: '/products' },
  { key: 'competitors', label: 'المنافسون', href: '/competitors' },
  { key: 'recommendations', label: 'التوصيات', href: '/recommendations' },
  { key: 'confidence', label: 'ثقة البيانات', href: '/data-confidence' },
  { label: 'الإعدادات' },
];

const connectionBadge: Record<ConnectionState, { label: string; dot: string; pill: string }> = {
  connected: { label: 'متصل بسلة', dot: 'bg-emerald-500', pill: 'bg-emerald-50 text-emerald-700' },
  expiring: { label: 'الربط يحتاج تجديدًا', dot: 'bg-amber-500', pill: 'bg-amber-50 text-amber-700' },
  disconnected: { label: 'غير متصل', dot: 'bg-red-500', pill: 'bg-red-50 text-red-700' },
};

export async function AppShell({
  active,
  title,
  status,
  children,
}: {
  active: NavKey;
  title: string;
  status: StoreStatus | null;
  children: ReactNode;
}) {
  const badge = connectionBadge[status?.status ?? 'disconnected'];
  // One-row request: only the total is needed. A failure just hides the count.
  const pending = await settle(api.recommendations({ status: 'PENDING', pageSize: 1 }), {
    unauthorized: false,
  });
  const pendingCount = pending?.total ?? 0;

  return (
    <div className="flex min-h-screen bg-slate-50">
      {/* Sidebar — sits at the inline-start edge (right in RTL) */}
      <aside className="hidden w-64 shrink-0 border-e border-slate-200 bg-white md:block">
        <Link href="/" aria-label="راصد — الرئيسية" className="block px-6 py-5">
          <BrandLogo />
        </Link>
        <nav aria-label="القائمة الرئيسية" className="px-3">
          <ul className="space-y-1">
            {nav.map((item) => (
              <li key={item.label}>
                {item.href ? (
                  <Link
                    href={item.href}
                    aria-current={item.key === active ? 'page' : undefined}
                    className={`flex items-center justify-between rounded-lg px-3 py-2 text-start text-sm font-medium ${
                      item.key === active
                        ? 'bg-brand-lightest text-brand-darkest'
                        : 'text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    {item.label}
                    {item.key === 'recommendations' && pendingCount > 0 && (
                      <span className="rounded-full bg-brand-dark px-2 py-0.5 text-xs font-bold tabular-nums text-white">
                        {nf.format(pendingCount)}
                      </span>
                    )}
                  </Link>
                ) : (
                  <span
                    aria-disabled="true"
                    className="flex items-center justify-between rounded-lg px-3 py-2 text-sm font-medium text-slate-500"
                  >
                    {item.label}
                    <span className="text-xs font-normal">قريبًا</span>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-4">
          <div className="flex min-w-0 items-center gap-3">
            {/* The sidebar is hidden below md, so the mark carries the brand on small screens. */}
            <Link href="/" aria-label="راصد — الرئيسية" className="md:hidden">
              <BrandMark size={32} />
            </Link>
            <h1 className="truncate text-lg font-bold text-brand-darkest">{title}</h1>
          </div>
          <div className="flex items-center gap-3">
            <span
              className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium ${badge.pill}`}
            >
              <span aria-hidden className={`h-2 w-2 rounded-full ${badge.dot}`} />
              {badge.label}
            </span>
            <UserMenu storeName={status?.store?.name ?? 'حسابي'} />
          </div>
        </header>

        <main className="flex-1 space-y-8 p-6">{children}</main>
      </div>
    </div>
  );
}

export function SignIn() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
      <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-8 text-center">
        <BrandLogoFull size={176} />
        <h1 className="sr-only">راصد</h1>
        <p className="mt-3 text-sm text-slate-600">سجّل الدخول عبر متجرك في سلة للوصول إلى لوحة التحكم.</p>
        <a
          href={SALLA_LOGIN_URL}
          className="mt-6 inline-block rounded-lg bg-brand-dark hover:bg-brand-darkest px-5 py-2 text-sm font-medium text-white"
        >
          الدخول عبر سلة
        </a>
      </div>
    </main>
  );
}
