import { AlertTriangle, Inbox } from 'lucide-react';
import { redirect, notFound } from 'next/navigation';
import { AppShell } from '@/components/AppShell';
import { ConfidenceCard } from '@/components/ConfidenceCard';
import { DecisionCard } from '@/components/DecisionCard';
import { HealthCard, RevenueAtRiskCard } from '@/components/MetricCards';
import { getDict, formatDateTime } from '@/i18n';
import { isLocale } from '@/i18n/config';
import { UnauthenticatedError, loadOverview, type OverviewResult } from '@/lib/api';

export const dynamic = 'force-dynamic'; // per-user, per-request data: never statically cached

export default async function DashboardPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const t = getDict(locale);

  let result: OverviewResult | null = null;
  let failed = false;
  try {
    result = await loadOverview(locale);
  } catch (e) {
    if (e instanceof UnauthenticatedError) redirect(`/${locale}/login`);
    failed = true;
  }

  const o = result?.overview ?? null;
  return (
    <AppShell locale={locale} t={t} storeName={result?.storeName ?? null}>
      <div className="mb-6">
        <h1 className="text-2xl font-bold">{t.overview.title}</h1>
        <p className="text-sm text-muted">{t.overview.subtitle}{o ? <> · {t.common.updated}: <span className="tabular">{formatDateTime(locale, o.generatedAt)}</span></> : null}</p>
      </div>

      {result?.demo ? (
        <p role="status" className="mb-4 flex items-center gap-2 rounded-xl bg-warn/10 px-4 py-2 text-sm text-warn">
          <AlertTriangle className="size-4" aria-hidden />{t.overview.apiDown}
        </p>
      ) : null}

      {failed ? (
        <p role="alert" className="rounded-2xl border border-bad/30 bg-bad/10 p-6 text-bad">{t.overview.apiDown}</p>
      ) : !o ? (
        <div className="grid place-items-center gap-2 rounded-2xl border border-dashed border-border p-12 text-muted">
          <Inbox className="size-8" aria-hidden />{t.overview.empty}
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-4">
          <ConfidenceCard data={o.confidence} t={t} />
          <div className="grid gap-4 lg:col-span-2 lg:grid-cols-1">
            <RevenueAtRiskCard data={o.revenueAtRisk} currency={o.currency} t={t} locale={locale} />
            <HealthCard score={o.marketingHealthScore} t={t} />
          </div>

          <section className="lg:col-span-4" aria-labelledby="top-decisions">
            <h2 id="top-decisions" className="mb-3 text-lg font-semibold">{t.decisions.title}</h2>
            {o.topDecisions.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-border p-6 text-center text-muted">{t.decisions.none}</p>
            ) : (
              <ol className="grid gap-4 md:grid-cols-3">
                {o.topDecisions.map((r, i) => <DecisionCard key={r.id} rec={r} rank={i + 1} t={t} locale={locale} />)}
              </ol>
            )}
          </section>
        </div>
      )}
    </AppShell>
  );
}
