// Runs `prisma migrate deploy` with the OWNER role (MIGRATION_DATABASE_URL). The runtime role (radar_app)
// deliberately cannot create tables or policies. Usage: node --env-file=../../.env scripts/migrate.mjs
import { spawnSync } from 'node:child_process';
const url = process.env.MIGRATION_DATABASE_URL;
if (!url) { console.error('MIGRATION_DATABASE_URL is not set (see .env.example)'); process.exit(1); }
const r = spawnSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], { stdio: 'inherit', shell: process.platform === 'win32', env: { ...process.env, DATABASE_URL: url } });
process.exit(r.status ?? 1);
