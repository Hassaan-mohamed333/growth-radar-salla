import type { RecommendationDto } from './recommendations.service';

const COLUMNS = [
  'العنوان',
  'المنتج',
  'النوع',
  'الحالة',
  'الثقة %',
  'السعر الحالي',
  'السعر المقترح',
  'تغيير السعر %',
  'أقل سعر منافس',
  'المنافس',
  'تاريخ الإنشاء',
  'تاريخ القرار',
] as const;

/**
 * One CSV cell. Text that a spreadsheet would run as a formula (starts with = + - @ or a
 * tab/CR) gets a leading apostrophe, so a product name can't inject a formula. Numbers are
 * left alone, so negative price changes stay numeric.
 */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let text = String(value);
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** UTF-8 BOM first, so Excel reads the Arabic headers correctly. */
export function recommendationsToCsv(rows: RecommendationDto[]): string {
  const lines = [COLUMNS.join(',')];
  for (const r of rows) {
    const d = r.details;
    lines.push(
      [
        r.title,
        r.product?.name ?? null,
        r.type,
        r.status,
        r.confidence,
        d?.currentPrice ?? null,
        d?.suggestedPrice ?? null,
        d?.priceChangePct ?? null,
        d?.lowestPrice ?? null,
        d?.competitorName ?? null,
        r.createdAt,
        r.decidedAt,
      ]
        .map(csvCell)
        .join(','),
    );
  }
  return `﻿${lines.join('\r\n')}\r\n`;
}
