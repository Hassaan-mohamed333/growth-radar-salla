import { createHmac } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { ENV, type Env } from '../../config/env';

/** Keyed, tenant-scoped pseudonymisation: same customer => same hash within a tenant, unlinkable across tenants. */
@Injectable()
export class PiiService {
  constructor(@Inject(ENV) private readonly env: Pick<Env, 'PII_HASH_KEY'>) {}
  pseudonymize(tenantId: string, value: string | number | bigint): string {
    return createHmac('sha256', this.env.PII_HASH_KEY).update(`${tenantId}|${value}`).digest('hex');
  }
}
