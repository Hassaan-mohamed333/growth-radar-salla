import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { SallaApiClient } from '../salla/salla-api.client';
import { SallaConnectionsService } from '../salla/salla-connections.service';
import { addDays, aggregateOrders, enumerateDays, localToday } from './sales-aggregation';

/** Days re-read on every scheduled run: catches late refunds/cancellations. */
const RECENT_DAYS = 3;
const MAX_RANGE_DAYS = 365;

export interface SyncResult {
  days: number;
  orders: number;
}

/**
 * Pulls orders from Salla and rebuilds the per-day SalesSnapshot rows.
 *
 * Every run overwrites the days it covers from source data, so it is idempotent
 * and safe to trigger from the scheduler, a webhook and a login at once.
 */
@Injectable()
export class SalesSyncService {
  private readonly logger = new Logger(SalesSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly connections: SallaConnectionsService,
    private readonly api: SallaApiClient,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /** Rebuild snapshots for the inclusive store-local day range [fromDay, toDay]. */
  async syncRange(storeId: string, fromDay: string, toDay: string): Promise<SyncResult> {
    const days = enumerateDays(fromDay, toDay);
    if (days.length === 0 || days.length > MAX_RANGE_DAYS) {
      throw new RangeError(`Invalid sync range ${fromDay}..${toDay}`);
    }

    const store = await this.prisma.store.findUnique({
      where: { id: storeId },
      select: { tenantId: true, currency: true, status: true },
    });
    if (!store || store.status !== 'ACTIVE') return { days: 0, orders: 0 };

    const accessToken = await this.connections.getValidAccessToken(storeId);
    // Salla's from/to inclusivity is undocumented: pad by a day, bucket locally.
    const orders = await this.api.listOrders(accessToken, {
      fromDate: addDays(fromDay, -1),
      toDate: addDays(toDay, 1),
    });
    const totals = aggregateOrders(orders, days);

    await this.prisma.$transaction(
      totals.map((t) => {
        const date = new Date(`${t.date}T00:00:00.000Z`);
        const values = {
          ordersCount: t.ordersCount,
          unitsSold: t.unitsSold,
          grossRevenue: t.grossRevenue,
          refundedRevenue: t.refundedRevenue,
          currency: store.currency,
        };
        return this.prisma.salesSnapshot.upsert({
          where: { storeId_date: { storeId, date } },
          create: { tenantId: store.tenantId, storeId, date, ...values },
          update: values,
        });
      }),
    );

    return { days: totals.length, orders: orders.length };
  }

  /** Last few days, ending today (store-local). */
  syncRecent(storeId: string, days = RECENT_DAYS): Promise<SyncResult> {
    const today = localToday();
    return this.syncRange(storeId, addDays(today, -(days - 1)), today);
  }

  /** First run for a store backfills history; later runs only refresh recent days. */
  async syncStore(storeId: string): Promise<SyncResult> {
    const existing = await this.prisma.salesSnapshot.count({ where: { storeId } });
    if (existing === 0) {
      const backfill = this.config.get('SALES_BACKFILL_DAYS', { infer: true });
      this.logger.log(`Backfilling ${backfill} days of orders for store ${storeId}`);
      return this.syncRecent(storeId, backfill);
    }
    return this.syncRecent(storeId);
  }
}
