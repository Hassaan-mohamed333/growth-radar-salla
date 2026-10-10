import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@growth-radar/database';
import { PrismaService } from '../prisma/prisma.service';

/** Even an unchanged price is recorded this often, so history shows the competitor was still checked. */
export const HEARTBEAT_MS = 24 * 60 * 60 * 1000;

export interface PriceObservation {
  price: number;
  inStock?: boolean;
  /** Where the price came from, e.g. "manual", "scraper". */
  source: string;
}

export interface RecordedPrice {
  /** A history row was written (price changed, first observation, or heartbeat). */
  recorded: boolean;
  /** The price differs from the previously known one. */
  changed: boolean;
  price: string;
  previousPrice: string | null;
}

/**
 * The single write path for competitor prices: appends to
 * CompetitorPriceHistory and updates Competitor.lastPrice in one transaction.
 * Scrapers, imports and the manual endpoint all go through here.
 */
@Injectable()
export class CompetitorPricesService {
  constructor(private readonly prisma: PrismaService) {}

  async record(
    storeId: string,
    competitorId: string,
    obs: PriceObservation,
    now = new Date(),
  ): Promise<RecordedPrice> {
    const price = new Prisma.Decimal(obs.price).toDecimalPlaces(2);

    return this.prisma.$transaction(async (tx) => {
      // Row lock: two concurrent observations must not both see the same lastPrice.
      await tx.$queryRaw`
        SELECT id FROM competitors
        WHERE id = ${competitorId}::uuid AND store_id = ${storeId}::uuid
        FOR UPDATE`;

      const competitor = await tx.competitor.findFirst({
        where: { id: competitorId, storeId },
        select: { tenantId: true, lastPrice: true, currency: true },
      });
      if (!competitor) throw new NotFoundException('Competitor not found');

      const previous = competitor.lastPrice;
      const changed = previous === null || !previous.equals(price);

      const lastRow = await tx.competitorPriceHistory.findFirst({
        where: { competitorId },
        orderBy: { observedAt: 'desc' },
        select: { observedAt: true },
      });
      const heartbeatDue = !lastRow || now.getTime() - lastRow.observedAt.getTime() >= HEARTBEAT_MS;
      const recorded = changed || heartbeatDue;

      if (recorded) {
        await tx.competitorPriceHistory.create({
          data: {
            tenantId: competitor.tenantId,
            storeId,
            competitorId,
            price,
            previousPrice: previous,
            currency: competitor.currency,
            inStock: obs.inStock ?? null,
            source: obs.source,
            observedAt: now,
          },
        });
      }

      await tx.competitor.update({
        where: { id: competitorId },
        data: { lastPrice: price, lastCheckedAt: now },
      });

      return {
        recorded,
        changed,
        price: price.toFixed(2),
        previousPrice: previous ? previous.toFixed(2) : null,
      };
    });
  }
}
