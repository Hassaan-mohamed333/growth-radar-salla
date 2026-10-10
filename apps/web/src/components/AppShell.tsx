import { BarChart3, Gauge as GaugeIcon, Radar, Settings, Swords, Target } from 'lucide-react';
import type { ReactNode } from 'react';
import { cookies } from 'next/headers';
import Link from 'next/link';
import type { Dict } from '@/i18n';
import type { Locale } from '@/i18n/config';
import { ThemeToggle } from './ThemeToggle';

export async function AppShell({ locale, t, storeName, children }: { locale: Locale; t: Dict; storeName: string | null; children: ReactNode }) {
  const raw = (await cookies()).get('radar_theme')?.value;
  const theme = raw === 'light' || raw === 'dark' ? raw : 'system';
  const other: Locale = locale === 'ar' ? 'en' : 'ar';
  const nav = [
    { key: 'overview', label: t.nav.overview, icon: GaugeIcon, href: `/${locale}/dashboard`, active: true },
    { key: 'tracking', label: t.nav.tracking, icon: Target },
    { key: 'competitors', label: t.nav.competitors, icon: Swords },
    { key: 'decisions', label: t.nav.decisions, icon: BarChart3 },
    { key: 'settings', label: t.nav.settings, icon: Settings },
  ];
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[16rem_1fr]">
      <aside className="hidden border-e border-border bg-surface lg:block">
        <div className="sticky top-0 flex h-dvh flex-col gap-6 p-5">
          <div className="flex items-center gap-2.5">
            <span className="grid size-9 place-items-center rounded-xl bg-brand text-brand-fg"><Radar className="size-5" aria-hidden /></span>
            <div className="leading-tight">
              <p className="font-bold">{t.brand}</p>
              <p className="text-xs text-muted">{t.tagline}</p>
            </div>
          </div>
          <nav aria-label="Primary" className="flex flex-col gap-1">
            {nav.map(({ key, label, icon: Icon, href, active }) =>
              href ? (
                <Link key={key} href={href} aria-current={active ? 'page' : undefined}
                  className={`flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium ${active ? 'bg-brand/10 text-brand' : 'text-muted hover:bg-surface-2'}`}>
                  <Icon className="size-4" aria-hidden />{label}
                </Link>
              ) : (
                <span key={key} aria-disabled="true" className="flex cursor-not-allowed items-center gap-3 rounded-xl px-3 py-2 text-sm text-muted/60">
                  <Icon className="size-4" aria-hidden />{label}
                </span>
              ),
            )}
          </nav>
        </div>
      </aside>
      <div className="min-w-0">
        <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-border bg-bg/80 px-4 py-3 backdrop-blur sm:px-6">
          <span className="grid size-8 place-items-center rounded-lg bg-brand text-brand-fg lg:hidden"><Radar className="size-4" aria-hidden /></span>
          {storeName ? <p className="truncate text-sm text-muted">{t.common.store}: <span className="font-semibold text-fg">{storeName}</span></p> : null}
          <div className="ms-auto flex items-center gap-2">
            <Link href={`/${other}/dashboard`} hrefLang={other} lang={other} className="rounded-xl border border-border bg-surface-2 px-3 py-1.5 text-sm font-medium hover:bg-surface">
              {t.common.language}
            </Link>
            <ThemeToggle initial={theme} labels={{ light: t.common.light, dark: t.common.dark, system: t.common.system }} />
          </div>
        </header>
        <main className="mx-auto max-w-6xl p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}
