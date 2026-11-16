import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { Request, Response } from 'express';
import { JwtService } from '@nestjs/jwt';
import { AppModule } from './app.module';
import { SnapshotService } from './snapshot/snapshot.service';
import { AuthService } from './auth/auth.service';

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
      forbidNonWhitelisted: true,
    }),
  );
  const port = parseInt(process.env.PORT || '3000', 10);

  // ---- Swagger UI (documentación de la API) ----
  // Ruta: /api/docs. PROTEGIDA con middleware propio: solo entra quien manda
  // un JWT de admin/superadmin (o token de servicio) como ?token=JWT o
  // Authorization: Bearer. Tras validar, se setea una cookie firmada (12h)
  // para que la UI cargue sus assets (css/js) sin repetir el token.
  if ((process.env.ENABLE_SWAGGER || 'true') === 'true') {
    const jwtSvc = app.get(JwtService);
    const authSvc = app.get(AuthService);
    const secret = process.env.JWT_SECRET || '';
    const firmarCookie = (): string => {
      const exp = Date.now() + 12 * 3600 * 1000;
      const sig = require('crypto')
        .createHmac('sha256', secret)
        .update(`swagger:${exp}`)
        .digest('hex');
      return `swagger_ok=${exp}.${sig}; Path=/api/docs; HttpOnly; SameSite=Lax; Max-Age=43200`;
    };
    const cookieOk = (req: Request): boolean => {
      const raw: string = req.headers?.cookie ?? '';
      for (const part of raw.split(';')) {
        const eq = part.indexOf('=');
        if (eq < 0) continue;
        const k = part.slice(0, eq).trim();
        if (k !== 'swagger_ok') continue;
        const v = part.slice(eq + 1).trim();
        const dot = v.indexOf('.');
        if (dot < 0) return false;
        const exp = parseInt(v.slice(0, dot), 10);
        if (!exp || exp < Date.now()) return false;
        const sig = require('crypto')
          .createHmac('sha256', secret)
          .update(`swagger:${exp}`)
          .digest('hex');
        return sig === v.slice(dot + 1);
      }
      return false;
    };
    const puedeVer = async (req: Request): Promise<boolean> => {
      if (cookieOk(req)) return true;
      const header: string | undefined = req.headers?.authorization;
      const token =
        (typeof req.query?.token === 'string' ? (req.query.token as string) : '') ||
        (header && header.startsWith('Bearer ') ? header.slice(7) : '');
      if (!token) return false;
      // JWT de interfaz: rol admin/superadmin.
      if (token.split('.').length === 3) {
        try {
          const payload = await jwtSvc.verifyAsync(token);
          return payload?.rol === 'superadmin' || payload?.rol === 'admin';
        } catch {
          return false;
        }
      }
      // Token de servicio (herb, n8n...): autorizado por su propio token.
      const svc = await authSvc.findByApiToken(token);
      return !!(svc && svc.estado === 'aprobado');
    };
    const config = new DocumentBuilder()
      .setTitle('Fiumicello API')
      .setDescription('Backend del restaurante La Vera Trattoria — facturación, POS, caja, carta, contabilidad.')
      .setVersion(require('./app-version').APP_VERSION)
      .addBearerAuth(
        { type: 'http', scheme: 'bearer', bearerFormat: 'JWT', description: 'Pega el access_token (login)' },
        'access-token',
      )
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('docs', app, document, {
      swaggerOptions: {
        persistAuthorization: true,
        docExpansion: 'none',
      },
    });
    // Middleware de protección sobre /api/docs y sus assets.
    app.use('/docs', async (req: Request, res: Response, next: () => void) => {
      try {
        if (await puedeVer(req)) {
          if (!cookieOk(req)) {
            res.setHeader('Set-Cookie', firmarCookie());
          }
          return next();
        }
      } catch {
        /* cae al 401 */
      }
      res.status(401).send('Swagger protegido: manda ?token=JWT o Authorization: Bearer.');
    });
    console.log(`📚 Swagger UI: http://0.0.0.0:${port}/api/docs (protegido)`);
  }

  await app.listen(port, '0.0.0.0');
  console.log(`🚀 API Fiumicello corriendo en http://0.0.0.0:${port}`);
}
bootstrap();