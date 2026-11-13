import type { TruthLabel } from '../lib/truth-labels';

/** Small pill with icon + text (never colour alone); `title` carries the explanation. */
export function TruthBadge({ label }: { label: TruthLabel }) {
  const tone =
    label.kind === 'stale'
      ? 'bg-amber-50 text-amber-800'
      : label.kind === 'partial'
        ? 'bg-slate-100 text-slate-700'
        : 'bg-emerald-50 text-emerald-800';
  return (
    <span
      title={label.hint}
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${tone}`}
    >
      <span aria-hidden>{label.icon}</span>
      {label.text}
    </span>
  );
}
