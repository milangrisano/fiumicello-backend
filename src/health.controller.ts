import { Controller, Get } from '@nestjs/common';

@Controller('health')
export class HealthController {
  @Get()
  health() {
    return { status: 'ok', servicio: 'fiumicello-backend', tiempo: new Date().toISOString() };
  }
}