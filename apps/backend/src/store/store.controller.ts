import { Controller, Get, UseGuards } from '@nestjs/common';
import { CurrentSession, SessionGuard } from '../session/session.guard';
import type { SessionContext } from '../session/session.service';
import { StoreService, type StoreStatusResponse } from './store.service';

@Controller('api/v1/store')
@UseGuards(SessionGuard)
export class StoreController {
  constructor(private readonly store: StoreService) {}

  @Get('status')
  status(@CurrentSession() session: SessionContext): Promise<StoreStatusResponse> {
    return this.store.getStatus(session.storeId);
  }
}
