import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { Usuario } from '../entities/usuario.entity';
import { Rol } from '../entities/rol.entity';
import { RefreshToken } from '../entities/refresh-token.entity';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './jwt.strategy';
import { requireEnv } from '../common/env';
import { EmailService, EmailServiceSimulado, EmailServiceReal } from './email.service';
import { RolesPermisosService } from './roles-permisos.service';
import { RolesService } from './roles.service';
import { RolesController } from './roles.controller';
import { RealtimeModule } from '../realtime/realtime.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Usuario, Rol, RefreshToken]),
    JwtModule.register({
      secret: requireEnv('JWT_SECRET', 'secreto de firma JWT'),
      signOptions: { expiresIn: (process.env.JWT_EXPIRES_IN || '12h') as unknown as number },
    }),
    RealtimeModule,
  ],
  controllers: [AuthController, RolesController],
  providers: [
    AuthService,
    JwtStrategy,
    RolesPermisosService,
    RolesService,
    // EmailService: PRODUCCIÓN siempre usa el real (Resend) — si falta
    // RESEND_TOKEN, EmailServiceReal hace fail-fast y el backend NO arranca
    // (jamás filtra códigos OTP por logs). El simulado (loguea el código) solo
    // existe en dev/test para no romper el registro sin correo real.
    {
      provide: EmailService,
      useFactory: () =>
        process.env.NODE_ENV === 'production'
          ? new EmailServiceReal() // fail-fast si falta RESEND_TOKEN
          : new EmailServiceSimulado(),
    },
  ],
  exports: [AuthService, RolesPermisosService, RolesService],
})
export class AuthModule {}