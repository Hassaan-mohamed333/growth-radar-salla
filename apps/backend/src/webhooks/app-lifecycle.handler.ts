import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/** Salla `app.*` lifecycle events. */
@Injectable()
export class AppLifecycleHandler {
  private readonly logger = new Logger(AppLifecycleHandler.name);

  constructor(private readonly prisma: PrismaService) {}

  static handles(event: string): boolean {
    return event === 'app.uninstalled';
  }

  /**
   * The merchant removed the app: stop syncing for them and invalidate the link.
   * Data is kept (a reinstall resumes with history); only access is switched off.
   * Idempotent, so Salla's retries and duplicate deliveries are harmless.
   */
  async handleUninstalled(merchant: number | string | undefined): Promise<void> {
    if (merchant === undefined || merchant === null) return;

    const store = await this.prisma.store.findUnique({
      where: { sallaMerchantId: String(merchant) },
      select: { id: true },
    });
    if (!store) {
      this.logger.debug(`Uninstall event for unknown merchant ${merchant}`);
      return;
    }

    await this.prisma.$transaction([
      this.prisma.store.update({
        where: { id: store.id },
        data: { status: 'UNINSTALLED', uninstalledAt: new Date() },
      }),
      this.prisma.sallaConnection.updateMany({
        where: { storeId: store.id },
        data: { status: 'REVOKED', lastError: 'app_uninstalled' },
      }),
      // Nothing left to act on: close what the engine had raised for this store.
      this.prisma.decisionRecommendation.updateMany({
        where: { storeId: store.id, status: 'PENDING' },
        data: { status: 'EXPIRED' },
      }),
    ]);
    this.logger.log(`Store ${store.id} uninstalled the app`);
  }
}
