import { Module } from '@nestjs/common';
import { SallaApiClient } from './salla-api.client';
import { SallaConnectionsService } from './salla-connections.service';
import { SallaOAuthClient } from './salla-oauth.client';

@Module({
  providers: [SallaConnectionsService, SallaOAuthClient, SallaApiClient],
  exports: [SallaConnectionsService, SallaOAuthClient, SallaApiClient],
})
export class SallaModule {}
