// Recommendations — server component. The status tabs are plain links and
// pagination is plain links; only the accept/dismiss buttons are client-side.

import Link from 'next/link';
import {
  api,
  settle,
  type RecommendationItem,
  type RecommendationList,
} from '../../lib/api';
import { formatDate, money, nf, signedPct } from '../../lib/format';
import { AppShell, SignIn } from '../app-shell';
import { DecisionButtons, PendingRecommendation } from './decision-buttons';
import { ExportCsvButton } from './export-csv-button';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 20;

const tabs = [
  { key: 'PENDING', label: 'معلّقة' },
  { key: 'ACCEPTED', label: 'مقبولة' },
  { key: 'DISMISSED', label: 'متجاهَلة' },
] as const;

type Tab = (typeof tabs)[number]['key'];

const statusLabel: Record<RecommendationItem['status'], string> = {
  PENDING: 'معلّقة',
  ACCEPTED: 'مقبولة',
  DISMISSED: 'متجاهَلة',
  EXPIRED: 'منتهية',
  APPLIED: 'طُبّقت',
};

const typeLabel: Record<string, string> = {
  PRICE_ADJUSTMENT: 'تعديل سعر',
  COMPETITOR_ALERT: 'تنبيه منافس',
  RESTOCK: 'إعادة تخزين',
  PROMOTION: 'عرض ترويجي',
  LISTING_IMPROVEMENT: 'تحسين المنتج',
};

function first(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? '';
}

function parse(sp: Record<string, string | string[] | undefined>): { tab: Tab; page: number } {
  const status = first(sp.status);
  const page = Number.parseInt(first(sp.page), 10);
  return {
    tab: tabs.some((t) => t.key === status) ? (status as Tab) : 'PENDING',
    page: Number.isInteger(page) && page >= 1 ? Math.min(page, 10_000) : 1,
  };
}

function href(tab: Tab, page = 1): string {
  const params = new URLSearchParams();
  if (tab !== 'PENDING') params.set('status', tab);
  if (page > 1) params.set('page', String(page));
  const qs = params.toString();
  return qs ? `/recommendations?${qs}` : '/recommendations';
}

function confidenceLabel(c: number | null): string {
  if (c === null) return 'غير مقيَّمة';
  if (c >= 80) return `ثقة عالية · ${nf.format(c)}%`;
  if (c >= 50) return `ثقة متوسطة · ${nf.format(c)}%`;
  return `ثقة منخفضة · ${nf.format(c)}%`;
}

export default async function RecommendationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { tab, page } = parse(await searchParams);
  const flags = { unauthorized: false };
  const [status, list, blockers, pendingElsewhere] = await Promise.all([
    settle(api.storeStatus(), flags),
    settle(api.recommendations({ status: tab, page, pageSize: PAGE_SIZE }), flags),
    settle(api.recommendationBlockers(), flags),
    // On the pending tab the list itself is the pending count; elsewhere one cheap row-count call.
    tab === 'PENDING'
      ? Promise.resolve(null)
      : settle(api.recommendations({ status: 'PENDING', pageSize: 1 }), flags),
  ]);

  if (flags.unauthorized) return <SignIn />;

  const pendingCount = pendingElsewhere?.total ?? 0;
  const hasBlockers =
    blockers !== null && (blockers.productsWithoutCost > 0 || blockers.failingCompetitorsCount > 0);

  return (
    <AppShell active="recommendations" title="التوصيات" status={status}>
      {status === null && (
        <div
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700"
        >
          تعذّر الاتصال بالخادم. تحقق من تشغيل الواجهة الخلفية ثم أعد تحميل الصفحة.
        </div>
      )}

      <p className="text-sm text-slate-600">
        تُبنى التوصيات من أسعار منافسيك الحديثة، ولا يُقترح سعر إلا إذا كانت تكلفة المنتج معروفة
        ويحفظ هامشك. لا يُغيَّر أي سعر في سلة تلقائيًا.
      </p>

      <div className="flex justify-end">
        <ExportCsvButton status={tab} total={list?.total ?? 0} />
      </div>

      {(hasBlockers || pendingCount > 0) && blockers !== null && (
        <section
          aria-labelledby="blockers-heading"
          className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800"
        >
          <h2 id="blockers-heading" className="font-bold">
            مشكلات تمنع توصيات دقيقة
          </h2>
          <ul className="mt-2 list-disc space-y-1 ps-5">
            {pendingCount > 0 && (
              <li>
                {nf.format(pendingCount)} توصية معلّقة بانتظار قرارك.{' '}
                <Link href="/recommendations" className="font-medium underline">
                  عرض المعلّقة
                </Link>
              </li>
            )}
            {blockers.productsWithoutCost > 0 && (
              <li>
                {nf.format(blockers.productsWithoutCost)} منتجًا بدون تكلفة، ولا يُقترح لها سعر لأن
                الهامش الآمن لا يُحسب بدون تكلفة.
              </li>
            )}
            {blockers.failingCompetitorsCount > 0 && (
              <li>
                {nf.format(blockers.failingCompetitorsCount)} منافسًا فشل آخر فحص لهم
                {blockers.failingCompetitors.length > 0 &&
                  `: ${blockers.failingCompetitors.map((c) => c.name).join('، ')}`}
                .{' '}
                <Link href="/competitors" className="font-medium underline">
                  مراجعة المنافسين
                </Link>
              </li>
            )}
          </ul>
        </section>
      )}

      <nav aria-label="حالة التوصيات" className="flex gap-2">
        {tabs.map((t) => (
          <Link
            key={t.key}
            href={href(t.key)}
            aria-current={t.key === tab ? 'page' : undefined}
            className={`rounded-full px-4 py-1.5 text-sm font-medium ${
              t.key === tab
                ? 'bg-brand-lightest text-brand-darkest'
                : 'bg-white text-slate-600 hover:bg-slate-100'
            }`}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {list ? (
        <RecommendationCards list={list} tab={tab} />
      ) : (
        status !== null && (
          <p className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-600">
            تعذّر تحميل التوصيات. حاول مرة أخرى بعد قليل.
          </p>
        )
      )}
    </AppShell>
  );
}

function RecommendationCards({ list, tab }: { list: RecommendationList; tab: Tab }) {
  if (list.items.length === 0) {
    return (
      <p className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-600">
        {tab === 'PENDING'
          ? 'لا توجد توصيات معلّقة. ستظهر هنا عندما يصبح أحد منافسيك أرخص منك على منتج تراقبه.'
          : 'لا توجد توصيات في هذه الحالة.'}
      </p>
    );
  }

  const pages = Math.max(1, Math.ceil(list.total / list.pageSize));

  return (
    <section aria-label="قائمة التوصيات" className="space-y-3">
      <ul className="space-y-3">
        {list.items.map((rec) => (
          <RecommendationCard key={rec.id} rec={rec} />
        ))}
      </ul>

      {pages > 1 && (
        <nav aria-label="التنقل بين الصفحات" className="flex items-center justify-between text-sm">
          <p className="text-slate-500">
            صفحة {nf.format(list.page)} من {nf.format(pages)} · {nf.format(list.total)} توصية
          </p>
          <div className="flex gap-2">
            {list.page > 1 && (
              <Link
                href={href(tab, list.page - 1)}
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 hover:bg-slate-50"
              >
                السابق
              </Link>
            )}
            {list.page < pages && (
              <Link
                href={href(tab, list.page + 1)}
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 hover:bg-slate-50"
              >
                التالي
              </Link>
            )}
          </div>
        </nav>
      )}
    </section>
  );
}

function RecommendationCard({ rec }: { rec: RecommendationItem }) {
  const d = rec.details;
  const cardClass = 'rounded-xl border border-slate-200 bg-white p-5';

  const body = (
    <>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs text-slate-500">
            {typeLabel[rec.type] ?? rec.type}
            {rec.status !== 'PENDING' && <> · {statusLabel[rec.status]}</>}
          </p>
          <p className="mt-1 font-medium">{rec.title}</p>
          <p className="mt-1 text-sm text-slate-600">{rec.rationale}</p>
        </div>
        <span className="shrink-0 rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-700">
          {confidenceLabel(rec.confidence)}
        </span>
      </div>

      {d && (
        <dl className="mt-4 grid gap-4 border-t border-slate-100 pt-4 text-sm sm:grid-cols-2 xl:grid-cols-4">
          <Fact label="سعرك الحالي" value={money(d.currentPrice, d.currency)} />
          <Fact
            label={`أقل منافس · ${d.competitorName}`}
            value={`${money(d.lowestPrice, d.currency)} (${signedPct(-d.gapPct)})`}
          />
          {d.suggestedPrice !== null ? (
            <Fact
              label="السعر المقترح"
              value={`${money(d.suggestedPrice, d.currency)}${
                d.suggestedMarginPct !== null ? ` · هامش ${nf.format(d.suggestedMarginPct)}%` : ''
              }`}
              strong
            />
          ) : (
            <Fact
              label="السعر المقترح"
              value={d.kind === 'alert_no_cost' ? 'أضف التكلفة في سلة' : 'غير متاح ضمن الهامش'}
            />
          )}
          <Fact
            label="منافسون تمت مقارنتهم"
            value={nf.format(d.competitorsCompared)}
          />
        </dl>
      )}

      <div className="mt-4 flex items-center justify-between gap-4">
        <p className="text-xs text-slate-500">
          {rec.product && <>{rec.product.name} · </>}
          {rec.status === 'PENDING'
            ? `صالحة حتى ${formatDate(rec.expiresAt)}`
            : `قرار بتاريخ ${formatDate(rec.decidedAt)}`}
        </p>
        {rec.status === 'PENDING' && <DecisionButtons />}
      </div>
    </>
  );

  // Pending cards are client-side so a decision shows at once; decided ones are static.
  return rec.status === 'PENDING' ? (
    <PendingRecommendation id={rec.id} className={cardClass}>
      {body}
    </PendingRecommendation>
  ) : (
    <li className={cardClass}>{body}</li>
  );
}

function Fact({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-slate-500">{label}</dt>
      <dd className={`mt-1 break-words tabular-nums ${strong ? 'font-bold text-brand-dark' : 'font-medium'}`}>
        {value}
      </dd>
    </div>
  );
}
