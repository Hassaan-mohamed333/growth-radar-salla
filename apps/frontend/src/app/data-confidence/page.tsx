// Data confidence — server component. Status tabs and pagination are plain links.
// Explains how much each pricing signal can be trusted, which input is weakest, how the
// competitor scrapers are doing, and which competitors are mapped to which products.
// The animated pieces (gauge, bars, mapping filter) are small client components.

import Link from 'next/link';
import {
  api,
  settle,
  type AuditItem,
  type AuditStatus,
  type CompetitorList,
  type DataConfidence,
} from '../../lib/api';
import { formatDate, money, nf } from '../../lib/format';
import { AppShell, SignIn } from '../app-shell';
import { healthOf } from './health';
import { MappingsPanel, type MappingRow } from './mappings';
import { ScraperHealth } from './scrapers';
import { AnimatedBar, ScoreRing, StackedSplit } from './visuals';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 20;
/** One API page of competitors (the backend's maximum page size). */
const COMPETITORS_SHOWN = 100;

type Tab = 'ALL' | AuditStatus;

const tabs: Array<{ key: Tab; label: string }> = [
  { key: 'ALL', label: 'الكل' },
  { key: 'PASSED', label: 'موثوقة' },
  { key: 'WARNING', label: 'تحتاج مراجعة' },
  { key: 'FAILED', label: 'ضعيفة' },
];

const statusBadge: Record<AuditStatus, { label: string; pill: string; bar: string }> = {
  PASSED: { label: 'موثوقة', pill: 'bg-emerald-50 text-emerald-700', bar: 'bg-emerald-500' },
  WARNING: { label: 'تحتاج مراجعة', pill: 'bg-amber-50 text-amber-700', bar: 'bg-amber-500' },
  FAILED: { label: 'ضعيفة', pill: 'bg-red-50 text-red-700', bar: 'bg-red-500' },
};

/** What each check measures. Unknown names fall back to the raw identifier. */
const checkInfo: Record<string, { label: string; hint: string }> = {
  price_freshness: {
    label: 'حداثة السعر',
    hint: 'متى رُصد سعر المنافس آخر مرة. الأسعار القديمة أقل موثوقية.',
  },
  competitor_coverage: {
    label: 'تغطية المنافسين',
    hint: 'عدد المنافسين الذين تمت المقارنة بهم. مقارنة واحدة أضعف من عدة مقارنات.',
  },
  source_reliability: {
    label: 'موثوقية المصدر',
    hint: 'هل يُفحص رابط المنافس دون إخفاقات متكررة.',
  },
  cost_known: {
    label: 'معرفة التكلفة',
    hint: 'هل سعر تكلفة المنتج متوفر في سلة لحماية هامشك.',
  },
};

const entityLabel: Record<string, string> = { competitor: 'منافس', product: 'منتج' };

function first(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? '';
}

function parse(sp: Record<string, string | string[] | undefined>): { tab: Tab; page: number } {
  const status = first(sp.status);
  const page = Number.parseInt(first(sp.page), 10);
  return {
    tab: tabs.some((t) => t.key === status) ? (status as Tab) : 'ALL',
    page: Number.isInteger(page) && page >= 1 ? Math.min(page, 10_000) : 1,
  };
}

function href(tab: Tab, page = 1): string {
  const params = new URLSearchParams();
  if (tab !== 'ALL') params.set('status', tab);
  if (page > 1) params.set('page', String(page));
  const qs = params.toString();
  return qs ? `/data-confidence?${qs}` : '/data-confidence';
}

function scoreTone(score: number): string {
  if (score >= 75) return 'bg-emerald-500';
  if (score >= 50) return 'bg-amber-500';
  return 'bg-red-500';
}

function scoreWord(score: number | null): string {
  if (score === null) return 'لا توجد بيانات';
  if (score >= 75) return 'ثقة عالية';
  if (score >= 50) return 'ثقة متوسطة';
  return 'ثقة منخفضة';
}

/** Rows for the mapping table. Everything is formatted here, on the server. */
function mappingRows(list: CompetitorList, audits: AuditItem[]): MappingRow[] {
  // Audits arrive newest first, so the first one seen per competitor is its latest.
  const latest = new Map<string, number>();
  for (const a of audits) {
    if (a.entityType === 'competitor' && a.entity && !latest.has(a.entity.id)) {
      latest.set(a.entity.id, a.score);
    }
  }
  return list.items.map((c) => ({
    id: c.id,
    name: c.name,
    domain: c.domain,
    productName: c.product?.name ?? null,
    health: healthOf(c),
    price: c.lastPrice === null ? null : money(Number(c.lastPrice), c.currency),
    checked: c.lastCheckedAt ? formatDate(c.lastCheckedAt) : null,
    confidence: latest.get(c.id) ?? null,
  }));
}

export default async function DataConfidencePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { tab, page } = parse(await searchParams);
  const flags = { unauthorized: false };
  const [status, data, competitors] = await Promise.all([
    settle(api.storeStatus(), flags),
    settle(api.dataConfidence({ status: tab, page, pageSize: PAGE_SIZE }), flags),
    settle(api.competitors({ pageSize: COMPETITORS_SHOWN }), flags),
  ]);

  if (flags.unauthorized) return <SignIn />;

  return (
    <AppShell active="confidence" title="ثقة البيانات" status={status}>
      {status === null && (
        <div
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700"
        >
          تعذّر الاتصال بالخادم. تحقق من تشغيل الواجهة الخلفية ثم أعد تحميل الصفحة.
        </div>
      )}

      <p className="text-sm text-slate-600">
        قبل أن تُبنى أي توصية، تُقيَّم جودة البيانات التي اعتمدت عليها. هنا ترى مدى الاعتماد على
        أسعار منافسيك، وأي مدخلات هي الأضعف لتحسينها.
      </p>

      {data ? (
        <>
          <Summary data={data} />

          {competitors ? (
            <div className="space-y-4">
              <ScraperHealth competitors={competitors} />
              <MappingsPanel
                rows={mappingRows(competitors, data.items)}
                total={competitors.total}
              />
            </div>
          ) : (
            status !== null && (
              <p
                role="alert"
                className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800"
              >
                تعذّر تحميل حالة المنافسين. بقية البيانات معروضة أدناه.
              </p>
            )
          )}

          <nav aria-label="حالة التدقيق" className="flex flex-wrap gap-2">
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
          <AuditList data={data} tab={tab} />
        </>
      ) : (
        status !== null && (
          <p
            role="alert"
            className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-600"
          >
            تعذّر تحميل بيانات الثقة. حاول مرة أخرى بعد قليل.
          </p>
        )
      )}
    </AppShell>
  );
}

function Summary({ data }: { data: DataConfidence }) {
  const s = data.summary;

  return (
    <>
      <section
        aria-label="ملخص الثقة"
        className="grid items-center gap-6 rounded-xl border border-slate-200 bg-white p-5 sm:grid-cols-[auto_1fr]"
      >
        <div className="flex justify-center">
          <ScoreRing score={s.averageScore} caption={scoreWord(s.averageScore)} />
        </div>
        <div className="min-w-0 space-y-4">
          <div>
            <h2 className="text-base font-bold">متوسط الثقة وتوزيع التدقيقات</h2>
            <p className="mt-1 text-xs text-slate-500">
              آخر {nf.format(s.windowDays)} يومًا · {nf.format(s.auditsCount)} تدقيق
            </p>
          </div>
          <StackedSplit
            label="توزيع التدقيقات"
            segments={(['PASSED', 'WARNING', 'FAILED'] as const).map((key) => ({
              key,
              label: statusBadge[key].label,
              count: s.byStatus[key],
              bar: statusBadge[key].bar,
            }))}
          />
        </div>
      </section>

      <section aria-labelledby="checks-heading">
        <h2 id="checks-heading" className="mb-3 text-base font-bold">
          أضعف المدخلات
        </h2>
        {s.checks.length === 0 ? (
          <p className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-600">
            لا توجد تدقيقات بعد. تظهر هنا عند توليد أول توصية من أسعار منافسيك.
          </p>
        ) : (
          <ul className="space-y-3 rounded-xl border border-slate-200 bg-white p-5">
            {s.checks.map((c, i) => {
              const info = checkInfo[c.name];
              return (
                <li key={c.name}>
                  <div className="flex items-baseline justify-between gap-4 text-sm">
                    <span className="font-medium">{info?.label ?? c.name}</span>
                    <span className="tabular-nums text-slate-600">
                      {nf.format(c.averageScore)}% · {nf.format(c.count)} تدقيق
                    </span>
                  </div>
                  <div
                    aria-hidden
                    className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-100"
                  >
                    <AnimatedBar
                      value={c.averageScore}
                      className={scoreTone(c.averageScore)}
                      delayMs={i * 80}
                    />
                  </div>
                  {info && <p className="mt-1 text-xs text-slate-500">{info.hint}</p>}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </>
  );
}

function AuditList({ data, tab }: { data: DataConfidence; tab: Tab }) {
  if (data.items.length === 0) {
    return (
      <p className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-600">
        {tab === 'ALL' ? 'لا توجد تدقيقات بعد.' : 'لا توجد تدقيقات في هذه الحالة.'}
      </p>
    );
  }

  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));

  return (
    <section aria-label="سجل التدقيقات" className="space-y-3">
      <ul className="space-y-3">
        {data.items.map((a) => (
          <AuditCard key={a.id} audit={a} />
        ))}
      </ul>

      {pages > 1 && (
        <nav aria-label="التنقل بين الصفحات" className="flex items-center justify-between text-sm">
          <p className="text-slate-500">
            صفحة {nf.format(data.page)} من {nf.format(pages)} · {nf.format(data.total)} تدقيق
          </p>
          <div className="flex gap-2">
            {data.page > 1 && (
              <Link
                href={href(tab, data.page - 1)}
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 hover:bg-slate-50"
              >
                السابق
              </Link>
            )}
            {data.page < pages && (
              <Link
                href={href(tab, data.page + 1)}
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

function AuditCard({ audit: a }: { audit: AuditItem }) {
  const badge = statusBadge[a.status];

  return (
    <li className="rounded-xl border border-slate-200 bg-white p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs text-slate-500">{entityLabel[a.entityType] ?? a.entityType}</p>
          <p className="mt-1 truncate font-medium">
            {a.entity ? a.entity.name : 'عنصر غير متاح (حُذف)'}
          </p>
          {a.entity?.domain && (
            <p className="truncate text-xs text-slate-500" dir="ltr">
              {a.entity.domain}
            </p>
          )}
        </div>
        <div className="shrink-0 text-end">
          <span className={`rounded-full px-3 py-1 text-xs font-medium ${badge.pill}`}>
            {badge.label} · {nf.format(a.score)}%
          </span>
          <p className="mt-2 text-xs text-slate-500">{formatDate(a.createdAt)}</p>
        </div>
      </div>

      {a.checks.length > 0 && (
        <ul className="mt-4 flex flex-wrap gap-2 border-t border-slate-100 pt-4 text-xs">
          {a.checks.map((c) => (
            <li
              key={c.name}
              className="inline-flex items-center gap-2 rounded-full bg-slate-50 px-3 py-1"
            >
              <span aria-hidden className={`h-2 w-2 rounded-full ${scoreTone(c.score)}`} />
              <span>{checkInfo[c.name]?.label ?? c.name}</span>
              <span className="tabular-nums text-slate-500">{nf.format(c.score)}%</span>
            </li>
          ))}
        </ul>
      )}

      {a.recommendation && (
        <p className="mt-3 text-xs text-slate-500">
          غذّت التوصية:{' '}
          <Link href="/recommendations" className="font-medium text-brand-dark">
            {a.recommendation.title}
          </Link>
        </p>
      )}
    </li>
  );
}
