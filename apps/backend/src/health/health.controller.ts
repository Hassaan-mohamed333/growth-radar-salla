import { Controller, Get, HttpException, HttpStatus } from '@nestjs/common';
import { type HealthReport, HealthService } from './health.service';

@Controller('api/v1/health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  /** 200 when every dependency answers, 503 otherwise (what uptime monitors alert on). */
  @Get()
  async get(): Promise<HealthReport> {
    const report = await this.health.check();
    if (report.status !== 'ok') throw new HttpException(report, HttpStatus.SERVICE_UNAVAILABLE);
    return report;
  }
}
