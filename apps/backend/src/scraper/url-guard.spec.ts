import { ScrapeError } from './scrape-error';
import { domainOf, isPublicAddress, parseCompetitorUrl, URL_REJECTION_TEXT } from './url-guard';

const kindOf = (fn: () => unknown) => {
  try {
    fn();
  } catch (err) {
    return err instanceof ScrapeError ? err.kind : 'other';
  }
  return 'none';
};

const reasonOf = (fn: () => unknown) => {
  try {
    fn();
  } catch (err) {
    return err instanceof ScrapeError ? err.reason : 'other';
  }
  return 'none';
};

describe('parseCompetitorUrl', () => {
  it('accepts public http(s) URLs', () => {
    expect(parseCompetitorUrl('https://shop.example.com/p/1?x=1').hostname).toBe('shop.example.com');
    expect(parseCompetitorUrl('http://example.sa/product').protocol).toBe('http:');
  });

  it.each([
    'ftp://example.com/x',
    'file:///etc/passwd',
    'javascript:alert(1)',
    'not a url',
    'https://user:pw@example.com/',
    'https://intranet/',
  ])('rejects %s as invalid', (u) => {
    expect(kindOf(() => parseCompetitorUrl(u))).toBe('invalid_url');
  });

  it.each([
    'http://localhost/x',
    'http://app.localhost/x',
    'http://127.0.0.1/x',
    'http://10.0.0.5/x',
    'http://192.168.1.1/x',
    'http://172.16.0.1/x',
    'http://169.254.169.254/latest/meta-data',
    'http://[::1]/x',
    'http://[fd00::1]/x',
    'http://[::ffff:127.0.0.1]/x',
    'http://printer.local/x',
  ])('rejects %s as a forbidden target', (u) => {
    expect(kindOf(() => parseCompetitorUrl(u))).toBe('forbidden_target');
  });

  it.each(['https://example.com:8443/x', 'http://example.com:8080/x', 'https://example.com:25/x'])(
    'rejects non-standard port in %s',
    (u) => {
      expect(kindOf(() => parseCompetitorUrl(u))).toBe('invalid_url');
    },
  );

  it('accepts the standard ports, written out or implied', () => {
    expect(parseCompetitorUrl('https://example.com:443/x').port).toBe('');
    expect(parseCompetitorUrl('http://example.com:80/x').port).toBe('');
  });

  it.each([
    ['ftp://example.com/x', 'unsupported_scheme'],
    ['not a url', 'malformed'],
    ['https://user:pw@example.com/', 'has_credentials'],
    ['https://intranet/', 'single_label_host'],
    ['https://example.com:8443/x', 'unsupported_port'],
    ['http://localhost/x', 'internal_host'],
    ['http://printer.local/x', 'internal_host'],
    ['http://127.0.0.1/x', 'private_address'],
    ['http://[fd00::1]/x', 'private_address'],
  ])('gives %s the reason %s', (u, reason) => {
    expect(reasonOf(() => parseCompetitorUrl(u))).toBe(reason);
  });

  it('has merchant text for every reason, with no IP literal or internal host', () => {
    for (const text of Object.values(URL_REJECTION_TEXT)) {
      expect(text).not.toMatch(/\d+\.\d+\.\d+\.\d+|localhost:/);
      expect(text.length).toBeGreaterThan(0);
    }
  });

  it('rejects over-long URLs', () => {
    expect(kindOf(() => parseCompetitorUrl(`https://example.com/${'a'.repeat(3000)}`))).toBe(
      'invalid_url',
    );
  });
});

describe('isPublicAddress', () => {
  it.each(['8.8.8.8', '1.1.1.1', '93.184.216.34', '2606:4700:4700::1111', '2001:4860:4860::8888'])('%s is public', (a) => {
    expect(isPublicAddress(a)).toBe(true);
  });

  it.each([
    '0.0.0.0',
    '10.1.2.3',
    '100.64.0.1',
    '127.0.0.1',
    '169.254.1.1',
    '172.31.255.255',
    '192.168.0.1',
    '198.18.0.1',
    '224.0.0.1',
    '255.255.255.255',
    '::',
    '::1',
    'fe80::1',
    'fc00::1',
    'ff02::1',
    '::ffff:10.0.0.1',
    '::ffff:7f00:1',
    // IPv4-compatible, NAT64 and 6to4 forms that embed a private IPv4 address.
    '::7f00:1',
    '0:0:0:0:0:0:7f00:1',
    '64:ff9b::7f00:1',
    '64:ff9b::a00:1',
    '2002:7f00:1::',
    'garbage',
  ])('%s is not public', (a) => {
    expect(isPublicAddress(a)).toBe(false);
  });

  it('does not treat 172.32.x as private', () => {
    expect(isPublicAddress('172.32.0.1')).toBe(true);
  });
});

describe('domainOf', () => {
  it('lowercases and strips www.', () => {
    expect(domainOf(new URL('https://WWW.Example.com/a'))).toBe('example.com');
  });
});
