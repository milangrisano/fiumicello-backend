import { Controller, Get } from '@nestjs/common';
import { APP_VERSION } from './app-version';
import { Public } from './auth/public.decorator';

@Controller('health')
export class HealthController {
  // Endpoint público (sin token): el frontend lo consulta desde el login para
  // verificar la versión del backend.
  @Public()
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