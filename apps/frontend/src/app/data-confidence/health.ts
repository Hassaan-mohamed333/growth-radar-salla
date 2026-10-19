// How a competitor listing is doing, derived only from fields the API already returns.
// Pure and server/client safe. The scraper's on/off switch is a backend setting that the API
// does not expose, so "waiting" means "has a URL but no price yet", not "scraping is off".

import type { CompetitorItem } from '../../lib/api';

export type Health = 'healthy' | 'failing' | 'manual' | 'waiting' | 'paused';

export const healthMeta: Record<Health, { label: string; bar: string; pill: string }> = {
  healthy: { label: 'يعمل', bar: 'bg-emerald-500', pill: 'bg-emerald-50 text-emerald-700' },
  failing: { label: 'فشل آخر فحص', bar: 'bg-red-500', pill: 'bg-red-50 text-red-700' },
  manual: { label: 'إدخال يدوي', bar: 'bg-amber-500', pill: 'bg-amber-50 text-amber-700' },
  waiting: { label: 'بانتظار أول سعر', bar: 'bg-sky-400', pill: 'bg-sky-50 text-sky-700' },
  paused: { label: 'متوقف', bar: 'bg-slate-400', pill: 'bg-slate-100 text-slate-600' },
};

export function healthOf(c: Pick<CompetitorItem, 'isActive' | 'lastScrapeError' | 'productUrl' | 'lastPrice'>): Health {
  if (!c.isActive) return 'paused';
  if (c.lastScrapeError) return 'failing';
  if (c.productUrl === null) return 'manual';
  return c.lastPrice === null ? 'waiting' : 'healthy';
}
