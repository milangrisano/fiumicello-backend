import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { SnapshotService } from './snapshot/snapshot.service';

async function bootstrap() {
  // Snapshot de BD: si la versión cambió, respalda el contenido previo ANTES
  // de que TypeORM sincronice el esquema. Fail-fast si el dump falla.
  await new SnapshotService().runOnStartup();

  const app = await NestFactory.create(AppModule);

  // Headers de seguridad (CSP, X-Frame-Options, X-Content-Type-Options, HSTS).
  app.use(
    helmet({
      // En producción detrás de Cloudflare, HSTS lo gestiona Cloudflare.
      hsts: process.env.ENABLE_HSTS === 'true',
      crossOriginEmbedderPolicy: false, // desactiva COEP (bundle Flutter lo requiere)
      contentSecurityPolicy: false, // CSP lo sirve nginx
    }),
  );

  app.setGlobalPrefix('api');

  // CORS restringido al dominio real (configurable por env). Sin whitelist:
  // mismo origen (nginx sirve web y /api), así que CORS queda deshabilitado.
  const origenes = (process.env.CORS_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  app.enableCors(
    origenes.length > 0 ? { origin: origenes, credentials: true } : { origin: false },
  );
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: false,
    }),
  );
  const port = parseInt(process.env.PORT || '3000', 10);
  await app.listen(port, '0.0.0.0');
  console.log(`🚀 API Fiumicello corriendo en http://0.0.0.0:${port}`);
}
bootstrap();