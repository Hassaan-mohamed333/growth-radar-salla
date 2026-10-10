// Jest globalSetup: provides a migrated PostgreSQL database to the integration suites.
//
//  - TEST_DATABASE_URL set  -> use that server (e.g. `pnpm infra:up`); its database name must
//    contain "test" because suites TRUNCATE every table.
//  - otherwise              -> start a throw-away embedded PostgreSQL 16 on a free port.
//
// Either way the checked-in Prisma migrations are applied with `prisma migrate deploy`, so
// the suites exercise exactly what production runs.

import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dbPackage = resolve(here, '../../../../packages/database');

function freePort() {
  return new Promise((ok, fail) => {
    const srv = createServer();
    srv.once('error', fail);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => ok(port));
    });
  });
}

function migrate(databaseUrl) {
  const prismaCli = createRequire(join(dbPackage, 'package.json')).resolve('prisma/build/index.js');
  execFileSync(
    process.execPath,
    [prismaCli, 'migrate', 'deploy', '--schema', join(dbPackage, 'prisma/schema.prisma')],
    { env: { ...process.env, DATABASE_URL: databaseUrl }, stdio: 'pipe' },
  );
}

export default async function globalSetup() {
  const external = process.env.TEST_DATABASE_URL;

  if (external) {
    const dbName = decodeURIComponent(new URL(external).pathname.slice(1));
    if (!/test/i.test(dbName)) {
      throw new Error(
        `TEST_DATABASE_URL must point at a database whose name contains "test" (got "${dbName}"): ` +
          'integration suites truncate every table.',
      );
    }
    migrate(external);
    process.env.DATABASE_URL = external;
    return;
  }

  const { default: EmbeddedPostgres } = await import('embedded-postgres');
  const port = await freePort();
  const pg = new EmbeddedPostgres({
    databaseDir: mkdtempSync(join(tmpdir(), 'radar-int-pg-')),
    user: 'radar',
    password: 'radar',
    port,
    persistent: false,
    // Match the official postgres image (UTF8). Without this initdb inherits the host
    // code page (WIN1252 on Windows) and cannot store Arabic text.
    initdbFlags: ['--encoding=UTF8', '--locale=C'],
    onLog: () => {},
    onError: () => {},
  });

  await pg.initialise();
  await pg.start();
  try {
    await pg.createDatabase('growth_radar_test');
    const url = `postgresql://radar:radar@127.0.0.1:${port}/growth_radar_test?schema=public`;
    migrate(url);
    process.env.DATABASE_URL = url;
  } catch (err) {
    await pg.stop();
    throw err;
  }
  globalThis.__EMBEDDED_PG__ = pg;
}
