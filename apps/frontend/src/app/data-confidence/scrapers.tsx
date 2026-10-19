// Scraper status and competitor responsiveness. Server component: it only reads the competitor
// list the API already exposes and hands numbers to the animated client visuals.

import type { CompetitorList, ScrapeFailureKind } from '../../lib/api';
import { formatDate, nf } from '../../lib/format';
import { failureLabel } from '../../lib/labels';
import { healthMeta, healthOf, type Health } from './health';
import { AnimatedBar, StackedSplit } from './visuals';

const DAY_MS = 24 * 60 * 60 * 1000;
const WORST_SHOWN = 5;

export function ScraperHealth({ competitors }: { competitors: CompetitorList }) {
  const items = competitors.items;

  if (items.length === 0) {
    return (
      <section aria-labelledby="scrapers-heading" className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 id="scrapers-heading" className="text-base font-bold">
          حالة الفحص واستجابة المنافسين
        </h2>
        <p className="mt-3 text-sm text-slate-600">
          لم تُضف منافسين بعد. أضف رابط منتج من موقع منافس ليظهر هنا حال فحصه.
        </p>
      </section>
    );
  }

  const counts: Record<Health, number> = { healthy: 0, failing: 0, manual: 0, waiting: 0, paused: 0 };
  const failures = new Map<ScrapeFailureKind, number>();
  for (const c of items) {
    counts[healthOf(c)] += 1;
    if (c.isActive && c.lastScrapeError) {
      failures.set(c.lastScrapeError, (failures.get(c.lastScrapeError) ?? 0) + 1);
    }
  }

  // Listings the scraper is expected to fetch: active, with a URL.
  const now = Date.now();
  const scraped = items.filter((c) => c.isActive && c.productUrl !== null);
  const fresh = scraped.filter(
    (c) => c.lastCheckedAt !== null && now - new Date(c.lastCheckedAt).getTime() <= DAY_MS,
  );

  const failureRows = [...failures.entries()].sort((a, b) => b[1] - a[1]);
  const worst = items
    .filter((c) => c.isActive && c.lastScrapeError)
    .sort((a, b) => b.scrapeFailures - a.scrapeFailures)
    .slice(0, WORST_SHOWN);

  return (
    <section
      aria-labelledby="scrapers-heading"
      className="space-y-5 rounded-xl border border-slate-200 bg-white p-5"
    >
      <div>
        <h2 id="scrapers-heading" className="text-base font-bold">
          حالة الفحص واستجابة المنافسين
        </h2>
        <p className="mt-1 text-xs text-slate-500">
          مبنية على آخر فحص لكل منافس
          {competitors.total > items.length &&
            ` (أول ${nf.format(items.length)} من ${nf.format(competitors.total)})`}
          .
        </p>
      </div>

      <StackedSplit
        label="حالة المنافسين"
        segments={(Object.keys(healthMeta) as Health[]).map((key) => ({
          key,
          label: healthMeta[key].label,
          count: counts[key],
          bar: healthMeta[key].bar,
        }))}
      />

      {scraped.length > 0 && (
        <div>
          <div className="flex items-baseline justify-between gap-4 text-sm">
            <span className="font-medium">حداثة الفحص الآلي</span>
            <span className="tabular-nums text-slate-600">
              {nf.format(fresh.length)} من {nf.format(scraped.length)} فُحصت خلال ٢٤ ساعة
            </span>
          </div>
          <div aria-hidden className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-100">
            <AnimatedBar
              value={(fresh.length / scraped.length) * 100}
              className={fresh.length === scraped.length ? 'bg-emerald-500' : 'bg-amber-500'}
            />
          </div>
        </div>
      )}

      {failureRows.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-medium">أسباب الإخفاق</h3>
          <ul className="space-y-2">
            {failureRows.map(([kind, count], i) => (
              <li key={kind}>
                <div className="flex items-baseline justify-between gap-4 text-xs">
                  <span className="text-slate-700">{failureLabel[kind] ?? kind}</span>
                  <span className="tabular-nums text-slate-500">{nf.format(count)}</span>
                </div>
                <div aria-hidden className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
                  <AnimatedBar
                    value={(count / failureRows[0]![1]) * 100}
                    className="bg-red-400"
                    delayMs={i * 80}
                  />
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {worst.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-medium">الأكثر تعثرًا</h3>
          <ul className="divide-y divide-slate-100 text-sm">
            {worst.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <div className="min-w-0">
                  <p className="truncate font-medium">{c.name}</p>
                  <p className="truncate text-xs text-slate-500" dir="ltr">
                    {c.domain}
                  </p>
                </div>
                <div className="text-end text-xs text-slate-600">
                  <p>{c.lastScrapeError ? failureLabel[c.lastScrapeError] : ''}</p>
                  <p className="text-slate-500">
                    {nf.format(c.scrapeFailures)} محاولات · آخر فحص {formatDate(c.lastCheckedAt)}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
