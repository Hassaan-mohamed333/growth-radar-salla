import { Injectable } from '@nestjs/common';
import { SallaApiClient, SallaApiError } from './salla-api.client';
import { SallaTokenService } from './salla-token.service';

/** Authenticated Salla calls for a store. One transparent token refresh + retry on 401. */
@Injectable()
export class SallaClientService {
  constructor(private readonly tokens: SallaTokenService, private readonly api: SallaApiClient) {}

  async get(tenantId: string, storeId: string, path: string, query: Record<string, string | number> = {}) {
    const token = await this.tokens.getAccessToken(tenantId, storeId);
    try {
      return await this.api.get(token, path, query);
    } catch (e) {
      if (e instanceof SallaApiError && e.status === 401) {
        const fresh = await this.tokens.getAccessToken(tenantId, storeId, true);
        return this.api.get(fresh, path, query);
      }
      throw e;
    }
  }
}
