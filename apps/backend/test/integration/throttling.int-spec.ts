import { Controller, Get, type INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { SkipThrottle, ThrottlerModule } from '@nestjs/throttler';
import { Test } from '@nestjs/testing';
import type { AddressInfo } from 'node:net';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { SessionThrottlerGuard } from '../../src/session/session-throttler.guard';
import { SessionModule } from '../../src/session/session.module';
import { SESSION_COOKIE, SessionService } from '../../src/session/session.service';

const LIMIT = 3;

@Controller('ping')
class PingController {
  @Get()
  ping(): string {
    return 'ok';
  }

  // Mirrors the Salla webhook route: authenticated by other means, never rate limited.
  @SkipThrottle()
  @Get('free')
  free(): string {
    return 'ok';
  }
}

/**
 * The real guard wired the way AppModule wires it (APP_GUARD + ThrottlerModule + SessionModule),
 * over real HTTP: every request here comes from the same address, which is what the API sees
 * when traffic arrives through the dashboard's rewrite.
 */
describe('rate limiting', () => {
  let app: INestApplication;
  let sessions: SessionService;
  let base: string;

  beforeAll(async () => {
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
            }),
          ],
        }),
        ThrottlerModule.forRoot([{ ttl: 60_000, limit: LIMIT }]),
        PrismaModule, // SessionModule's SessionGuard needs it, as in AppModule
        SessionModule,
      ],
      controllers: [PingController],
      providers: [{ provide: APP_GUARD, useClass: SessionThrottlerGuard }],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.listen(0, '127.0.0.1');
    sessions = moduleRef.get(SessionService);
    base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await app.close();
  });

  const cookieFor = (storeId: string) =>
    `${SESSION_COOKIE}=${encodeURIComponent(sessions.issue({ tenantId: `t-${storeId}`, storeId }))}`;

  async function hit(path: string, cookie?: string): Promise<number> {
    const res = await fetch(`${base}${path}`, { headers: cookie ? { cookie } : {} });
    return res.status;
  }

  async function burst(path: string, count: number, cookie?: string): Promise<number[]> {
    const out: number[] = [];
    for (let i = 0; i < count; i++) out.push(await hit(path, cookie));
    return out;
  }

  it('gives each merchant store its own budget, even from a shared address', async () => {
    const a = cookieFor('store-a');
    const b = cookieFor('store-b');

    // Store A spends its whole budget and is then refused...
    expect(await burst('/ping', LIMIT + 1, a)).toEqual([200, 200, 200, 429]);
    // ...while store B, arriving from the very same address, is unaffected.
    expect(await burst('/ping', LIMIT, b)).toEqual([200, 200, 200]);
    expect(await hit('/ping', b)).toBe(429);
  });

  it('limits anonymous callers by address, and a forged session does not get its own budget', async () => {
    expect(await burst('/ping', LIMIT + 1)).toEqual([200, 200, 200, 429]);

    // A cookie that fails verification is treated as anonymous: same exhausted bucket.
    const forged = `${SESSION_COOKIE}=${encodeURIComponent(
      sessions.issue({ tenantId: 't', storeId: 's' }).replace(/.$/, 'x'),
    )}`;
    expect(await hit('/ping', forged)).toBe(429);
  });

  it('never limits routes that opt out', async () => {
    expect(await burst('/ping/free', LIMIT * 4)).toEqual(Array(LIMIT * 4).fill(200));
  });
});
