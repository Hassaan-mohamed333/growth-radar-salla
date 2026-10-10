// Competitors — server component. Search is a plain GET form and pagination is plain
// links; only the add form and per-row actions are client components.

import Link from 'next/link';
import {
  api,
  settle,
  type CompetitorItem,
  type CompetitorList,
  type ScrapeFailureKind,
} from '../../lib/api';
import { formatDate, money, nf } from '../../lib/format';
import { AppShell, SignIn } from '../app-shell';
import { AddCompetitorForm } from './add-competitor-form';
import { CompetitorActions } from './competitor-actions';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 25;

const failureLabel: Record<ScrapeFailureKind, string> = {
  invalid_url: 'رابط غير صالح',
  forbidden_target: 'الرابط غير مسموح به',
  network: 'تعذّر الاتصال بالموقع',
  blocked: 'الموقع يمنع الفحص الآلي — سجّل السعر يدويًا',
  http_error: 'استجابة خاطئة من الموقع',
  not_html: 'الرابط ليس صفحة ويب',
  too_large: 'الصفحة كبيرة جدًا',
  parse_failed: 'لم يُعثر على السعر في الصفحة',
  currency_mismatch: 'عملة السعر مختلفة عن عملة المنتج',
};

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
  return qs ? `/competitors?${qs}` : '/competitors';
}

export default async function CompetitorsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const filters = parseFilters(await searchParams);
  const flags = { unauthorized: false };
  const [status, list] = await Promise.all([
    settle(api.storeStatus(), flags),
    settle(
      api.competitors({
        page: filters.page,
        pageSize: PAGE_SIZE,
        search: filters.search || undefined,
      }),
      flags,
    ),
  ]);

  if (flags.unauthorized) return <SignIn />;

  return (
    <AppShell active="competitors" title="المنافسون" status={status}>
      {status === null && (
        <div
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700"
        >
          تعذّر الاتصال بالخادم. تحقق من تشغيل الواجهة الخلفية ثم أعد تحميل الصفحة.
        </div>
      )}

      <p className="text-sm text-slate-600">
        اربط صفحة المنتج عند منافسك بمنتج من متجرك لتتم مقارنة السعر وتوليد التوصيات. يُفحص الرابط
        تلقائيًا عند تفعيل الفحص الآلي، ويمكنك دائمًا تسجيل السعر يدويًا.
      </p>

      <AddCompetitorForm />

      <form
        method="get"
        action="/competitors"
        role="search"
        className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4"
      >
        <label className="min-w-0 flex-1 text-sm">
          <span className="mb-1 block text-slate-500">بحث بالاسم أو النطاق</span>
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
          className="rounded-lg bg-radar-600 px-5 py-2 text-sm font-medium text-white"
        >
          بحث
        </button>
      </form>

      {list ? (
        <CompetitorTable list={list} filters={filters} />
      ) : (
        status !== null && (
          <p className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-600">
            تعذّر تحميل المنافسين. حاول مرة أخرى بعد قليل.
          </p>
        )
      )}
    </AppShell>
  );
}

function CompetitorTable({ list, filters }: { list: CompetitorList; filters: Filters }) {
  if (list.items.length === 0) {
    return (
      <p className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-600">
        {filters.search
          ? 'لا يوجد منافسون يطابقون البحث.'
          : 'لم تُضف أي منافس بعد. ابدأ بإضافة رابط منتج من موقع منافس أعلاه.'}
      </p>
    );
  }

  const pages = Math.max(1, Math.ceil(list.total / list.pageSize));
  const from = (list.page - 1) * list.pageSize + 1;
  const to = from + list.items.length - 1;

  return (
    <section aria-labelledby="competitors-heading">
      <h2 id="competitors-heading" className="sr-only">
        قائمة المنافسين
      </h2>
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full min-w-[48rem] text-sm">
          <thead className="border-b border-slate-200 text-slate-500">
            <tr>
              {['المنافس', 'المنتج المقابل', 'آخر سعر', 'الحالة', 'إجراءات'].map((h) => (
                <th key={h} scope="col" className="px-4 py-3 text-start font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {list.items.map((c) => (
              <CompetitorRow key={c.id} c={c} />
            ))}
          </tbody>
        </table>
      </div>

      <nav aria-label="التنقل بين الصفحات" className="mt-4 flex items-center justify-between text-sm">
        <p className="text-slate-500">
          {nf.format(from)}–{nf.format(to)} من {nf.format(list.total)}
        </p>
        <div className="flex gap-2">
          {list.page > 1 && (
            <Link
              href={href(filters, list.page - 1)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 hover:bg-slate-50"
            >
              السابق
            </Link>
          )}
          {list.page < pages && (
            <Link
              href={href(filters, list.page + 1)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 hover:bg-slate-50"
            >
              التالي
            </Link>
          )}
        </div>
      </nav>
    </section>
  );
}

function CompetitorRow({ c }: { c: CompetitorItem }) {
  return (
    <tr className={c.isActive ? undefined : 'bg-slate-50 text-slate-500'}>
      <td className="max-w-xs px-4 py-3">
        <p className="truncate font-medium">{c.name}</p>
        <p className="truncate text-xs text-slate-500" dir="ltr">
          {c.domain}
        </p>
      </td>
      <td className="max-w-xs px-4 py-3">
        {c.product ? (
          <span className="block truncate">{c.product.name}</span>
        ) : (
          <span className="text-slate-400">غير مرتبط</span>
        )}
      </td>
      <td className="px-4 py-3 tabular-nums">
        {c.lastPrice === null ? (
          <span className="text-slate-400">—</span>
        ) : (
          <>
            <span className="font-medium">{money(Number(c.lastPrice), c.currency)}</span>
            <span className="block text-xs text-slate-500">{formatDate(c.lastCheckedAt)}</span>
          </>
        )}
      </td>
      <td className="px-4 py-3">
        <StatusCell c={c} />
      </td>
      <td className="px-4 py-3">
        <CompetitorActions id={c.id} isActive={c.isActive} />
      </td>
    </tr>
  );
}

function StatusCell({ c }: { c: CompetitorItem }) {
  if (!c.isActive) {
    return <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium">متوقف</span>;
  }
  if (c.lastScrapeError) {
    return (
      <div>
        <span className="rounded-full bg-red-50 px-2.5 py-1 text-xs font-medium text-red-700">
          خطأ في الفحص
        </span>
        <p className="mt-1 text-xs text-slate-600">
          {failureLabel[c.lastScrapeError] ?? 'تعذّر الفحص'}
          {c.scrapeFailures > 1 && <> · {nf.format(c.scrapeFailures)} محاولات</>}
        </p>
      </div>
    );
  }
  if (c.productUrl === null) {
    return (
      <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700">
        إدخال يدوي
      </span>
    );
  }
  return (
    <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">
      نشط
    </span>
  );
}
