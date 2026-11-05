import { Controller, Get } from '@nestjs/common';
import { APP_VERSION } from './app-version';

@Controller('health')
export class HealthController {
  @Get()
  health() {
    return {
      status: 'ok',
      servicio: 'fiumicello-backend',
      version: APP_VERSION,
      tiempo: new Date().toISOString(),
    };
  }
}