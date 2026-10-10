const R = 52;
const C = 2 * Math.PI * R;

/** Circular score gauge. Uses SVG attributes (not inline styles) so it works under a strict CSP. */
export function Gauge({ value, tone, label }: { value: number | null; tone: 'good' | 'warn' | 'bad' | 'muted'; label: string }) {
  const pct = value === null ? 0 : Math.max(0, Math.min(100, value));
  const stroke = { good: 'stroke-good', warn: 'stroke-warn', bad: 'stroke-bad', muted: 'stroke-muted' }[tone];
  return (
    <div className="relative size-36 shrink-0" role="img" aria-label={label}>
      <svg viewBox="0 0 120 120" className="size-full -rotate-90">
        <circle cx="60" cy="60" r={R} fill="none" strokeWidth="10" className="stroke-surface-2" />
        <circle
          cx="60" cy="60" r={R} fill="none" strokeWidth="10" strokeLinecap="round"
          strokeDasharray={C} strokeDashoffset={C * (1 - pct / 100)} className={stroke}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center">
        <span className="tabular text-4xl font-bold">{value === null ? '—' : value}</span>
      </div>
    </div>
  );
}
