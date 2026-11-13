import type Redis from 'ioredis';
import type { PrismaService } from '../prisma/prisma.service';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

function setup(opts: { db?: () => Promise<unknown>; redis?: () => Promise<unknown> } = {}) {
  const prisma = { $queryRaw: jest.fn(opts.db ?? (async () => [{ '?column?': 1 }])) };
  const redis = { ping: jest.fn(opts.redis ?? (async () => 'PONG')) };
  const service = new HealthService(prisma as unknown as PrismaService, redis as unknown as Redis);
  return { service, controller: new HealthController(service) };
}

describe('HealthService', () => {
  it('is ok when PostgreSQL and Redis answer', async () => {
    const { service } = setup();
    await expect(service.check()).resolves.toMatchObject({
      status: 'ok',
      checks: { database: 'up', redis: 'up' },
    });
  });

  it('reports which dependency is down', async () => {
    const { service } = setup({ redis: async () => Promise.reject(new Error('ECONNREFUSED redis://secret@host')) });
    await expect(service.check()).resolves.toMatchObject({
      status: 'down',
      checks: { database: 'up', redis: 'down' },
    });
  });

  it('treats a hung dependency as down instead of hanging the monitor', async () => {
    jest.useFakeTimers();
    try {
      const { service } = setup({ db: () => new Promise(() => undefined) });
      const pending = service.check();
      await jest.advanceTimersByTimeAsync(3_100);
      await expect(pending).resolves.toMatchObject({ status: 'down', checks: { database: 'down', redis: 'up' } });
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('HealthService instance', () => {
  const saved = { service: process.env.RENDER_SERVICE_NAME, commit: process.env.RENDER_GIT_COMMIT };
  afterEach(() => {
    for (const [k, v] of [['RENDER_SERVICE_NAME', saved.service], ['RENDER_GIT_COMMIT', saved.commit]] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('names the service and short commit that answered', async () => {
    process.env.RENDER_SERVICE_NAME = 'growth-radar-api';
    process.env.RENDER_GIT_COMMIT = '23e458ec4a7b1d9f0000000000000000deadbeef';
    const { service } = setup();
    await expect(service.check()).resolves.toMatchObject({ instance: { service: 'growth-radar-api', commit: '23e458e' } });
  });

  it('reports nulls outside Render', async () => {
    delete process.env.RENDER_SERVICE_NAME;
    delete process.env.RENDER_GIT_COMMIT;
    const { service } = setup();
    await expect(service.check()).resolves.toMatchObject({ instance: { service: null, commit: null } });
  });
});

describe('HealthController', () => {
  it('answers 200 with the report when healthy', async () => {
    const { controller } = setup();
    await expect(controller.get()).resolves.toMatchObject({ status: 'ok' });
  });

  it('answers 503 with the report when a dependency is down', async () => {
    const { controller } = setup({ db: async () => Promise.reject(new Error('down')) });
    const err = await controller.get().catch((e: unknown) => e);
    expect(err).toMatchObject({ status: 503 });
    expect((err as { getResponse(): unknown }).getResponse()).toMatchObject({
      status: 'down',
      checks: { database: 'down' },
    });
  });
});
