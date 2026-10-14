import type { Prisma } from '@growth-radar/database';
import type { PrismaService } from './prisma.service';

/** Generous: a chunk of upserts over a remote Postgres can exceed Prisma's 5s default. */
const TX_TIMEOUT_MS = 30_000;

/**
 * Runs `write` in a transaction only while the store is still ACTIVE; resolves null when
 * it is not. The `FOR SHARE` lock on the store row makes an uninstall that commits during
 * a sync wait for this transaction, and a write that starts after the uninstall sees
 * UNINSTALLED and writes nothing. Checking status only before a slow Salla call is not
 * enough: the store can be switched off while the sync is still waiting on Salla.
 */
export async function writeIfStoreActive<T>(
  prisma: PrismaService,
  storeId: string,
  write: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T | null> {
  return prisma.$transaction(
    async (tx) => {
      const [row] = await tx.$queryRaw<{ status: string }[]>`
        SELECT status::text AS status FROM stores WHERE id = ${storeId}::uuid FOR SHARE`;
      if (row?.status !== 'ACTIVE') return null;
      return write(tx);
    },
    { timeout: TX_TIMEOUT_MS },
  );
}
