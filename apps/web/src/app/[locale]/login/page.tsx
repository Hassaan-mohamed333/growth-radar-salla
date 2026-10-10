import { Radar } from 'lucide-react';
import { notFound } from 'next/navigation';
import { getDict } from '@/i18n';
import { isLocale } from '@/i18n/config';

export const dynamic = 'force-dynamic';
const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export default async function LoginPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ error?: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const t = getDict(locale);
  // Allow-list lookup: the query string is never rendered, only mapped to one of our own messages.
  const { error } = await searchParams;
  const message = error && Object.hasOwn(t.login.errors, error) ? t.login.errors[error as keyof typeof t.login.errors] : null;

  return (
    <main className="grid min-h-dvh place-items-center p-4">
      <div className="w-full max-w-md rounded-2xl border border-border bg-surface p-8 text-center shadow-sm">
        <span className="mx-auto mb-4 grid size-12 place-items-center rounded-2xl bg-brand text-brand-fg"><Radar className="size-6" aria-hidden /></span>
        <h1 className="text-2xl font-bold">{t.login.title}</h1>
        <p className="mt-2 text-sm text-muted">{t.login.subtitle}</p>
        {message ? <p role="alert" className="mt-4 rounded-xl bg-bad/10 px-4 py-2 text-sm text-bad">{message}</p> : null}
        {/* Plain navigation to the API, which sets the state/PKCE cookie and redirects to Salla. */}
        <a href={`${API}/salla/oauth/connect`} className="mt-6 inline-flex w-full items-center justify-center rounded-xl bg-brand px-4 py-3 font-semibold text-brand-fg hover:opacity-90">
          {t.login.cta}
        </a>
      </div>
    </main>
  );
}
