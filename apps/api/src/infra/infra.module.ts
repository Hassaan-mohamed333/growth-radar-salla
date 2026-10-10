import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { RedisModule } from './redis.module';
import { SystemDb } from './system-db.service';
import { TenantDb } from './tenant-db.service';
import { PiiService } from '../common/crypto/pii.service';
import { TokenCryptoService } from '../common/crypto/token-crypto.service';

@Global()
@Module({
  imports: [RedisModule],
  providers: [PrismaService, TenantDb, SystemDb, TokenCryptoService, PiiService],
  exports: [PrismaService, TenantDb, SystemDb, TokenCryptoService, PiiService, RedisModule],
})
export class InfraModule {}
