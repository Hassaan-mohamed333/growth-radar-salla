import { NotFoundException } from '@nestjs/common';
import { CompetitorsService } from '../../src/competitors/competitors.service';
import type { PrismaService } from '../../src/prisma/prisma.service';
import { connect, D, resetDb, seedCompetitor, seedStore } from './db';

describe('CompetitorsService.remove against real PostgreSQL', () => {
  let prisma: PrismaService;
  let service: CompetitorsService;

  beforeAll(async () => {
    prisma = await connect();
    service = new CompetitorsService(prisma);
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });
  beforeEach(() => resetDb(prisma));

  it('removes the competitor together with its price history', async () => {
    const s = await seedStore(prisma);
    const c = await seedCompetitor(prisma, s);
    await prisma.competitorPriceHistory.create({
      data: {
        tenantId: s.tenantId,
        storeId: s.storeId,
        competitorId: c.id,
        price: D('50.00'),
        source: 'manual',
      },
    });

    await service.remove(s.storeId, c.id);

    expect(await prisma.competitor.count({ where: { id: c.id } })).toBe(0);
    expect(await prisma.competitorPriceHistory.count({ where: { competitorId: c.id } })).toBe(0);
  });

  it("refuses another store's competitor and leaves it intact", async () => {
    const owner = await seedStore(prisma);
    const other = await seedStore(prisma);
    const c = await seedCompetitor(prisma, owner);

    await expect(service.remove(other.storeId, c.id)).rejects.toThrow(NotFoundException);

    expect(await prisma.competitor.count({ where: { id: c.id } })).toBe(1);
  });
});
