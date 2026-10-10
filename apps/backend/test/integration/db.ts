import { randomUUID } from 'node:crypto';
import { Prisma } from '@growth-radar/database';
import { PrismaService } from '../../src/prisma/prisma.service';

/** A PrismaService bound to the integration database (DATABASE_URL set by global-setup). */
export async function connect(): Promise<PrismaService> {
  const prisma = new PrismaService();
  await prisma.$connect();
  return prisma;
}

/** Wipes every table. All tenant data cascades from `tenants`. */
export async function resetDb(prisma: PrismaService): Promise<void> {
  await prisma.$executeRawUnsafe('TRUNCATE TABLE tenants RESTART IDENTITY CASCADE');
}

export interface SeededStore {
  tenantId: string;
  storeId: string;
}

export async function seedStore(
  prisma: PrismaService,
  over: { currency?: string; name?: string } = {},
): Promise<SeededStore> {
  const key = randomUUID().slice(0, 8);
  const tenant = await prisma.tenant.create({
    data: { name: over.name ?? `Tenant ${key}`, slug: `t-${key}` },
  });
  const store = await prisma.store.create({
    data: {
      tenantId: tenant.id,
      sallaMerchantId: `m-${key}`,
      name: over.name ?? `Store ${key}`,
      currency: over.currency ?? 'SAR',
    },
  });
  return { tenantId: tenant.id, storeId: store.id };
}

export async function seedProduct(
  prisma: PrismaService,
  s: SeededStore,
  over: {
    name?: string;
    price?: number;
    salePrice?: number | null;
    costPrice?: number | null;
    status?: 'SALE' | 'OUT' | 'HIDDEN' | 'DELETED';
    sallaProductId?: string;
  } = {},
) {
  return prisma.product.create({
    data: {
      tenantId: s.tenantId,
      storeId: s.storeId,
      sallaProductId: over.sallaProductId ?? randomUUID().slice(0, 8),
      name: over.name ?? 'Product',
      price: over.price ?? 100,
      salePrice: over.salePrice ?? null,
      costPrice: over.costPrice ?? null,
      status: over.status ?? 'SALE',
    },
  });
}

export async function seedCompetitor(
  prisma: PrismaService,
  s: SeededStore,
  over: {
    productId?: string | null;
    name?: string;
    lastPrice?: number | null;
    lastCheckedAt?: Date | null;
    isActive?: boolean;
    domain?: string;
    productUrl?: string | null;
    scrapeFailures?: number;
  } = {},
) {
  const key = randomUUID().slice(0, 8);
  return prisma.competitor.create({
    data: {
      tenantId: s.tenantId,
      storeId: s.storeId,
      productId: over.productId ?? null,
      name: over.name ?? `Rival ${key}`,
      domain: over.domain ?? `rival-${key}.example.com`,
      productUrl: over.productUrl === undefined ? `https://rival-${key}.example.com/p/1` : over.productUrl,
      lastPrice: over.lastPrice === undefined ? null : over.lastPrice,
      lastCheckedAt: over.lastCheckedAt === undefined ? null : over.lastCheckedAt,
      isActive: over.isActive ?? true,
      scrapeFailures: over.scrapeFailures ?? 0,
    },
  });
}

export const D = (n: number | string) => new Prisma.Decimal(n);
