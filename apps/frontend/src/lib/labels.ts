// Merchant-facing labels shared by several pages.

import type { ScrapeFailureKind } from './api';

/** Why the last scrape of a competitor listing failed (fixed vocabulary from the backend). */
export const failureLabel: Record<ScrapeFailureKind, string> = {
  invalid_url: 'رابط غير صالح',
  forbidden_target: 'الرابط غير مسموح به',
  network: 'تعذّر الاتصال بالموقع',
  blocked: 'الموقع يمنع الفحص الآلي — سجّل السعر يدويًا',
  http_error: 'استجابة خاطئة من الموقع',
  not_html: 'الرابط ليس صفحة ويب',
  too_large: 'الصفحة كبيرة جدًا',
  parse_failed: 'لم يُعثر على السعر في الصفحة',
  currency_mismatch: 'عملة السعر مختلفة عن عملة المنتج',
};
