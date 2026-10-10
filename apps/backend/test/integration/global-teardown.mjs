export default async function globalTeardown() {
  // Stopping a non-persistent embedded cluster also deletes its data directory.
  await globalThis.__EMBEDDED_PG__?.stop();
}
