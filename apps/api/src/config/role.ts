/** Evaluated at import time (before DI) so decorators/module metadata can depend on the process role. */
const role = process.env['APP_ROLE'] ?? 'all';
export const APP_ROLE_API = role === 'api' || role === 'all';
export const APP_ROLE_WORKER = role === 'worker' || role === 'all';
