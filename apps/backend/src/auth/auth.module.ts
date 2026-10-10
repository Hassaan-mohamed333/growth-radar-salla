import { Module } from '@nestjs/common';
import { ProductsModule } from '../products/products.module';
import { SallaModule } from '../salla/salla.module';
import { SessionModule } from '../session/session.module';
import { SyncModule } from '../sync/sync.module';
import { AuthController, SessionController } from './auth.controller';
import { AuthService } from './auth.service';

@Module({
  imports: [SallaModule, SessionModule, SyncModule, ProductsModule],
  controllers: [AuthController, SessionController],
  providers: [AuthService],
})
export class AuthModule {}
