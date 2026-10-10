import { Controller, Get } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from './common/auth/decorators';

@Controller('health')
export class HealthController {
  @Public()
  @SkipThrottle()
  @Get()
  health() {
    return { status: 'ok' };
  }
}
