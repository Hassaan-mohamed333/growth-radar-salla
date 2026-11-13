// Data-honesty labels shown next to numbers: what a figure is and how far to trust it.
// The state is never carried by colour alone: every label has an icon and a text.

export type TruthKind = 'confirmed' | 'computed' | 'stale' | 'partial';

export interface TruthLabel {
  kind: TruthKind;
  icon: string;
  text: string;
  /** What the merchant can do or check. */
  hint: string;
}

const LABELS: Record<TruthKind, Omit<TruthLabel, 'kind'>> = {
  confirmed: { icon: '✓', text: 'مؤكَّد', hint: 'كما هو في متجرك بسلة' },
  computed: { icon: 'ƒ', text: 'محسوب', hint: 'ناتج حسابي من أسعار وتكاليف متجرك' },
  stale: { icon: '⏱', text: 'قديم', hint: 'آخر مزامنة مضى عليها أكثر من 24 ساعة' },
  partial: { icon: '◐', text: 'تغطية جزئية', hint: 'بعض المنتجات تنقصها بيانات' },
};

export const STALE_AFTER_HOURS = 24;

export function label(kind: TruthKind): TruthLabel {
  return { kind, ...LABELS[kind] };
}

export function isStale(lastSyncedAt: string | null, now: number = Date.now()): boolean {
  if (!lastSyncedAt) return false;
  const t = Date.parse(lastSyncedAt);
  return Number.isFinite(t) && now - t > STALE_AFTER_HOURS * 3600_000;
}

/**
 * Label for a figure derived from catalogue rows: stale data wins, then partial coverage, then the
 * base kind. `missing` is how many products could not be included.
 */
export function figureLabel(
  base: 'confirmed' | 'computed',
  opts: { stale: boolean; missing: number },
) {
  if (opts.stale) return label('stale');
  if (opts.missing > 0) return label('partial');
  return label(base);
}
