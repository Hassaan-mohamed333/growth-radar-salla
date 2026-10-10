import { Activity, TrendingDown } from 'lucide-react';
import type { OverviewDto } from '@radar/shared';
import { formatMoney, formatPercent, type Dict } from '@/i18n';
import type { Locale } from '@/i18n/config';
import { Card } from './Card';

export function RevenueAtRiskCard({ data, currency, t, locale }: { data: OverviewDto['revenueAtRisk']; currency: string; t: Dict; locale: Locale }) {
  const share = data.revenue30d > 0 ? data.amount / data.revenue30d : 0;
  return (
    <Card title={t.risk.title} hint={t.risk.hint} icon={<TrendingDown className="size-5" />}>
      <p className="tabular text-3xl font-bold text-bad">{formatMoney(locale, data.amount, currency)}</p>
      <p className="mt-1 text-sm text-muted">
        <span className="tabular">{formatPercent(locale, share)}</span> {t.risk.ofRevenue}
      </p>
      <div className="mt-4 h-2 overflow-hidden rounded-full bg-surface-2" role="presentation">
        <div className="h-full rounded-full bg-bad" style={{ width: `${Math.min(100, Math.round(share * 100))}%` }} />
      </div>
    </Card>
  );
}

export function HealthCard({ score, t }: { score: number | null; t: Dict }) {
  const tone = score === null ? 'text-muted' : score >= 80 ? 'text-good' : score >= 55 ? 'text-warn' : 'text-bad';
  return (
    <Card title={t.health.title} hint={t.health.hint} icon={<Activity className="size-5" />}>
      <p className={`tabular text-5xl font-bold ${tone}`}>{score === null ? t.health.na : score}<span className="text-lg font-medium text-muted">{score === null ? '' : ' / 100'}</span></p>
    </Card>
  );
}
