// Products — server component. Filters are a plain GET form and pagination is plain links,
// so the page works without client JS and every state is shareable by URL.

import Link from 'next/link';
import { SALLA_LOGIN_URL, api, settle, type ProductItem, type ProductList } from '../../lib/api';
import { money, nf } from '../../lib/format';
import { AppShell, SignIn } from '../app-shell';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 25;

const statusBadge: Record<ProductItem['status'], { label: string; pill: string }> = {
  SALE: { label: 'متاح', pill: 'bg-emerald-50 text-emerald-700' },
  OUT: { label: 'نفد', pill: 'bg-amber-50 text-amber-700' },
  HIDDEN: { label: 'مخفي', pill: 'bg-slate-100 text-slate-600' },
  DELETED: { label: 'محذوف', pill: 'bg-red-50 text-red-700' },
};

type Monitored = 'all' | 'true' | 'false';

interface Filters {
  page: number;
  search: string;
  monitored: Monitored;
}

function first(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? '';
}

function parseFilters(sp: Record<string, string | string[] | undefined>): Filters {
  const page = Number.parseInt(first(sp.page), 10);
  const monitored = first(sp.monitored);
  return {
    page: Number.isInteger(page) && page >= 1 ? Math.min(page, 10_000) : 1,
    search: first(sp.search).trim().slice(0, 100),
    monitored: monitored === 'true' || monitored === 'false' ? monitored : 'all',
  };
}

function href(f: Filters, page: number): string {
  const params = new URLSearchParams();
  if (f.search) params.set('search', f.search);
  if (f.monitored !== 'all') params.set('monitored', f.monitored);
  if (page > 1) params.set('page', String(page));
  const qs = params.toString();
  return qs ? `/products?${qs}` : '/products';
}

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const filters = parseFilters(await searchParams);
  const flags = { unauthorized: false };
  const [status, list] = await Promise.all([
    settle(api.storeStatus(), flags),
    settle(
      api.products({
        page: filters.page,
        pageSize: PAGE_SIZE,
        search: filters.search || undefined,
        monitored: filters.monitored === 'all' ? undefined : filters.monitored === 'true',
      }),
      flags,
    ),
  ]);

  if (flags.unauthorized) return <SignIn />;

  const missingScope =
    status?.connection !== null &&
    status?.connection !== undefined &&
    !status.connection.scopes.includes('products.read');

  return (
    <AppShell active="products" title="المنتجات" status={status}>
      {status === null && (
        <div
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700"
        >
          تعذّر الاتصال بالخادم. تحقق من تشغيل الواجهة الخلفية ثم أعد تحميل الصفحة.
        </div>
      )}

      {missingScope && (
        <div
          role="status"
          className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800"
        >
          لم تُمنح صلاحية قراءة المنتجات بعد، لذلك لا يمكن مزامنة الكتالوج.{' '}
          <a href={SALLA_LOGIN_URL} className="font-medium underline">
            أعد ربط المتجر
          </a>{' '}
          لمنح الصلاحية.
        </div>
      )}

      <FilterBar filters={filters} />
      {list ? (
        <ProductTable list={list} filters={filters} />
      ) : (
        status !== null && (
          <p className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-600">
            تعذّر تحميل المنتجات. حاول مرة أخرى بعد قليل.
          </p>
        )
      )}
    </AppShell>
  );
}

function FilterBar({ filters }: { filters: Filters }) {
  return (
    <form
      method="get"
      action="/products"
      role="search"
      className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4"
    >
      <label className="min-w-0 flex-1 text-sm">
        <span className="mb-1 block text-slate-500">بحث بالاسم أو SKU</span>
        <input
          type="search"
          name="search"
          defaultValue={filters.search}
          maxLength={100}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
      </label>
      <label className="text-sm">
        <span className="mb-1 block text-slate-500">المراقبة</span>
        <select
          name="monitored"
          defaultValue={filters.monitored}
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
        >
          <option value="all">الكل</option>
          <option value="true">مراقَبة</option>
          <option value="false">بلا منافسين</option>
        </select>
      </label>
      <button
        type="submit"
        className="rounded-lg bg-brand-dark hover:bg-brand-darkest px-5 py-2 text-sm font-medium text-white"
      >
        تطبيق
      </button>
    </form>
  );
}

function ProductTable({ list, filters }: { list: ProductList; filters: Filters }) {
  if (list.items.length === 0) {
    const filtered = filters.search !== '' || filters.monitored !== 'all';
    return (
      <p className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-600">
        {filtered
          ? 'لا توجد منتجات تطابق عوامل التصفية.'
          : 'لا توجد منتجات بعد. تُزامَن منتجات متجرك تلقائيًا بعد ربطه بسلة.'}
      </p>
    );
  }

  const pages = Math.max(1, Math.ceil(list.total / list.pageSize));
  const from = (list.page - 1) * list.pageSize + 1;
  const to = from + list.items.length - 1;

  return (
    <section aria-labelledby="products-heading">
      <h2 id="products-heading" className="sr-only">
        قائمة المنتجات
      </h2>
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full min-w-[40rem] text-sm">
          <thead className="border-b border-slate-200 text-slate-500">
            <tr>
              <th scope="col" className="px-4 py-3 text-start font-medium">
                المنتج
              </th>
              <th scope="col" className="px-4 py-3 text-start font-medium">
                السعر
              </th>
              <th scope="col" className="px-4 py-3 text-start font-medium">
                المخزون
              </th>
              <th scope="col" className="px-4 py-3 text-start font-medium">
                الحالة
              </th>
              <th scope="col" className="px-4 py-3 text-start font-medium">
                المنافسون
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {list.items.map((p) => (
              <ProductRow key={p.id} product={p} />
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

function ProductRow({ product: p }: { product: ProductItem }) {
  const badge = statusBadge[p.status];
  const c = p.competitors;

  return (
    <tr>
      <td className="max-w-xs px-4 py-3">
        <p className="truncate font-medium">{p.name}</p>
        {p.sku && <p className="truncate text-xs text-slate-500">{p.sku}</p>}
      </td>
      <td className="px-4 py-3 tabular-nums">
        {p.salePrice ? (
          <>
            <span className="font-medium">{money(Number(p.salePrice), p.currency)}</span>{' '}
            <span className="text-xs text-slate-400 line-through">
              {money(Number(p.price), p.currency)}
            </span>
          </>
        ) : (
          <span className="font-medium">{money(Number(p.price), p.currency)}</span>
        )}
      </td>
      <td className="px-4 py-3 tabular-nums">
        {p.quantity === null ? 'غير محدود' : nf.format(p.quantity)}
      </td>
      <td className="px-4 py-3">
        <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${badge.pill}`}>
          {badge.label}
        </span>
      </td>
      <td className="px-4 py-3">
        {c.active === 0 ? (
          <span className="text-slate-400">—</span>
        ) : (
          <div className="tabular-nums">
            <p>
              {nf.format(c.active)} منافس
              {c.lowestPrice !== null && <> · أقل سعر {money(Number(c.lowestPrice), p.currency)}</>}
            </p>
            {c.undercut && (
              <span className="mt-1 inline-block rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">
                منافس أرخص
              </span>
            )}
          </div>
        )}
      </td>
    </tr>
  );
}
