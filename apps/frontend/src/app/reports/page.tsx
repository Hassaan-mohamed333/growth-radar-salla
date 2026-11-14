// Reports — server component. Period performance comes from daily sales snapshots; product
// rankings come from Salla's own lifetime counters (sold quantity, views). Profit is an estimate.

import Link from 'next/link';
import { api, settle, type PeriodReport, type ProductReport } from '../../lib/api';
import { money, nf, signedPct } from '../../lib/format';
import { isStale, label, type TruthLabel } from '../../lib/truth-labels';
import { AppShell, SignIn } from '../app-shell';
import { TruthBadge } from '../truth-badge';

export const dynamic = 'force-dynamic';

const ESTIMATED: TruthLabel = {
  kind: 'computed',
  icon: '≈',
  text: 'مُقدَّر',
  hint: 'مبيعات تراكمية × هامش اليوم، وليس الربح الفعلي لكل عملية بيع',
};

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const period = sp.period === 'month' ? 'month' : 'week';
  const flags = { unauthorized: false };
  const [status, periodReport, products] = await Promise.all([
    settle(api.storeStatus(), flags),
    settle(api.periodReport(period), flags),
    settle(api.productReport(), flags),
  ]);
  if (flags.unauthorized) return <SignIn />;

  return (
    <AppShell active="reports" title="التقارير" status={status}>
      <PeriodSection report={periodReport} period={period} />
      {products ? (
        <ProductSections data={products} />
      ) : (
        <p className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-600">
          تعذّر تحميل تقرير المنتجات. حاول مرة أخرى بعد قليل.
        </p>
      )}
    </AppShell>
  );
}

function Tabs({ period }: { period: 'week' | 'month' }) {
  const tab = (key: 'week' | 'month', text: string) => (
    <Link
      href={`/reports?period=${key}`}
      aria-current={period === key ? 'page' : undefined}
      className={`rounded-lg px-4 py-1.5 text-sm font-medium ${
        period === key
          ? 'bg-brand-lightest text-brand-darkest'
          : 'text-slate-600 hover:bg-slate-100'
      }`}
    >
      {text}
    </Link>
  );
  return (
    <nav aria-label="فترة التقرير" className="flex gap-2">
      {tab('week', 'آخر 7 أيام')}
      {tab('month', 'آخر 30 يومًا')}
    </nav>
  );
}

function Stat({ label: text, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5">
      <p className="text-sm text-slate-500">{text}</p>
      <p className="mt-2 text-3xl font-bold tabular-nums">{value}</p>
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

function PeriodSection({
  report,
  period,
}: {
  report: PeriodReport | null;
  period: 'week' | 'month';
}) {
  return (
    <section aria-labelledby="period-heading" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="period-heading" className="text-base font-bold">
          أداء المتجر
        </h2>
        <Tabs period={period} />
      </div>
      {!report || report.current.daysCovered === 0 ? (
        <p className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-600">
          لا تتوفر بيانات مبيعات لهذه الفترة بعد. تظهر بعد مزامنة الطلبات.
        </p>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Stat
              label="صافي الإيراد"
              value={money(report.current.netRevenue, report.currency)}
              hint={
                report.revenueChangePct === null
                  ? 'لا تتوفر فترة سابقة كافية للمقارنة'
                  : `${signedPct(report.revenueChangePct)} عن الفترة السابقة`
              }
            />
            <Stat
              label="الطلبات"
              value={nf.format(report.current.orders)}
              hint={
                report.ordersChangePct === null
                  ? undefined
                  : `${signedPct(report.ordersChangePct)} عن الفترة السابقة`
              }
            />
            <Stat
              label="متوسط قيمة الطلب"
              value={
                report.current.avgOrderValue === null
                  ? '—'
                  : money(report.current.avgOrderValue, report.currency)
              }
            />
            <Stat
              label="المرتجعات"
              value={money(report.current.refunded, report.currency)}
              hint={
                report.current.bestDay
                  ? `أفضل يوم: ${report.current.bestDay.date} (${money(report.current.bestDay.netRevenue, report.currency)})`
                  : undefined
              }
            />
          </div>
          <p className="text-xs text-slate-500">
            الفترة من {report.current.from} إلى {report.current.to}، دون اليوم الحالي لأنه لم يكتمل.
            الأرقام <TruthBadge label={label('computed')} /> من طلباتك في سلة.
          </p>
        </>
      )}
    </section>
  );
}

function List({
  title,
  empty,
  badge,
  rows,
}: {
  title: string;
  empty: string;
  badge: TruthLabel;
  rows: Array<{ key: string; name: string; detail: string; bad?: boolean }>;
}) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-base font-bold">{title}</h3>
        <TruthBadge label={badge} />
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-slate-500">{empty}</p>
      ) : (
        <ul className="divide-y divide-slate-100 text-sm">
          {rows.map((r) => (
            <li key={r.key} className="flex items-center justify-between gap-4 py-2">
              <span className="min-w-0 truncate">{r.name}</span>
              <span
                className={`shrink-0 tabular-nums ${r.bad ? 'font-medium text-red-700' : 'text-slate-600'}`}
              >
                {r.detail}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ProductSections({ data }: { data: ProductReport }) {
  const { report: r, currency } = data;
  const stale = isStale(data.lastSyncedAt);
  const reported: TruthLabel = stale
    ? label('stale')
    : { kind: 'confirmed', icon: '✓', text: 'من سلة', hint: 'عدّاد تراكمي تقدّمه سلة لكل منتج' };

  if (r.coverage.total === 0) {
    return (
      <p className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-600">
        لا توجد منتجات بعد.
      </p>
    );
  }

  const noCounters = r.coverage.withSales === 0 && r.coverage.withViews === 0;

  return (
    <section aria-labelledby="products-report-heading" className="space-y-4">
      <h2 id="products-report-heading" className="text-base font-bold">
        المنتجات
      </h2>
      <p className="text-xs text-slate-500">
        الأرقام تراكمية منذ إضافة المنتج وليست لفترة محددة، كما تقدّمها سلة.
      </p>
      {noCounters && (
        <p className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          لم تصل بعد أعداد المبيعات والمشاهدات من سلة. تظهر بعد المزامنة التالية للمنتجات.
        </p>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        <List
          title="الأكثر مبيعًا"
          empty="لا توجد مبيعات مسجلة."
          badge={reported}
          rows={r.topSellers.map((p) => ({
            key: p.id,
            name: p.name,
            detail: `${nf.format(p.value)} وحدة`,
          }))}
        />
        <List
          title="الأكثر مشاهدة"
          empty="لا توجد مشاهدات مسجلة."
          badge={reported}
          rows={r.mostViewed.map((p) => ({
            key: p.id,
            name: p.name,
            detail: `${nf.format(p.value)} مشاهدة`,
          }))}
        />
        <List
          title="الأكثر ربحية (تقديري)"
          empty="يلزم سعر تكلفة ومبيعات مسجلة."
          badge={ESTIMATED}
          rows={r.profit.most.map((p) => ({
            key: p.id,
            name: p.name,
            detail: `${money(p.value, currency)} · ${nf.format(p.soldQuantity)} وحدة`,
          }))}
        />
        <List
          title="الأقل ربحية (تقديري)"
          empty="يلزم سعر تكلفة ومبيعات مسجلة."
          badge={ESTIMATED}
          rows={r.profit.least.map((p) => ({
            key: p.id,
            name: p.name,
            detail: money(p.value, currency),
            bad: p.value <= 0,
          }))}
        />
        <List
          title="مشاهدات كثيرة وشراء قليل"
          empty="لا توجد صفحات بهذه الحالة."
          badge={reported}
          rows={r.lowConversion.map((p) => ({
            key: p.id,
            name: p.name,
            detail: `${nf.format(p.value)} مشاهدة → ${nf.format(p.soldQuantity)} بيعت (${nf.format(p.conversionPct)}%)`,
          }))}
        />
        <List
          title={`لم تُبَع قط (${nf.format(r.neverSold.count)})`}
          empty="كل المنتجات المعروضة سُجّل لها بيع."
          badge={reported}
          rows={r.neverSold.sample.map((p) => ({ key: p.id, name: p.name, detail: '0' }))}
        />
      </div>
      {r.profit.counted < r.coverage.total && (
        <p className="text-xs text-slate-500">
          الربحية تشمل {nf.format(r.profit.counted)} من {nf.format(r.coverage.total)} منتجًا، أي ما
          له سعر تكلفة ومبيعات مسجلة.
        </p>
      )}
    </section>
  );
}
