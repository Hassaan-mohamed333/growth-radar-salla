import 'server-only';
import { cookies } from 'next/headers';
import { z } from 'zod';
import { overviewSchema, type OverviewDto } from '@radar/shared';
import { demoOverview } from './demo';

const API = process.env.API_INTERNAL_URL ?? 'http://localhost:4000';
const storeListSchema = z.array(z.object({ id: z.string().uuid(), name: z.string(), currency: z.string() }));

export class UnauthenticatedError extends Error {}

async function apiGet(path: string): Promise<unknown> {
  const jar = await cookies();
  const session = jar.get('radar_session')?.value;
  if (!session) throw new UnauthenticatedError();
  // The browser's session cookie is forwarded server-to-server; Salla tokens never exist on the web tier.
  const res = await fetch(`${API}${path}`, { headers: { cookie: `radar_session=${session}` }, cache: 'no-store', signal: AbortSignal.timeout(8000) });
  if (res.status === 401) throw new UnauthenticatedError();
  if (!res.ok) throw new Error(`API ${res.status}`);
  return res.json();
}

export interface OverviewResult {
  overview: OverviewDto | null;
  storeName: string | null;
  demo: boolean;
}

/** Everything crossing the API boundary is re-validated with the shared zod schema before it reaches a component. */
export async function loadOverview(lang: 'ar' | 'en'): Promise<OverviewResult> {
  try {
    const stores = storeListSchema.parse(await apiGet('/stores'));
    const store = stores[0];
    if (!store) return { overview: null, storeName: null, demo: false };
    const overview = overviewSchema.parse(await apiGet(`/stores/${store.id}/overview?lang=${lang}`));
    return { overview, storeName: store.name, demo: false };
  } catch (e) {
    if (e instanceof UnauthenticatedError) throw e;
    if (process.env.DASHBOARD_DEMO_FALLBACK === 'true' && process.env.NODE_ENV !== 'production') {
      return { overview: demoOverview(lang), storeName: lang === 'ar' ? 'متجر تجريبي' : 'Demo Store', demo: true };
    }
    throw e;
  }
}
