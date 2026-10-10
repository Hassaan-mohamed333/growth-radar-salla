import { Module } from '@nestjs/common';
import { SessionModule } from '../session/session.module';
import { StoreController } from './store.controller';
import { StoreService } from './store.service';

@Module({
  imports: [SessionModule],
  controllers: [StoreController],
  providers: [StoreService],
  exports: [StoreService],
})
export class StoreModule {}
