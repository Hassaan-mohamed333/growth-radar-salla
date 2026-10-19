/**
 * Curated catalogue of Saudi retailers the discovery engine may suggest.
 *
 * This is a hand-maintained list, NOT a live market scan: nothing here is fetched, and a suggestion
 * only means "this operator sells in niches your catalogue covers". The team owns this list: keep
 * it to operators that serve Saudi customers, and re-check domains before adding one. Every
 * domain must pass the guard in ksa-guard.ts (a `.sa` / `.com.sa` domain, or an explicit entry in
 * KSA_GENERIC_TLD_OPERATORS below).
 */

export type CompetitorKind = 'MARKETPLACE' | 'RETAILER' | 'SPECIALIST';

export interface NicheDefinition {
  key: string;
  /** Arabic label shown in the dashboard. */
  label: string;
  /** Lower-case keywords matched against normalised product names (Arabic and English). */
  keywords: readonly string[];
}

export interface CatalogEntry {
  key: string;
  name: string;
  /** Registrable domain, lower case, no scheme and no `www.`. */
  domain: string;
  kind: CompetitorKind;
  /** Niche keys it sells in. Marketplaces list the niches they are strong in. */
  niches: readonly string[];
}

/** Niches recognised from product names. Order is irrelevant; a product may match several. */
export const NICHES: readonly NicheDefinition[] = [
  {
    key: 'electronics',
    label: 'الإلكترونيات والأجهزة',
    keywords: ['جوال', 'هاتف', 'لابتوب', 'حاسب', 'شاحن', 'سماعة', 'سماعات', 'تلفزيون', 'شاشة', 'كاميرا', 'ساعة ذكية', 'phone', 'laptop', 'charger', 'headphone', 'earbuds', 'tv', 'camera', 'smartwatch', 'tablet', 'ايباد'],
  },
  {
    key: 'fashion',
    label: 'الأزياء والملابس',
    keywords: ['ثوب', 'عباية', 'عباءة', 'قميص', 'فستان', 'حذاء', 'جزمة', 'شنطة', 'حقيبة', 'بنطلون', 'جاكيت', 'شماغ', 'غترة', 'dress', 'shirt', 'shoes', 'sneakers', 'bag', 'jacket', 'abaya'],
  },
  {
    key: 'beauty_health',
    label: 'الجمال والعناية والصحة',
    keywords: ['كريم', 'مكياج', 'ماسكارا', 'احمر شفاه', 'شامبو', 'سيروم', 'عناية', 'فيتامين', 'مكمل', 'مرطب', 'cream', 'makeup', 'serum', 'shampoo', 'vitamin', 'skincare', 'lipstick'],
  },
  {
    key: 'perfumes',
    label: 'العطور والعود',
    keywords: ['عطر', 'عود', 'بخور', 'دهن عود', 'مسك', 'perfume', 'oud', 'fragrance', 'bakhoor'],
  },
  {
    key: 'home_kitchen',
    label: 'المنزل والمطبخ',
    keywords: ['مطبخ', 'قدر', 'طقم', 'مفرش', 'سجاد', 'وسادة', 'ستارة', 'مكنسة', 'خلاط', 'قلاية', 'kitchen', 'blender', 'cookware', 'vacuum', 'pillow', 'curtain', 'fryer'],
  },
  {
    key: 'coffee_food',
    label: 'القهوة والتمور والأغذية',
    keywords: ['قهوة', 'تمر', 'تمور', 'عسل', 'شاي', 'بن ', 'هيل', 'زعفران', 'مكسرات', 'coffee', 'dates', 'honey', 'tea', 'saffron', 'nuts', 'cardamom'],
  },
  {
    key: 'books_stationery',
    label: 'الكتب والقرطاسية',
    keywords: ['كتاب', 'دفتر', 'قلم', 'قرطاسية', 'رواية', 'مفكرة', 'book', 'notebook', 'pen', 'stationery', 'planner'],
  },
  {
    key: 'sports_outdoor',
    label: 'الرياضة والرحلات',
    keywords: ['رياضة', 'دراجة', 'خيمة', 'كرة', 'دمبل', 'لياقة', 'تخييم', 'gym', 'bike', 'tent', 'fitness', 'dumbbell', 'camping', 'yoga'],
  },
  {
    key: 'kids_toys',
    label: 'الأطفال والألعاب',
    keywords: ['طفل', 'اطفال', 'العاب', 'لعبة', 'حفاضات', 'رضيع', 'baby', 'kids', 'toy', 'lego', 'diaper'],
  },
];

export const CATALOG: readonly CatalogEntry[] = [
  { key: 'amazon_sa', name: 'أمازون السعودية', domain: 'amazon.sa', kind: 'MARKETPLACE', niches: ['electronics', 'fashion', 'beauty_health', 'home_kitchen', 'books_stationery', 'sports_outdoor', 'kids_toys', 'coffee_food'] },
  { key: 'noon', name: 'نون', domain: 'noon.com', kind: 'MARKETPLACE', niches: ['electronics', 'fashion', 'beauty_health', 'perfumes', 'home_kitchen', 'sports_outdoor', 'kids_toys', 'coffee_food'] },
  { key: 'jarir', name: 'مكتبة جرير', domain: 'jarir.com', kind: 'RETAILER', niches: ['electronics', 'books_stationery'] },
  { key: 'extra', name: 'إكسترا', domain: 'extra.com', kind: 'RETAILER', niches: ['electronics', 'home_kitchen'] },
  { key: 'nahdi', name: 'صيدليات النهدي', domain: 'nahdionline.com', kind: 'SPECIALIST', niches: ['beauty_health', 'kids_toys'] },
  { key: 'aldawaa', name: 'صيدليات الدواء', domain: 'al-dawaa.com', kind: 'SPECIALIST', niches: ['beauty_health'] },
  { key: 'namshi', name: 'نمشي', domain: 'namshi.com', kind: 'RETAILER', niches: ['fashion', 'beauty_health', 'sports_outdoor'] },
  { key: 'ounass', name: 'أُناس', domain: 'ounass.com', kind: 'RETAILER', niches: ['fashion', 'perfumes', 'beauty_health'] },
];
