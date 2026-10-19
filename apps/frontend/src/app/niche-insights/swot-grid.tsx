// SWOT breakdown. Server component: the backend sends codes and numbers computed from the store's
// own data; the wording lives in lib/insights-text.ts. Quadrants adapt: one column on phones,
// two from `sm`, in logical order so the layout mirrors correctly in RTL.

import type { SwotItem, SwotReport } from '../../lib/api';
import { formatDate, nf } from '../../lib/format';
import { swotText } from '../../lib/insights-text';

const quadrants: Array<{
  key: 'strengths' | 'weaknesses' | 'opportunities' | 'threats';
  title: string;
  hint: string;
  tone: string;
  dot: string;
}> = [
  { key: 'strengths', title: 'نقاط القوة', hint: 'ما يعمل لصالحك', tone: 'border-emerald-200 bg-emerald-50/60', dot: 'bg-emerald-500' },
  { key: 'weaknesses', title: 'نقاط الضعف', hint: 'ما يحدّ من قراراتك', tone: 'border-red-200 bg-red-50/60', dot: 'bg-red-500' },
  { key: 'opportunities', title: 'الفرص', hint: 'ما يمكنك فعله الآن', tone: 'border-sky-200 bg-sky-50/60', dot: 'bg-sky-500' },
  { key: 'threats', title: 'التهديدات', hint: 'ما يستحق انتباهك', tone: 'border-amber-200 bg-amber-50/60', dot: 'bg-amber-500' },
];

export function SwotGrid({ report, nicheLabels }: { report: SwotReport; nicheLabels: Map<string, string> }) {
  const b = report.basis;

  return (
    <section aria-labelledby="swot-heading" className="space-y-3">
      <div>
        <h2 id="swot-heading" className="text-base font-bold">
          تحليل SWOT لمتجرك
        </h2>
        <p className="mt-1 text-xs text-slate-500">
          مبني على بياناتك فقط. منتجاتك النشطة: {nf.format(b.activeProducts)} · المنافسون المتتبَّعون:{' '}
          {nf.format(b.trackedCompetitors)} · بتاريخ {formatDate(report.generatedAt)}. لا يتضمن معلومات
          من خارج متجرك.
        </p>
      </div>

      {b.activeProducts === 0 ? (
        <p className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-600">
          لا توجد منتجات في متجرك بعد، فلا يوجد ما يُحلَّل. تظهر البنود بعد مزامنة المنتجات من سلة.
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {quadrants.map((q) => (
            <Quadrant key={q.key} q={q} items={report[q.key]} nicheLabels={nicheLabels} />
          ))}
        </div>
      )}
    </section>
  );
}

function Quadrant({
  q,
  items,
  nicheLabels,
}: {
  q: (typeof quadrants)[number];
  items: SwotItem[];
  nicheLabels: Map<string, string>;
}) {
  // Codes this version cannot word are skipped rather than shown raw.
  const lines = items.map((i) => swotText(i, nicheLabels)).filter((t): t is string => t !== null);

  return (
    <div className={`rounded-xl border p-5 ${q.tone}`}>
      <h3 className="font-bold">{q.title}</h3>
      <p className="text-xs text-slate-500">{q.hint}</p>
      {lines.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500">لا بنود حاليًا بحسب بياناتك.</p>
      ) : (
        <ul className="mt-3 space-y-2 text-sm text-slate-700">
          {lines.map((t, i) => (
            <li key={i} className="flex gap-2">
              <span aria-hidden className={`mt-2 h-1.5 w-1.5 shrink-0 rounded-full ${q.dot}`} />
              <span>{t}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
