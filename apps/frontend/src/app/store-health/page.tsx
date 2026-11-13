// Store health — server component. Findings come from the merchant's own Salla catalogue only
// (margins, stock, discounts): no competitor data, so nothing here depends on scraping.

import Link from 'next/link';
import { api, settle, type StoreHealth } from '../../lib/api';
import { formatDate, money, nf } from '../../lib/format';
import { figureLabel, isStale, type TruthLabel } from '../../lib/truth-labels';
import { AppShell, SignIn } from '../app-shell';
import { TruthBadge } from '../truth-badge';

export const dynamic = 'force-dynamic';

export default async function StoreHealthPage() {
  const flags = { unauthorized: false };
  const [status, data] = await Promise.all([
    settle(api.storeStatus(), flags),
    settle(api.storeHealth(), flags),
  ]);
  if (flags.unauthorized) return <SignIn />;

  return (
    <AppShell active="health" title="صحة المتجر" status={status}>
      {data ? (
        <Body data={data} />
      ) : (
        <p className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-600">
          تعذّر تحميل البيانات. حاول مرة أخرى بعد قليل.
        </p>
      )}
    </AppShell>
  );
}

function Card({
  label,
  value,
  hint,
  tone,
  badge,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'bad';
  badge?: TruthLabel;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5">
      <p className="text-sm text-slate-500">{label}</p>
      <p className={`mt-2 text-3xl font-bold tabular-nums ${tone === 'bad' ? 'text-red-700' : ''}`}>
        {value}
      </p>
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
      {badge && (
        <div className="mt-2">
          <TruthBadge label={badge} />
        </div>
      )}
    </div>
  );
}

function Section({
  title,
  empty,
  children,
}: {
  title: string;
  empty: string;
  children: React.ReactNode[] | null;
}) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5">
      <h2 className="mb-3 text-base font-bold">{title}</h2>
      {children && children.length > 0 ? (
        <ul className="divide-y divide-slate-100 text-sm">{children}</ul>
      ) : (
        <p className="text-sm text-slate-500">{empty}</p>
      )}
    </section>
  );
}

function Row({ name, detail, bad }: { name: string; detail: string; bad?: boolean }) {
  return (
    <li className="flex items-center justify-between gap-4 py-2">
      <span className="min-w-0 truncate">{name}</span>
      <span
        className={`shrink-0 tabular-nums ${bad ? 'font-medium text-red-700' : 'text-slate-600'}`}
      >
        {detail}
      </span>
    </li>
  );
}

function Body({ data }: { data: StoreHealth }) {
  const { health: h, currency } = data;
  const m = h.margins;
  const stale = isStale(data.lastSyncedAt);

  if (h.totalProducts === 0) {
    return (
      <p className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-600">
        لا توجد منتجات بعد. تُزامَن منتجات متجرك تلقائيًا بعد ربطه بسلة.
      </p>
    );
  }

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card
          label="منتجات تُباع بخسارة"
          value={nf.format(m.belowCost.length)}
          hint={
            m.withCost > 0
              ? `من ${nf.format(m.withCost)} منتجًا بتكلفة معروفة`
              : 'أضف سعر التكلفة في سلة'
          }
          tone={m.belowCost.length > 0 ? 'bad' : undefined}
          badge={figureLabel('computed', { stale, missing: m.missingCost })}
        />
        <Card
          label="متوسط هامش الربح"
          value={m.avgMarginPct === null ? '—' : `${nf.format(m.avgMarginPct)}%`}
          hint={m.missingCost > 0 ? `${nf.format(m.missingCost)} منتجًا بلا سعر تكلفة` : undefined}
          badge={figureLabel('computed', { stale, missing: m.missingCost })}
        />
        <Card
          label="منتجات نفد مخزونها"
          value={nf.format(h.stock.outOfStock)}
          hint={`و${nf.format(h.stock.lowStock)} منتجًا مخزونه ${nf.format(h.stock.lowStockThreshold)} أو أقل`}
          badge={figureLabel('confirmed', { stale, missing: 0 })}
        />
        <Card
          label="قيمة المخزون بالتكلفة"
          value={h.inventory.costValue === null ? '—' : money(h.inventory.costValue, currency)}
          hint={
            h.inventory.retailValue === null
              ? 'يحتاج تكلفة وكمية'
              : `بسعر البيع ${money(h.inventory.retailValue, currency)}`
          }
          badge={figureLabel('computed', {
            stale,
            missing: h.totalProducts - h.inventory.productsCounted,
          })}
        />
      </div>
      <p className="text-xs text-slate-500">
        آخر مزامنة للمنتجات: {formatDate(data.lastSyncedAt)}. «مؤكَّد» يعني كما في سلة، و«محسوب» ناتج
        من أسعار وتكاليف متجرك، و«تغطية جزئية» تعني أن بعض المنتجات تنقصها بيانات.
      </p>

      <Section title="تُباع بسعر أقل من التكلفة أو بلا ربح" empty="لا توجد منتجات بهذه الحالة.">
        {m.belowCost.map((r) => (
          <Row
            key={r.id}
            name={r.name}
            detail={`بيع ${money(r.sellingPrice, currency)} · تكلفة ${money(r.costPrice, currency)} (${nf.format(r.marginPct)}%)`}
            bad
          />
        ))}
      </Section>

      <Section title="أضعف هوامش الربح" empty="لا توجد منتجات بهامش ضعيف.">
        {m.thinnest.map((r) => (
          <Row key={r.id} name={r.name} detail={`${nf.format(r.marginPct)}%`} />
        ))}
      </Section>

      <Section title="نفد مخزونها" empty="لا توجد منتجات نافدة.">
        {h.stock.outOfStockItems.map((r) => (
          <Row key={r.id} name={r.name} detail="نفد" bad />
        ))}
      </Section>

      <Section title="مخزون منخفض" empty="لا توجد منتجات بمخزون منخفض.">
        {h.stock.lowStockItems.map((r) => (
          <Row key={r.id} name={r.name} detail={`${nf.format(r.quantity)} متبقية`} />
        ))}
      </Section>

      <Section
        title={`أعمق الخصومات${h.discounts.avgDiscountPct === null ? '' : ` (المتوسط ${nf.format(h.discounts.avgDiscountPct)}%)`}`}
        empty="لا توجد منتجات عليها خصم."
      >
        {h.discounts.deepest.map((r) => (
          <Row key={r.id} name={r.name} detail={`${nf.format(r.discountPct)}%`} />
        ))}
      </Section>

      {m.missingCost > 0 && (
        <p className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          {nf.format(m.missingCost)} منتجًا بلا سعر تكلفة، فلا تُحسب هوامشها. أضف سعر التكلفة في لوحة
          سلة ثم تُحدَّث البيانات عند المزامنة التالية. ·{' '}
          <Link href="/products" className="underline">
            المنتجات
          </Link>
        </p>
      )}
    </>
  );
}
