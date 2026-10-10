import { ArrowUpRight } from 'lucide-react';
import type { RecommendationDto } from '@radar/shared';
import { formatMoney, formatPercent, type Dict } from '@/i18n';
import type { Locale } from '@/i18n/config';

const sev: Record<RecommendationDto['severity'], string> = {
  CRITICAL: 'bg-bad/15 text-bad', HIGH: 'bg-bad/10 text-bad', MEDIUM: 'bg-warn/15 text-warn', LOW: 'bg-info/15 text-info',
};

export function DecisionCard({ rec, rank, t, locale }: { rec: RecommendationDto; rank: number; t: Dict; locale: Locale }) {
  return (
    <li className="flex flex-col gap-3 rounded-2xl border border-border bg-surface p-5 shadow-sm">
      <div className="flex items-center gap-2">
        <span className="grid size-7 place-items-center rounded-full bg-brand text-sm font-bold text-brand-fg tabular" aria-label={`#${rank}`}>{rank}</span>
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${sev[rec.severity]}`}>{t.decisions.severity[rec.severity]}</span>
        <span className="text-xs text-muted">{t.decisions.category[rec.category]}</span>
        <ArrowUpRight className="ms-auto size-4 text-muted rtl:-scale-x-100" aria-hidden />
      </div>
      {/* Text nodes only: API strings are rendered as text by React (escaped), never as HTML. */}
      <h3 className="text-base font-semibold leading-snug">{rec.title}</h3>
      <p className="text-sm text-muted">{rec.summary}</p>
      <dl className="mt-auto grid grid-cols-2 gap-3 border-t border-border pt-3 text-sm">
        <div>
          <dt className="text-xs text-muted">{t.decisions.confidence}</dt>
          <dd className="tabular font-semibold">{formatPercent(locale, rec.confidence)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">{t.decisions.atRisk}</dt>
          <dd className="tabular font-semibold">{formatMoney(locale, rec.estimatedRevenueAtRisk, rec.currency)}</dd>
        </div>
      </dl>
    </li>
  );
}
