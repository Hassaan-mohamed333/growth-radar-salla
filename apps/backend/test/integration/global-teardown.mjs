import { setTimeout as sleep } from 'node:timers/promises';

export default async function globalTeardown() {
  const pg = globalThis.__EMBEDDED_PG__;
  if (!pg) return;

  // Stopping a non-persistent embedded cluster also deletes its data directory. On Windows the
  // postgres process can still hold files for a moment, so retry before giving up. Failing to
  // delete a temp dir must never fail the test run.
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      await pg.stop();
      return;
    } catch (err) {
      if (attempt === 5) {
        console.warn(`[integration] could not clean embedded PostgreSQL data dir: ${err.code ?? err.message}`);
        return;
      }
      await sleep(300 * attempt);
    }
  }
}
