import { Global, Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { PermissionsGuard } from './permissions.guard';
import { SessionGuard } from './session.guard';
import { SessionService } from './session.service';
import { StoreAccessGuard } from './store-access.guard';

@Global()
@Module({
  controllers: [AuthController],
  providers: [SessionService, SessionGuard, PermissionsGuard, StoreAccessGuard],
  exports: [SessionService, SessionGuard, PermissionsGuard, StoreAccessGuard],
})
export class AuthModule {}
