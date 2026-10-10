import { Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { RequirePermission } from '../common/auth/decorators';
import { StoreAccessGuard } from '../common/auth/store-access.guard';
import { SyncService } from '../salla/sync.service';
import { DashboardService } from './dashboard.service';
import { AuthCtx } from '../common/auth/decorators';
import type { TenantContext } from '../infra/tenant-context';
import { TenantDb } from '../infra/tenant-db.service';
import { Throttle } from '@nestjs/throttler';

const langSchema = z.enum(['ar', 'en']).catch('ar');

@Controller('stores')
export class DashboardController {
  constructor(
    private readonly dashboard: DashboardService,
    private readonly sync: SyncService,
    private readonly db: TenantDb,
  ) {}

  /** Stores visible to the caller (scoped by membership). */
  @Get()
  @RequirePermission('store:read')
  list(@AuthCtx() auth: TenantContext) {
    return this.db.run((tx, tenantId) =>
      tx.store.findMany({
        where: { tenantId, ...(auth.storeScope ? { id: auth.storeScope } : {}) },
        select: { id: true, name: true, domain: true, currency: true },
        orderBy: { name: 'asc' },
        take: 200,
      }),
    );
  }

  @Get(':storeId/overview')
  @UseGuards(StoreAccessGuard)
  @RequirePermission('insights:read')
  overview(@Param('storeId') storeId: string, @Query('lang') lang?: string) {
    return this.dashboard.overview(storeId, langSchema.parse(lang));
  }

  @Post(':storeId/sync')
  @UseGuards(StoreAccessGuard)
  @RequirePermission('store:connect')
  @Throttle({ default: { limit: 3, ttl: 3_600_000 } })
  async resync(@Param('storeId') storeId: string, @AuthCtx() auth: TenantContext) {
    await this.sync.start(auth.tenantId, storeId);
    return { queued: true };
  }
}
