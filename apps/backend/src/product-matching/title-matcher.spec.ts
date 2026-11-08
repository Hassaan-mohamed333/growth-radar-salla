import { AUTO_LINK_SCORE, scoreMatch, searchQuery, SUGGEST_SCORE } from './title-matcher';

describe('scoreMatch', () => {
  it('scores the same product written differently high enough to link automatically', () => {
    const r = scoreMatch('قهوة إثيوبية 500غ', 'قهوة اثيوبيه - 500 جرام | متجر بن');
    expect(r.quantitiesAgree).toBe(true);
    expect(r.score).toBeGreaterThanOrEqual(AUTO_LINK_SCORE);
  });

  it('ignores word order, case, diacritics and the definite article', () => {
    const r = scoreMatch('Ethiopian Coffee Beans', 'beans coffee ETHIOPIAN');
    expect(r.score).toBeGreaterThanOrEqual(AUTO_LINK_SCORE);
    expect(scoreMatch('عطر العود الملكي', 'عطر عود ملكي').score).toBeGreaterThanOrEqual(AUTO_LINK_SCORE);
  });

  it('reads Arabic-Indic digits and converts units, so 0.5 kg equals 500 g', () => {
    expect(scoreMatch('قهوة عربية ٥٠٠ غ', 'قهوة عربية 0.5 كجم').quantitiesAgree).toBe(true);
    expect(scoreMatch('Olive oil 1 L', 'olive oil 1000 ml').quantitiesAgree).toBe(true);
  });

  it('refuses to call two sizes the same product, however similar the words are', () => {
    const r = scoreMatch('قهوة إثيوبية 500غ', 'قهوة إثيوبية 1 كجم');
    expect(r.quantitiesAgree).toBe(false);
    expect(r.score).toBeLessThan(SUGGEST_SCORE);
  });

  it('does not treat a missing size on one side as a disagreement', () => {
    const r = scoreMatch('قهوة إثيوبية 500غ', 'قهوة إثيوبية فاخرة');
    expect(r.quantitiesAgree).toBe(true);
    expect(r.score).toBeGreaterThanOrEqual(SUGGEST_SCORE);
  });

  it('gives unrelated products no score', () => {
    expect(scoreMatch('قهوة إثيوبية 500غ', 'ساعة يد رجالية جلد').score).toBe(0);
    expect(scoreMatch('', 'anything').score).toBe(0);
  });

  it('keeps a lone shared word from linking a longer name', () => {
    const r = scoreMatch('قهوة إثيوبية مختصة محمصة داكنة', 'قهوة سريعة التحضير');
    expect(r.sharedWords).toBe(1);
    expect(r.score).toBeLessThan(AUTO_LINK_SCORE);
  });

  it('caps a one-word name: it matches the whole category, not one product', () => {
    expect(scoreMatch('قهوة', 'قهوة').score).toBeLessThan(AUTO_LINK_SCORE);
  });

  it('tolerates a single typo in a long word but not in a short one', () => {
    expect(scoreMatch('chocolate cake', 'chocolat cake').score).toBeGreaterThanOrEqual(AUTO_LINK_SCORE);
    expect(scoreMatch('red cap', 'rid cap').sharedWords).toBe(1);
  });

  it('separates model numbers: iPhone 15 is not iPhone 14', () => {
    const r = scoreMatch('iPhone 15 case', 'iPhone 14 case');
    expect(r.quantitiesAgree).toBe(false);
    expect(r.score).toBeLessThan(SUGGEST_SCORE);
  });
});

describe('searchQuery', () => {
  it('keeps the descriptive words and drops sizes, filler and duplicates', () => {
    expect(searchQuery('قهوة إثيوبية جديد 500غ قهوة')).toBe('قهوة إثيوبية');
  });

  it('caps the number of words', () => {
    expect(searchQuery('one two three four five six seven', 3)).toBe('one two three');
  });

  it('is empty when nothing descriptive remains', () => {
    expect(searchQuery('500 غ')).toBe('');
  });
});
