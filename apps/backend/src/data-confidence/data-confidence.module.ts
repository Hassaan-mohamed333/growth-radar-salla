import { Module } from '@nestjs/common';
import { SessionModule } from '../session/session.module';
import { DataConfidenceController } from './data-confidence.controller';
import { DataConfidenceService } from './data-confidence.service';

@Module({
  imports: [SessionModule],
  controllers: [DataConfidenceController],
  providers: [DataConfidenceService],
})
export class DataConfidenceModule {}
