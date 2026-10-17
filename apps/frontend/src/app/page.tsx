// Dashboard home — server component; data comes from the NestJS backend.
// RTL: only logical utilities (ms/me/ps/pe/start/end, text-start) so the layout mirrors with dir="rtl".

import Link from 'next/link';
import {
  api,
  settle,
  type AnalyticsSummary,
  type PriceTrends,
  type SalesVelocity,
  type StoreStatus,
} from '../lib/api';
import { formatDate, money, nf, signedPct } from '../lib/format';
import { AppShell, SignIn } from './app-shell';

export const dynamic = 'force-dynamic';

const recTypeLabel: Record<string, string> = {
  PRICE_ADJUSTMENT: 'تعديل سعر',
  RESTOCK: 'إعادة تخزين',
  PROMOTION: 'عرض ترويجي',
  COMPETITOR_ALERT: 'تنبيه منافس',
  LISTING_IMPROVEMENT: 'تحسين المنتج',
};

function velocityCard(v: SalesVelocity | null): { value: string; hint: string } {
  if (!v) return { value: '—', hint: 'تتوفر بعد مزامنة الطلبات' };
  const change =
    v.unitsChangePct === null ? '' : ` · ${signedPct(v.unitsChangePct)} عن الفترة السابقة`;
  return {
    value: `${nf.format(v.unitsPerDay)} وحدة/يوم`,
    hint: `${money(v.revenuePerDay, v.currency)}/يوم${change}`,
  };
}

function confidenceLabel(c: number | null): string {
  if (c === null) return 'غير مقيَّمة';
  if (c >= 80) return `ثقة عالية · ${nf.format(c)}%`;
  if (c >= 50) return `ثقة متوسطة · ${nf.format(c)}%`;
  return `ثقة منخفضة · ${nf.format(c)}%`;
}

export default async function DashboardPage() {
  const flags = { unauthorized: false };
  const [status, summary] = await Promise.all([
    settle(api.storeStatus(), flags),
    settle(api.analyticsSummary(), flags),
  ]);

  if (flags.unauthorized) return <SignIn />;

  const backendDown = status === null;

  return (
    <AppShell active="overview" title="لوحة التحكم" status={status}>
      {backendDown && (
        <div
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700"
        >
          تعذّر الاتصال بالخادم. تحقق من تشغيل الواجهة الخلفية ثم أعد تحميل الصفحة.
        </div>
      )}

      <ConnectionSection status={status} />
      {summary ? (
        <SummarySections summary={summary} />
      ) : (
        !backendDown && (
          <p className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-600">
            لا تتوفر تحليلات بعد. اربط متجرك بسلة لبدء جمع البيانات.
          </p>
        )
      )}
    </AppShell>
  );
}

function ConnectionSection({ status }: { status: StoreStatus | null }) {
  const items = [
    { label: 'المتجر', value: status?.store?.name ?? '—' },
    { label: 'آخر مزامنة', value: formatDate(status?.lastSyncAt ?? null) },
    {
      label: 'الإشعارات (Webhooks)',
      value: status
        ? `${status.webhooks.endpoint} · ${
            status.webhooks.verification === 'signature' ? 'توقيع HMAC' : 'رمز ثابت'
          }`
        : '—',
    },
    {
      label: 'الصلاحيات',
      value: status?.connection?.scopes.length ? status.connection.scopes.join('، ') : '—',
    },
  ];

  return (
    <section
      aria-labelledby="conn-heading"
      className="rounded-xl border border-slate-200 bg-white p-5"
    >
      <h2 id="conn-heading" className="mb-4 text-base font-bold">
        حالة الربط مع سلة
      </h2>
      <dl className="grid gap-4 text-sm sm:grid-cols-2 xl:grid-cols-4">
        {items.map((item) => (
          <div key={item.label} className="min-w-0">
            <dt className="text-slate-500">{item.label}</dt>
            <dd className="mt-1 break-words font-medium">{item.value}</dd>
          </div>
        ))}
      </dl>
      {status?.connection?.lastError && (
        <p className="mt-4 text-sm text-red-700">آخر خطأ: {status.connection.lastError}</p>
      )}
    </section>
  );
}

function PriceTrendSection({ trends }: { trends: PriceTrends }) {
  return (
    <section aria-labelledby="trend-heading">
      <h2 id="trend-heading" className="mb-3 text-base font-bold">
        تقلبات أسعار المنافسين
      </h2>
      {trends.changes === 0 ? (
        <p className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-600">
          لم تُرصد تغييرات في أسعار المنافسين خلال آخر {nf.format(trends.windowDays)} يومًا.
        </p>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <p className="text-sm text-slate-600">
            {nf.format(trends.changes)} تغيير خلال {nf.format(trends.windowDays)} يومًا ·{' '}
            {nf.format(trends.increases)} ارتفاع · {nf.format(trends.decreases)} انخفاض
            {trends.avgChangePct !== null && <> · المتوسط {signedPct(trends.avgChangePct)}</>}
          </p>
          <ul className="mt-4 divide-y divide-slate-100">
            {trends.recent.map((r) => (
              <li
                key={`${r.competitorId}-${r.observedAt}`}
                className="flex items-center justify-between gap-4 py-2 text-sm"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">{r.competitorName}</p>
                  {r.productName && (
                    <p className="truncate text-xs text-slate-500">{r.productName}</p>
                  )}
                </div>
                <p className="shrink-0 tabular-nums">
                  {nf.format(r.previousPrice)} ← {nf.format(r.price)}{' '}
                  <span className={r.changePct < 0 ? 'text-emerald-700' : 'text-red-700'}>
                    ({signedPct(r.changePct)})
                  </span>
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function SummarySections({ summary }: { summary: AnalyticsSummary }) {
  const { pricingConfidence: pc, competitors, products, recommendations } = summary;

  const kpis = [
    { label: 'سرعة المبيعات', ...velocityCard(summary.salesVelocity) },
    {
      label: 'درجة ثقة التسعير',
      value: pc.score === null ? '—' : `${nf.format(pc.score)}%`,
      hint:
        pc.auditsCount > 0
          ? `${nf.format(pc.auditsCount)} تدقيق خلال ${nf.format(pc.windowDays)} يومًا`
          : 'لا توجد تدقيقات بعد',
    },
    {
      label: 'منافسون أقل سعرًا',
      value: nf.format(competitors.undercutting),
      hint: `من ${nf.format(competitors.active)} منافسًا نشطًا`,
    },
    {
      label: 'توصيات معلّقة',
      value: nf.format(recommendations.pending),
      hint: `${nf.format(products.monitored)} منتجًا مراقَبًا من ${nf.format(products.total)}`,
    },
  ];

  return (
    <>
      <section aria-labelledby="kpi-heading">
        <h2 id="kpi-heading" className="sr-only">
          المؤشرات الرئيسية
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {kpis.map((kpi) => (
            <div key={kpi.label} className="rounded-xl border border-slate-200 bg-white p-5">
              <p className="text-sm text-slate-500">{kpi.label}</p>
              <p className="mt-2 text-3xl font-bold tabular-nums">{kpi.value}</p>
              <p className="mt-1 text-xs text-slate-500">{kpi.hint}</p>
            </div>
          ))}
        </div>
      </section>

      <PriceTrendSection trends={summary.priceTrends} />

      <section aria-labelledby="rec-heading">
        <div className="mb-3 flex items-center justify-between">
          <h2 id="rec-heading" className="text-base font-bold">
            أحدث التوصيات
          </h2>
          <Link href="/recommendations" className="text-sm font-medium text-brand-dark">
            عرض الكل
          </Link>
        </div>
        {recommendations.items.length === 0 ? (
          <p className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-600">
            لا توجد توصيات معلّقة حاليًا.
          </p>
        ) : (
          <ul className="space-y-3">
            {recommendations.items.map((rec) => (
              <li
                key={rec.id}
                className="flex items-start justify-between gap-4 rounded-xl border border-slate-200 bg-white p-5"
              >
                <div className="min-w-0">
                  <p className="text-xs text-slate-500">{recTypeLabel[rec.type] ?? rec.type}</p>
                  <p className="mt-1 font-medium">{rec.title}</p>
                  <p className="mt-1 text-sm text-slate-600">{rec.rationale}</p>
                </div>
                <span className="shrink-0 rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-700">
                  {confidenceLabel(rec.confidence)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
