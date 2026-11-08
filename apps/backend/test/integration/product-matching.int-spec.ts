import type { INestApplication } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type { AddressInfo } from 'node:net';
import { CompetitorPricesService } from '../../src/competitors/competitor-prices.service';
import { CompetitorsService } from '../../src/competitors/competitors.service';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { ProductMatchingController } from '../../src/product-matching/product-matching.controller';
import { ProductMatchingService } from '../../src/product-matching/product-matching.service';
import { PageFetcher } from '../../src/scraper/page-fetcher';
import { ScrapeError } from '../../src/scraper/scrape-error';
import { SessionModule } from '../../src/session/session.module';
import { SESSION_COOKIE, SessionService } from '../../src/session/session.service';
import { resetDb, seedCompetitor, seedProduct, seedStore, type SeededStore } from './db';

/** Serves canned pages by URL; a missing URL behaves like a site that refuses us. */
class FakeFetcher extends PageFetcher {
  pages = new Map<string, string>();
  requested: string[] = [];
  async fetchHtml(url: string): Promise<string> {
    this.requested.push(url);
    const html = this.pages.get(url);
    if (html === undefined) throw new ScrapeError('blocked', 'refused');
    return html;
  }
}

const searchPage = (items: Array<{ href: string; title: string }>) =>
  `<html><body>${items.map((i) => `<a href="${i.href}" title="${i.title}">${i.title}</a>`).join('')}</body></html>`;

const productPage = (name: string, price: number, currency = 'SAR') =>
  `<html><head><script type="application/ld+json">${JSON.stringify({
    '@type': 'Product',
    name,
    offers: { '@type': 'Offer', price, priceCurrency: currency },
  })}</script></head></html>`;

const q = (text: string) => encodeURIComponent(text);

describe('Product matching over HTTP against real PostgreSQL', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let sessions: SessionService;
  let fetcher: FakeFetcher;
  let base: string;
  let a: SeededStore;
  let b: SeededStore;
  let config: ConfigService;

  beforeAll(async () => {
    fetcher = new FakeFetcher();
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [
            () => ({
              NODE_ENV: 'test',
              SESSION_SECRET: 'integration-test-secret-integration-test-secret',
              SESSION_TTL_SECONDS: 3600,
              SCRAPER_ENABLED: true,
              SCRAPER_DOMAIN_DELAY_MS: 0,
            }),
          ],
        }),
        PrismaModule,
        SessionModule,
      ],
      controllers: [ProductMatchingController],
      providers: [
        ProductMatchingService,
        CompetitorsService,
        CompetitorPricesService,
        { provide: PageFetcher, useValue: fetcher },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.listen(0, '127.0.0.1');
    prisma = moduleRef.get(PrismaService);
    config = moduleRef.get(ConfigService);
    sessions = moduleRef.get(SessionService);
    base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    config.set('SCRAPER_ENABLED', true);
    fetcher.pages.clear();
    fetcher.requested = [];
    await resetDb(prisma);
    a = await seedStore(prisma);
    b = await seedStore(prisma);
  });

  const cookieFor = (s: SeededStore) =>
    `${SESSION_COOKIE}=${encodeURIComponent(sessions.issue({ tenantId: s.tenantId, storeId: s.storeId }))}`;

  async function call(method: 'GET' | 'POST', path: string, as?: SeededStore) {
    const res = await fetch(`${base}/api/v1/product-matching${path}`, {
      method,
      headers: as ? { cookie: cookieFor(as) } : {},
    });
    return { status: res.status, json: (await res.json().catch(() => null)) as any };
  }

  /** A site-level competitor (domain only) for the store. */
  const site = (s: SeededStore, domain: string, name: string) =>
    seedCompetitor(prisma, s, { domain, name, productUrl: null });

  /** Serves a search result list and its product pages for a site. */
  function serve(domain: string, query: string, hits: Array<{ path: string; title: string; pageName: string; price: number }>) {
    fetcher.pages.set(
      `https://${domain}/search?q=${q(query)}`,
      searchPage(hits.map((h) => ({ href: h.path, title: h.title }))),
    );
    for (const h of hits) fetcher.pages.set(`https://${domain}${h.path}`, productPage(h.pageName, h.price));
  }

  it('links a strong same-size match automatically and shows it in the comparison', async () => {
    const product = await seedProduct(prisma, a, { name: 'قهوة إثيوبية 500غ', price: 120 });
    await site(a, 'beans.sa', 'متجر البن');
    serve('beans.sa', 'قهوة إثيوبية', [
      { path: '/products/ethiopian', title: 'قهوة اثيوبيه 500 جرام', pageName: 'قهوة إثيوبية 500 جرام', price: 99 },
    ]);

    const res = await call('POST', `/products/${product.id}/search`, a);

    expect(res.status).toBe(200);
    expect(res.json.outcomes).toEqual([
      expect.objectContaining({ domain: 'beans.sa', name: 'متجر البن', outcome: 'linked' }),
    ]);

    const listing = await prisma.competitor.findFirstOrThrow({
      where: { storeId: a.storeId, productId: product.id },
    });
    expect(listing).toMatchObject({ domain: 'beans.sa', name: 'متجر البن', productUrl: 'https://beans.sa/products/ethiopian' });
    expect(listing.lastPrice?.toNumber()).toBe(99);
    expect(await prisma.productMatch.findFirstOrThrow({ where: { storeId: a.storeId } })).toMatchObject({
      status: 'LINKED',
      competitorId: listing.id,
    });

    const overview = await call('GET', '', a);
    expect(overview.json.summary).toEqual({ products: 1, matched: 1, pendingSuggestions: 0 });
    expect(overview.json.items[0]).toMatchObject({
      id: product.id,
      ourPrice: '120.00',
      lowestCompetitorPrice: '99.00',
      gapPct: 21.2,
    });
    expect(overview.json.items[0].listings).toHaveLength(1);
  });

  it('suggests a plausible but weaker match instead of linking it, and links it once confirmed', async () => {
    const product = await seedProduct(prisma, a, { name: 'قهوة إثيوبية مختصة محمصة', price: 120 });
    await site(a, 'beans.sa', 'متجر البن');
    serve('beans.sa', 'قهوة إثيوبية مختصة محمصة', [
      { path: '/products/x', title: 'قهوة إثيوبية', pageName: 'قهوة إثيوبية مختصة', price: 95 },
    ]);

    const res = await call('POST', `/products/${product.id}/search`, a);
    expect(res.json.outcomes[0]).toMatchObject({ outcome: 'suggested' });
    expect(await prisma.competitor.count({ where: { storeId: a.storeId, productId: product.id } })).toBe(0);

    const match = await prisma.productMatch.findFirstOrThrow({ where: { storeId: a.storeId } });
    expect(match.status).toBe('SUGGESTED');

    const confirm = await call('POST', `/matches/${match.id}/confirm`, a);
    expect(confirm.status).toBe(200);
    expect(confirm.json.status).toBe('CONFIRMED');
    expect(await prisma.competitor.count({ where: { storeId: a.storeId, productId: product.id } })).toBe(1);

    // Confirming twice is refused, not duplicated.
    expect((await call('POST', `/matches/${match.id}/confirm`, a)).status).toBe(409);
    expect(await prisma.competitor.count({ where: { storeId: a.storeId, productId: product.id } })).toBe(1);
  });

  it('never links the same words in a different size', async () => {
    const product = await seedProduct(prisma, a, { name: 'قهوة إثيوبية 500غ', price: 120 });
    await site(a, 'beans.sa', 'متجر البن');
    serve('beans.sa', 'قهوة إثيوبية', [
      { path: '/products/big', title: 'قهوة إثيوبية 1 كجم', pageName: 'قهوة إثيوبية 1 كجم', price: 180 },
    ]);

    const res = await call('POST', `/products/${product.id}/search`, a);

    expect(res.json.outcomes[0].outcome).toBe('none');
    expect(await prisma.competitor.count({ where: { storeId: a.storeId, productId: product.id } })).toBe(0);
    expect(await prisma.productMatch.count({ where: { storeId: a.storeId } })).toBe(0);
  });

  it('judges by the product page, not the search-result title', async () => {
    const product = await seedProduct(prisma, a, { name: 'قهوة إثيوبية 500غ', price: 120 });
    await site(a, 'beans.sa', 'متجر البن');
    // The listing teaser looks right, the page behind it is a different size.
    serve('beans.sa', 'قهوة إثيوبية', [
      { path: '/products/x', title: 'قهوة إثيوبية 500غ', pageName: 'قهوة إثيوبية 2 كجم', price: 300 },
    ]);

    expect((await call('POST', `/products/${product.id}/search`, a)).json.outcomes[0].outcome).toBe('none');
  });

  it('skips pages quoting another currency and pages with no price', async () => {
    const product = await seedProduct(prisma, a, { name: 'قهوة إثيوبية 500غ', price: 120 });
    await site(a, 'beans.sa', 'متجر البن');
    fetcher.pages.set(
      `https://beans.sa/search?q=${q('قهوة إثيوبية')}`,
      searchPage([
        { href: '/products/usd', title: 'قهوة إثيوبية 500غ' },
        { href: '/products/noprice', title: 'قهوة إثيوبية 500غ نسخة' },
      ]),
    );
    fetcher.pages.set('https://beans.sa/products/usd', productPage('قهوة إثيوبية 500غ', 26, 'USD'));
    fetcher.pages.set('https://beans.sa/products/noprice', '<html><head><title>قهوة إثيوبية 500غ</title></head></html>');

    expect((await call('POST', `/products/${product.id}/search`, a)).json.outcomes[0].outcome).toBe('none');
  });

  it('reports a site that refuses us as unreachable and still searches the others', async () => {
    const product = await seedProduct(prisma, a, { name: 'قهوة إثيوبية 500غ', price: 120 });
    await site(a, 'blocked.sa', 'محجوب');
    await site(a, 'beans.sa', 'متجر البن');
    serve('beans.sa', 'قهوة إثيوبية', [
      { path: '/products/e', title: 'قهوة إثيوبية 500غ', pageName: 'قهوة إثيوبية 500غ', price: 99 },
    ]);

    const res = await call('POST', `/products/${product.id}/search`, a);

    const byDomain = Object.fromEntries(res.json.outcomes.map((o: any) => [o.domain, o.outcome]));
    expect(byDomain).toEqual({ 'blocked.sa': 'unreachable', 'beans.sa': 'linked' });
  });

  it('does not follow search-result links that point to another site', async () => {
    const product = await seedProduct(prisma, a, { name: 'قهوة إثيوبية 500غ', price: 120 });
    await site(a, 'beans.sa', 'متجر البن');
    fetcher.pages.set(
      `https://beans.sa/search?q=${q('قهوة إثيوبية')}`,
      searchPage([{ href: 'https://evil.example/products/x', title: 'قهوة إثيوبية 500غ' }]),
    );

    const res = await call('POST', `/products/${product.id}/search`, a);

    expect(res.json.outcomes[0].outcome).toBe('none');
    expect(fetcher.requested.some((u) => u.includes('evil.example'))).toBe(false);
  });

  it('skips sites that already have a listing for the product, and never resurrects a rejection', async () => {
    const product = await seedProduct(prisma, a, { name: 'قهوة إثيوبية مختصة محمصة', price: 120 });
    await seedCompetitor(prisma, a, {
      productId: product.id,
      domain: 'tracked.sa',
      productUrl: 'https://tracked.sa/products/1',
    });
    await site(a, 'beans.sa', 'متجر البن');
    serve('beans.sa', 'قهوة إثيوبية مختصة محمصة', [
      { path: '/products/x', title: 'قهوة إثيوبية', pageName: 'قهوة إثيوبية مختصة', price: 95 },
    ]);

    const first = await call('POST', `/products/${product.id}/search`, a);
    expect(first.json.outcomes.map((o: any) => o.domain)).toEqual(['beans.sa']); // tracked.sa is skipped

    const match = await prisma.productMatch.findFirstOrThrow({ where: { storeId: a.storeId } });
    expect((await call('POST', `/matches/${match.id}/reject`, a)).json.status).toBe('REJECTED');

    const again = await call('POST', `/products/${product.id}/search`, a);
    expect(again.json.outcomes[0].outcome).toBe('none');
    expect((await prisma.productMatch.findFirstOrThrow({ where: { id: match.id } })).status).toBe('REJECTED');
  });

  it('is idempotent: searching twice does not duplicate a linked listing', async () => {
    const product = await seedProduct(prisma, a, { name: 'قهوة إثيوبية 500غ', price: 120 });
    await site(a, 'beans.sa', 'متجر البن');
    serve('beans.sa', 'قهوة إثيوبية', [
      { path: '/products/e', title: 'قهوة إثيوبية 500غ', pageName: 'قهوة إثيوبية 500غ', price: 99 },
    ]);

    await call('POST', `/products/${product.id}/search`, a);
    await call('POST', `/products/${product.id}/search`, a);

    expect(await prisma.competitor.count({ where: { storeId: a.storeId, productId: product.id, domain: 'beans.sa', productUrl: { not: null } } })).toBe(1);
    expect(await prisma.productMatch.count({ where: { storeId: a.storeId } })).toBe(1);
  });

  it('refuses to search when price fetching is switched off', async () => {
    const product = await seedProduct(prisma, a, { name: 'قهوة إثيوبية 500غ' });
    config.set('SCRAPER_ENABLED', false);

    const res = await call('POST', `/products/${product.id}/search`, a);

    expect(res.status).toBe(409);
    expect(res.json.code).toBe('scraper_disabled');
    expect(fetcher.requested).toEqual([]);
    expect((await call('GET', '', a)).json.scraperEnabled).toBe(false);
  });

  describe('access', () => {
    it('requires a session on every route', async () => {
      const id = '00000000-0000-4000-8000-000000000000';
      expect((await call('GET', '')).status).toBe(401);
      expect((await call('POST', `/products/${id}/search`)).status).toBe(401);
      expect((await call('POST', `/matches/${id}/confirm`)).status).toBe(401);
      expect((await call('POST', `/matches/${id}/reject`)).status).toBe(401);
    });

    it("answers 404 for another store's product or match and leaves them untouched", async () => {
      const theirProduct = await seedProduct(prisma, b, { name: 'قهوة إثيوبية مختصة محمصة' });
      await site(b, 'beans.sa', 'متجرهم');
      serve('beans.sa', 'قهوة إثيوبية مختصة محمصة', [
        { path: '/products/x', title: 'قهوة إثيوبية', pageName: 'قهوة إثيوبية مختصة', price: 95 },
      ]);
      await call('POST', `/products/${theirProduct.id}/search`, b);
      const theirMatch = await prisma.productMatch.findFirstOrThrow({ where: { storeId: b.storeId } });

      expect((await call('POST', `/products/${theirProduct.id}/search`, a)).status).toBe(404);
      expect((await call('POST', `/matches/${theirMatch.id}/confirm`, a)).status).toBe(404);
      expect((await call('POST', `/matches/${theirMatch.id}/reject`, a)).status).toBe(404);
      expect((await prisma.productMatch.findFirstOrThrow({ where: { id: theirMatch.id } })).status).toBe('SUGGESTED');
    });

    it("never mixes stores' products or suggestions in the overview", async () => {
      await seedProduct(prisma, a, { name: 'منتج المتجر أ' });
      await seedProduct(prisma, b, { name: 'منتج المتجر ب' });

      const overview = await call('GET', '', a);

      expect(overview.json.items.map((i: any) => i.name)).toEqual(['منتج المتجر أ']);
    });

    it('rejects malformed ids and queries', async () => {
      expect((await call('POST', '/products/not-a-uuid/search', a)).status).toBe(400);
      expect((await call('POST', '/matches/nope/confirm', a)).status).toBe(400);
      expect((await call('GET', '?page=0', a)).status).toBe(400);
    });
  });
});
