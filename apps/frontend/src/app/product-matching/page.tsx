// Product comparison — server component. For each of the store's products it shows the matching
// products found in competitors' stores, the price gap, and suggestions waiting for a decision.
// Search is a plain GET form and pagination is plain links; only the search button and the
// confirm/reject buttons are client components.

import Link from 'next/link';
import {
  api,
  settle,
  type MatchedListing,
  type MatchedProduct,
  type MatchingOverview,
  type MatchSuggestion,
} from '../../lib/api';
import { formatDate, money, nf, signedPct } from '../../lib/format';
import { failureLabel } from '../../lib/labels';
import { AppShell, SignIn } from '../app-shell';
import { SearchButton } from './search-button';
import { SuggestionActions } from './suggestion-actions';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 10;

interface Filters {
  page: number;
  search: string;
}

function first(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? '';
}

function parseFilters(sp: Record<string, string | string[] | undefined>): Filters {
  const page = Number.parseInt(first(sp.page), 10);
  return {
    page: Number.isInteger(page) && page >= 1 ? Math.min(page, 10_000) : 1,
    search: first(sp.search).trim().slice(0, 100),
  };
}

function href(f: Filters, page: number): string {
  const params = new URLSearchParams();
  if (f.search) params.set('search', f.search);
  if (page > 1) params.set('page', String(page));
  const qs = params.toString();
  return qs ? `/product-matching?${qs}` : '/product-matching';
}

/** Competitor pages are third-party links: only plain http(s) is ever rendered as a link. */
const safeHref = (url: string) => (/^https?:\/\//i.test(url) ? url : undefined);

export default async function ProductMatchingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const filters = parseFilters(await searchParams);
  const flags = { unauthorized: false };
  const [status, overview] = await Promise.all([
    settle(api.storeStatus(), flags),
    settle(
      api.productMatching({ page: filters.page, pageSize: PAGE_SIZE, search: filters.search || undefined }),
      flags,
    ),
  ]);

  if (flags.unauthorized) return <SignIn />;

  return (
    <AppShell active="matching" title="مقارنة المنتجات" status={status}>
      {status === null && (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          تعذّر الاتصال بالخادم. تحقق من تشغيل الواجهة الخلفية ثم أعد تحميل الصفحة.
        </div>
      )}

      <p className="text-sm text-slate-600">
        نبحث عن منتجات مشابهة لمنتجاتك في متاجر المنافسين الذين تتابعهم، ونقارن الأسعار. التطابق القوي
        في الاسم والحجم يُربط تلقائيًا، والأضعف يُعرض عليك لتؤكده. يمكنك دائمًا ربط صفحة منتج يدويًا من{' '}
        <Link href="/competitors" className="font-medium text-brand-dark underline">
          صفحة المنافسين
        </Link>
        .
      </p>

      {overview === null ? (
        status !== null && (
          <p role="alert" className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-600">
            تعذّر تحميل المقارنة. حاول مرة أخرى بعد قليل.
          </p>
        )
      ) : (
        <Content overview={overview} filters={filters} />
      )}
    </AppShell>
  );
}

function Content({ overview, filters }: { overview: MatchingOverview; filters: Filters }) {
  const pages = Math.max(1, Math.ceil(overview.total / overview.pageSize));
  const from = (overview.page - 1) * overview.pageSize + 1;
  const to = from + overview.items.length - 1;

  return (
    <>
      <dl className="grid gap-4 sm:grid-cols-3">
        <Stat label="منتجاتك" value={overview.summary.products} />
        <Stat label="منتجات لها مطابق عند منافس" value={overview.summary.matched} />
        <Stat label="اقتراحات بانتظار قرارك" value={overview.summary.pendingSuggestions} />
      </dl>

      {!overview.scraperEnabled && (
        <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          جلب أسعار المنافسين متوقف على الخادم، فالبحث التلقائي غير متاح الآن. المنافسون المربوطون يدويًا
          يعملون كالمعتاد.
        </p>
      )}

      <form
        method="get"
        action="/product-matching"
        role="search"
        className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4"
      >
        <label className="min-w-0 flex-1 text-sm">
          <span className="mb-1 block text-slate-500">بحث باسم المنتج</span>
          <input
            type="search"
            name="search"
            defaultValue={filters.search}
            maxLength={100}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </label>
        <button
          type="submit"
          className="rounded-lg bg-brand-dark px-5 py-2 text-sm font-medium text-white hover:bg-brand-darkest"
        >
          بحث
        </button>
      </form>

      {overview.items.length === 0 ? (
        <p className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-600">
          {filters.search
            ? 'لا توجد منتجات تطابق البحث.'
            : 'لا توجد منتجات في متجرك بعد. تظهر هنا بعد مزامنتها من سلة.'}
        </p>
      ) : (
        <>
          <ul className="space-y-4">
            {overview.items.map((p) => (
              <ProductCard key={p.id} p={p} searchDisabled={!overview.scraperEnabled} />
            ))}
          </ul>

          <nav aria-label="التنقل بين الصفحات" className="flex items-center justify-between text-sm">
            <p className="text-slate-500">
              {nf.format(from)}–{nf.format(to)} من {nf.format(overview.total)}
            </p>
            <div className="flex gap-2">
              {overview.page > 1 && (
                <Link
                  href={href(filters, overview.page - 1)}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 hover:bg-slate-50"
                >
                  السابق
                </Link>
              )}
              {overview.page < pages && (
                <Link
                  href={href(filters, overview.page + 1)}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 hover:bg-slate-50"
                >
                  التالي
                </Link>
              )}
            </div>
          </nav>
        </>
      )}
    </>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <dt className="text-sm text-slate-500">{label}</dt>
      <dd className="mt-1 text-2xl font-bold tabular-nums">{nf.format(value)}</dd>
    </div>
  );
}

function ProductCard({ p, searchDisabled }: { p: MatchedProduct; searchDisabled: boolean }) {
  const ours = Number(p.ourPrice);

  return (
    <li className="rounded-xl border border-slate-200 bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="truncate font-bold">{p.name}</h3>
          <p className="mt-1 text-sm text-slate-600">
            سعرك: <span className="font-medium tabular-nums">{money(ours, p.currency)}</span>
            {p.lowestCompetitorPrice !== null && (
              <>
                {' '}
                · أقل سعر عند المنافسين:{' '}
                <span className="font-medium tabular-nums">{money(Number(p.lowestCompetitorPrice), p.currency)}</span>
              </>
            )}
          </p>
          <GapBadge gapPct={p.gapPct} />
        </div>
        <SearchButton productId={p.id} disabled={searchDisabled} />
      </div>

      {p.listings.length > 0 ? (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[34rem] text-sm">
            <thead className="border-b border-slate-200 text-slate-500">
              <tr>
                {['المنافس', 'سعره', 'الفرق عن سعرك', 'آخر فحص'].map((h) => (
                  <th key={h} scope="col" className="px-3 py-2 text-start font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {p.listings.map((l) => (
                <ListingRow key={l.id} l={l} ours={ours} currency={p.currency} />
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="mt-4 text-sm text-slate-500">لم يُربط أي منافس بهذا المنتج بعد.</p>
      )}

      {p.suggestions.length > 0 && (
        <div className="mt-4 space-y-3 border-t border-slate-100 pt-4">
          <h4 className="text-sm font-bold">اقتراحات بانتظار تأكيدك</h4>
          <ul className="space-y-3">
            {p.suggestions.map((s) => (
              <SuggestionRow key={s.id} s={s} />
            ))}
          </ul>
        </div>
      )}
    </li>
  );
}

function GapBadge({ gapPct }: { gapPct: number | null }) {
  if (gapPct === null) return null;
  const cheaper = gapPct <= 0;
  return (
    <p
      className={`mt-2 inline-block rounded-full px-3 py-1 text-xs font-medium ${
        cheaper ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'
      }`}
    >
      {gapPct === 0
        ? 'سعرك يساوي أقل سعر عند المنافسين'
        : cheaper
          ? `سعرك أقل من أرخص منافس: ${signedPct(gapPct)}`
          : `سعرك أعلى من أرخص منافس: ${signedPct(gapPct)}`}
    </p>
  );
}

function ListingRow({ l, ours, currency }: { l: MatchedListing; ours: number; currency: string }) {
  const price = l.lastPrice === null ? null : Number(l.lastPrice);
  const diff = price !== null && ours > 0 ? Math.round(((price - ours) / ours) * 1000) / 10 : null;
  const link = safeHref(l.productUrl);

  return (
    <tr>
      <td className="max-w-xs px-3 py-2">
        <p className="truncate font-medium">{l.name}</p>
        {link ? (
          <a
            href={link}
            target="_blank"
            rel="noopener noreferrer"
            className="block truncate text-xs text-brand-dark underline"
            dir="ltr"
          >
            {l.domain}
          </a>
        ) : (
          <span className="block truncate text-xs text-slate-500" dir="ltr">
            {l.domain}
          </span>
        )}
      </td>
      <td className="px-3 py-2 tabular-nums">{price === null ? '—' : money(price, currency)}</td>
      <td className="px-3 py-2 tabular-nums">
        {diff === null ? (
          '—'
        ) : (
          // Their price relative to ours: below ours means they undercut us.
          <span className={diff < 0 ? 'font-medium text-red-700' : diff > 0 ? 'text-emerald-700' : ''}>
            {signedPct(diff)}
          </span>
        )}
      </td>
      <td className="px-3 py-2 text-xs text-slate-500">
        {l.lastScrapeError ? (
          <span className="text-amber-700">
            {failureLabel[l.lastScrapeError as keyof typeof failureLabel] ?? 'فشل آخر فحص'}
          </span>
        ) : (
          formatDate(l.lastCheckedAt)
        )}
      </td>
    </tr>
  );
}

function SuggestionRow({ s }: { s: MatchSuggestion }) {
  const link = safeHref(s.candidateUrl);

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-slate-50 p-3">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{s.candidateTitle}</p>
        <p className="mt-1 text-xs text-slate-600">
          <span dir="ltr">{s.domain}</span>
          {s.candidatePrice !== null && (
            <>
              {' '}
              · السعر: <span className="tabular-nums">{money(Number(s.candidatePrice), s.currency)}</span>
            </>
          )}{' '}
          · نسبة التشابه: <span className="tabular-nums">{nf.format(s.score)}٪</span>
          {link && (
            <>
              {' '}
              ·{' '}
              <a href={link} target="_blank" rel="noopener noreferrer" className="text-brand-dark underline">
                افتح الصفحة
              </a>
            </>
          )}
        </p>
      </div>
      <SuggestionActions matchId={s.id} domain={s.domain} />
    </li>
  );
}
