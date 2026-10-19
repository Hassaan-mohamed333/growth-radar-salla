import { analyzeNiches, classify, normalise } from './niche-analyzer';

describe('normalise', () => {
  it('folds Arabic letter variants, diacritics and tatweel', () => {
    expect(normalise('أَحمَر  شـفاه')).toBe('احمر شفاه');
    expect(normalise('عباءة')).toBe(normalise('عباءه')); // taa marbuta folds to haa
    expect(normalise('إلكترونيات')).toBe(normalise('الكترونيات')); // alef variants fold
    expect(normalise('Coffee   BEANS')).toBe('coffee beans');
  });
});

describe('classify', () => {
  it.each([
    ['قهوة إثيوبية 500غ', ['coffee_food']],
    ['عسل سدر 250غ', ['coffee_food']],
    ['تمر مجدول 1كغ', ['coffee_food']],
    ['دهن عود ملكي', ['perfumes']],
    ['Wireless Headphone Pro', ['electronics']],
    ['شاحن سريع للجوال', ['electronics']],
    ['عباية سوداء', ['fashion']],
    ['Yoga mat', ['sports_outdoor']],
  ])('puts %s in %j', (name, expected) => {
    expect(classify(name)).toEqual(expected);
  });

  it('allows a product in several niches', () => {
    expect(classify('عطر وكريم عناية').sort()).toEqual(['beauty_health', 'perfumes']);
  });

  it('matches short and Latin keywords as whole words only', () => {
    expect(classify('Steam cleaner')).toEqual([]); // not "tea"
    expect(classify('ابن سينا')).toEqual([]); // not "بن"
    expect(classify('TV stand')).toEqual(['electronics']);
    expect(classify('Tea set')).toEqual(['coffee_food']);
    expect(classify('البن السعودي')).toEqual(['coffee_food']); // with the definite article
  });

  it('returns nothing for names it does not recognise', () => {
    expect(classify('منتج رقم 123')).toEqual([]);
    expect(classify('')).toEqual([]);
  });
});

describe('analyzeNiches', () => {
  const products = [
    { name: 'قهوة إثيوبية' },
    { name: 'عسل سدر' },
    { name: 'تمر سكري' },
    { name: 'عطر عود' },
    { name: 'منتج غير معروف' },
  ];

  it('counts products per niche, ordered by size, with shares of all products', () => {
    const a = analyzeNiches(products);

    expect(a.total).toBe(5);
    expect(a.classified).toBe(4);
    expect(a.niches.map((n) => [n.key, n.productCount, n.sharePct])).toEqual([
      ['coffee_food', 3, 60],
      ['perfumes', 1, 20],
    ]);
    expect(a.productNiches).toHaveLength(5);
  });

  it('handles an empty catalogue', () => {
    expect(analyzeNiches([])).toEqual({ total: 0, classified: 0, productNiches: [], niches: [] });
  });
});
