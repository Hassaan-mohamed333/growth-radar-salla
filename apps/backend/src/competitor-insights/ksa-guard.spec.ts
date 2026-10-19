import { CATALOG } from './ksa-catalog';
import { eligibleEntries, isSaudiTld, isSupportedCurrency, ksaRejection } from './ksa-guard';

describe('KSA guardrails', () => {
  it('every catalogue entry passes them (a bad edit to the catalogue fails here, not in production)', () => {
    for (const entry of CATALOG) {
      expect({ domain: entry.domain, rejection: ksaRejection(entry) }).toEqual({
        domain: entry.domain,
        rejection: null,
      });
    }
    expect(eligibleEntries(CATALOG)).toHaveLength(CATALOG.length);
  });

  it('keeps catalogue keys and domains unique and well-formed', () => {
    expect(new Set(CATALOG.map((e) => e.key)).size).toBe(CATALOG.length);
    expect(new Set(CATALOG.map((e) => e.domain)).size).toBe(CATALOG.length);
    for (const e of CATALOG) expect(e.domain).toBe(e.domain.toLowerCase().replace(/^www\./, ''));
  });

  it.each(['shop.sa', 'store.com.sa', 'a.b.com.sa'])('accepts the Saudi domain %s', (domain) => {
    expect(ksaRejection({ domain })).toBeNull();
  });

  it.each([
    ['example.com', 'not_saudi_domain'],
    ['shop.ae', 'not_saudi_domain'],
    // A Saudi-looking label is not a Saudi TLD.
    ['sa.attacker.com', 'not_saudi_domain'],
    ['evil.sa.attacker.com', 'not_saudi_domain'],
    ['notsa', 'invalid_domain'],
  ])('refuses %s as %s', (domain, why) => {
    expect(ksaRejection({ domain })).toBe(why);
  });

  it.each(['localhost', '127.0.0.1', 'intranet.sa:8080', 'x.sa/path', 'WWW.shop.sa', 'user@shop.sa'])(
    'refuses %s before it can be stored (SSRF guard)',
    (domain) => {
      expect(ksaRejection({ domain })).not.toBeNull();
    },
  );

  it('recognises Saudi TLDs only at the end of the name', () => {
    expect(isSaudiTld('x.sa')).toBe(true);
    expect(isSaudiTld('x.sa.example.com')).toBe(false);
    expect(isSaudiTld('xsa')).toBe(false);
  });

  it('supports SAR stores only', () => {
    expect(isSupportedCurrency('SAR')).toBe(true);
    expect(isSupportedCurrency('sar')).toBe(true);
    expect(isSupportedCurrency('AED')).toBe(false);
  });
});
