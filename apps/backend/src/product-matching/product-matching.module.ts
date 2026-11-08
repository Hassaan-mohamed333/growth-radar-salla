import { Module } from '@nestjs/common';
import { CompetitorsModule } from '../competitors/competitors.module';
import { ScraperModule } from '../scraper/scraper.module';
import { SessionModule } from '../session/session.module';
import { ProductMatchingController } from './product-matching.controller';
import { ProductMatchingService } from './product-matching.service';

@Module({
  imports: [SessionModule, CompetitorsModule, ScraperModule],
  controllers: [ProductMatchingController],
  providers: [ProductMatchingService],
})
export class ProductMatchingModule {}
