import { Module } from '@nestjs/common';
import { SallaModule } from '../salla/salla.module';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

@Module({ imports: [SallaModule], controllers: [DashboardController], providers: [DashboardService] })
export class DashboardModule {}
