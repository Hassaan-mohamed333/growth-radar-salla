import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SallaConnectionUnavailableError } from '../salla/salla-connections.service';
import { addDays, isYmd, localToday } from './sales-aggregation';
import { SalesSyncService } from './sales-sync.service';

const RECENT_DAYS = 3;
/** Don't let one odd event trigger a large re-read. */
const MAX_WEBHOOK_RANGE_DAYS = 90;

/** Turns `order.*` webhooks into a re-sync of the affected days. */
@Injectable()
export class OrderWebhookHandler {
  private readonly logger = new Logger(OrderWebhookHandler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sync: SalesSyncService,
  ) {}

  static handles(event: string): boolean {
    // Shipment events never change sales; skip them instead of re-reading orders.
    return event.startsWith('order.') && !event.startsWith('order.shipment.');
  }

  /**
   * Throws on transient failures so the webhook idempotency interceptor releases
   * the key and Salla's retry is processed. Unrecoverable cases are logged and
   * swallowed — retrying would not help.
   */
  async handle(merchant: number | string | undefined, data: unknown): Promise<void> {
    if (merchant === undefined || merchant === null) return;

    const store = await this.prisma.store.findUnique({
      where: { sallaMerchantId: String(merchant) },
      select: { id: true },
    });
    if (!store) {
      this.logger.debug(`Order event for unknown merchant ${merchant}`);
      return;
    }

    const today = localToday();
    const recentFrom = addDays(today, -(RECENT_DAYS - 1));
    const orderDay = extractOrderDay(data);
    // Reach back to the order's own day when it is older than the routine window.
    let from = orderDay && orderDay < recentFrom ? orderDay : recentFrom;
    const earliest = addDays(today, -(MAX_WEBHOOK_RANGE_DAYS - 1));
    if (from < earliest) from = earliest;

    try {
      await this.sync.syncRange(store.id, from, today);
    } catch (err) {
      if (err instanceof SallaConnectionUnavailableError) {
        this.logger.warn(`Order event ignored for store ${store.id}: connection unavailable`);
        return;
      }
      throw err;
    }
  }
}

/** Order payloads carry `date` as `{ date: "YYYY-MM-DD HH:mm:ss.ffffff", ... }` (or a plain string). */
function extractOrderDay(data: unknown): string | null {
  if (typeof data !== 'object' || data === null) return null;
  const raw = (data as { date?: unknown }).date;
  const str =
    typeof raw === 'string'
      ? raw
      : typeof raw === 'object' && raw !== null && typeof (raw as { date?: unknown }).date === 'string'
        ? (raw as { date: string }).date
        : null;
  const day = str?.slice(0, 10);
  return day && isYmd(day) ? day : null;
}
