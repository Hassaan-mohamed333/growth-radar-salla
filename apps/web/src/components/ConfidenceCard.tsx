import { Check, CircleAlert, Minus, ShieldCheck, TriangleAlert, X } from 'lucide-react';
import type { OverviewDto } from '@radar/shared';
import type { Dict } from '@/i18n';
import { Card } from './Card';
import { Gauge } from './Gauge';

type Status = OverviewDto['confidence']['checks'][number]['status'];
const icon: Record<Status, { el: typeof Check; cls: string }> = {
  pass: { el: Check, cls: 'text-good' },
  warn: { el: TriangleAlert, cls: 'text-warn' },
  fail: { el: X, cls: 'text-bad' },
  unavailable: { el: CircleAlert, cls: 'text-muted' },
  not_applicable: { el: Minus, cls: 'text-muted' },
};
const tone = (l: OverviewDto['confidence']['level']) => ({ high: 'good', medium: 'warn', low: 'bad', insufficient_data: 'muted' } as const)[l];

export function ConfidenceCard({ data, t }: { data: OverviewDto['confidence']; t: Dict }) {
  const level = t.confidence.levels[data.level];
  const checks = t.confidence.checks as Record<string, string>;
  return (
    <Card title={t.confidence.title} hint={t.confidence.hint} icon={<ShieldCheck className="size-5" />} className="lg:col-span-2">
      <div className="flex flex-col gap-5">
        <div className="flex items-center gap-4">
          <Gauge value={data.score} tone={tone(data.level)} label={`${t.confidence.title}: ${data.score ?? '—'} (${level})`} />
          <p className="text-lg font-semibold">{level}</p>
        </div>
        <ul className="grid gap-2 text-sm sm:grid-cols-2">
          {data.checks.map((c) => {
            const { el: Icon, cls } = icon[c.status];
            return (
              <li key={c.id} className="flex items-center gap-2 rounded-xl bg-surface-2 px-3 py-2">
                <Icon className={`size-4 shrink-0 ${cls}`} aria-hidden />
                <span className="min-w-0 flex-1">{checks[c.id] ?? c.id}</span>
                <span className={`text-xs font-medium ${cls}`}>{t.confidence.status[c.status]}</span>
              </li>
            );
          })}
        </ul>
      </div>
    </Card>
  );
}
