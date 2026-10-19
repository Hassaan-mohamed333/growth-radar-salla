// Loading placeholders. Each route's loading.tsx renders inside <ShellSkeleton>, which repeats
// the dashboard chrome (sidebar + header) so the page doesn't jump when the data arrives.
// Server components, no JS: the pulse is CSS and is switched off for reduced motion.

import Link from 'next/link';
import type { ReactNode } from 'react';
import { nav, type NavKey } from './app-shell';
import { BrandLogo } from './brand';

export function Skeleton({ className = '' }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={`animate-pulse rounded-md bg-slate-200/70 motion-reduce:animate-none ${className}`}
    />
  );
}

/**
 * `active` and `title` are optional on purpose: the root loading.tsx also catches navigations to
 * pages whose own skeleton isn't prefetched yet, so it must not claim a page it can't know.
 */
export function ShellSkeleton({
  active,
  title,
  children,
}: {
  active?: NavKey;
  title?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-screen bg-slate-50">
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
                    aria-current={active && item.key === active ? 'page' : undefined}
                    className={`flex items-center rounded-lg px-3 py-2 text-start text-sm font-medium ${
                      active && item.key === active
                        ? 'bg-brand-lightest text-brand-darkest'
                        : 'text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    {item.label}
                  </Link>
                ) : (
                  <span className="flex items-center justify-between rounded-lg px-3 py-2 text-sm font-medium text-slate-500">
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
          {title ? (
            <h1 className="text-lg font-bold text-brand-darkest">{title}</h1>
          ) : (
            <Skeleton className="h-6 w-32" />
          )}
          <Skeleton className="h-7 w-28 rounded-full" />
        </header>
        <main
          role="status"
          aria-busy="true"
          aria-label="جارٍ تحميل الصفحة"
          className="flex-1 space-y-8 p-6"
        >
          <span className="sr-only">جارٍ التحميل…</span>
          {children}
        </main>
      </div>
    </div>
  );
}

/** A row of stat tiles. */
export function StatCardsSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="space-y-3 rounded-xl border border-slate-200 bg-white p-5">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-8 w-16" />
          <Skeleton className="h-3 w-32" />
        </div>
      ))}
    </div>
  );
}

/** A bordered table with a header row. */
export function TableSkeleton({ rows = 5, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="flex gap-4 border-b border-slate-200 px-4 py-3">
        {Array.from({ length: cols }, (_, i) => (
          <Skeleton key={i} className="h-4 flex-1" />
        ))}
      </div>
      <div className="divide-y divide-slate-100">
        {Array.from({ length: rows }, (_, r) => (
          <div key={r} className="flex gap-4 px-4 py-4">
            {Array.from({ length: cols }, (_, c) => (
              <Skeleton key={c} className="h-5 flex-1" />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Stacked cards, e.g. recommendations or audits. */
export function CardListSkeleton({ count = 3 }: { count?: number }) {
  return (
    <ul className="space-y-3">
      {Array.from({ length: count }, (_, i) => (
        <li key={i} className="space-y-3 rounded-xl border border-slate-200 bg-white p-5">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-5 w-2/3" />
              <Skeleton className="h-4 w-1/2" />
            </div>
            <Skeleton className="h-6 w-24 rounded-full" />
          </div>
          <div className="grid gap-4 border-t border-slate-100 pt-4 sm:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 4 }, (_, j) => (
              <div key={j} className="space-y-2">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-5 w-24" />
              </div>
            ))}
          </div>
        </li>
      ))}
    </ul>
  );
}
