import { ar } from './ar';
import { en } from './en';
import type { Locale } from './config';

export const getDict = (l: Locale) => (l === 'ar' ? ar : en);
export { type Dict } from './ar';

/** Arabic locale uses Western digits (ar-SA-u-nu-latn): the norm in KSA commerce dashboards and easier to scan. */
const intlTag = (l: Locale) => (l === 'ar' ? 'ar-SA-u-nu-latn' : 'en-US');
export const formatMoney = (l: Locale, amount: number, currency: string) =>
  new Intl.NumberFormat(intlTag(l), { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount);
export const formatPercent = (l: Locale, ratio: number) =>
  new Intl.NumberFormat(intlTag(l), { style: 'percent', maximumFractionDigits: 0 }).format(ratio);
export const formatDateTime = (l: Locale, iso: string) =>
  new Intl.DateTimeFormat(intlTag(l), { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Riyadh' }).format(new Date(iso));
