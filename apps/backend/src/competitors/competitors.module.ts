import { Module } from '@nestjs/common';
import { SessionModule } from '../session/session.module';
import { CompetitorPricesService } from './competitor-prices.service';
import { CompetitorsController, ProductCompetitorsController } from './competitors.controller';
import { CompetitorsService } from './competitors.service';

@Module({
  imports: [SessionModule],
  controllers: [CompetitorsController, ProductCompetitorsController],
  providers: [CompetitorsService, CompetitorPricesService],
  exports: [CompetitorsService, CompetitorPricesService],
})
export class CompetitorsModule {}
