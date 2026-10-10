// Shared Arabic (ar-SA) formatting helpers for the dashboard pages.

export const nf = new Intl.NumberFormat('ar-SA');
const df = new Intl.DateTimeFormat('ar-SA', { dateStyle: 'medium', timeStyle: 'short' });

export function formatDate(iso: string | null): string {
  return iso ? df.format(new Date(iso)) : '—';
}

export function money(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat('ar-SA', { style: 'currency', currency }).format(amount);
  } catch {
    return `${nf.format(amount)} ${currency}`;
  }
}

export function signedPct(pct: number): string {
  const sign = pct > 0 ? '+' : pct < 0 ? '−' : '';
  return `${sign}${nf.format(Math.abs(pct))}%`;
}
