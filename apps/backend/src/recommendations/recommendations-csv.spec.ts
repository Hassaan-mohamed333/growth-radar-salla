import { csvCell, recommendationsToCsv } from './recommendations-csv';
import type { RecommendationDto } from './recommendations.service';

const dto = (over: Partial<RecommendationDto> = {}): RecommendationDto => ({
  id: 'r1',
  type: 'PRICE_ADJUSTMENT',
  status: 'PENDING',
  title: 'خفض السعر',
  rationale: 'سبب',
  confidence: 88,
  details: {
    kind: 'match_competitor',
    currency: 'SAR',
    currentPrice: 100,
    lowestPrice: 90,
    competitorId: 'c1',
    competitorName: 'منافس',
    competitorsCompared: 2,
    gapPct: 10,
    costPrice: 60,
    suggestedPrice: 90,
    priceChangePct: -10,
    suggestedMarginPct: 33.3,
    marginFloorPrice: 80,
    signature: 'match_competitor:100:90:90',
  },
  product: { id: 'p1', name: 'Beans', sku: null },
  createdAt: '2026-10-10T00:00:00.000Z',
  expiresAt: null,
  decidedAt: null,
  ...over,
});

describe('csvCell', () => {
  it('leaves plain text and numbers unchanged, including negative numbers', () => {
    expect(csvCell('قهوة')).toBe('قهوة');
    expect(csvCell(-10)).toBe('-10');
    expect(csvCell(0)).toBe('0');
  });

  it('renders null and undefined as empty', () => {
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
  });

  it('quotes cells with commas, quotes or line breaks and doubles inner quotes', () => {
    expect(csvCell('a, b')).toBe('"a, b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('line1\nline2')).toBe('"line1\nline2"');
  });

  it('neutralises text that a spreadsheet would run as a formula', () => {
    expect(csvCell('=HYPERLINK("http://x")')).toBe('"\'=HYPERLINK(""http://x"")"');
    expect(csvCell('+1')).toBe("'+1");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvCell('\tcmd')).toBe("'\tcmd");
  });
});

describe('recommendationsToCsv', () => {
  it('starts with a UTF-8 BOM and the Arabic header row', () => {
    const out = recommendationsToCsv([]);
    expect(out.charCodeAt(0)).toBe(0xfeff);
    expect(out.slice(1).split('\r\n')[0]).toBe(
      'العنوان,المنتج,النوع,الحالة,الثقة %,السعر الحالي,السعر المقترح,تغيير السعر %,أقل سعر منافس,المنافس,تاريخ الإنشاء,تاريخ القرار',
    );
  });

  it('writes one row per recommendation with the price details', () => {
    const out = recommendationsToCsv([dto()]);
    const [, row] = out.slice(1).split('\r\n');
    expect(row).toBe(
      'خفض السعر,Beans,PRICE_ADJUSTMENT,PENDING,88,100,90,-10,90,منافس,2026-10-10T00:00:00.000Z,',
    );
  });

  it('leaves price columns empty for recommendations without engine details', () => {
    const out = recommendationsToCsv([dto({ details: null, product: null })]);
    const [, row] = out.slice(1).split('\r\n');
    expect(row).toBe('خفض السعر,,PRICE_ADJUSTMENT,PENDING,88,,,,,,2026-10-10T00:00:00.000Z,');
  });

  it('keeps a product name with a comma inside one cell', () => {
    const out = recommendationsToCsv([dto({ product: { id: 'p1', name: 'قهوة, بن', sku: null } })]);
    expect(out).toContain('"قهوة, بن"');
  });
});
