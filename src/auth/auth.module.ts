import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { Usuario } from '../entities/usuario.entity';
import { Rol } from '../entities/rol.entity';
import { RefreshToken } from '../entities/refresh-token.entity';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './jwt.strategy';
import { EmailService, EmailServiceSimulado, EmailServiceReal } from './email.service';
import { RolesPermisosService } from './roles-permisos.service';
import { RolesService } from './roles.service';
import { RolesController } from './roles.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([Usuario, Rol, RefreshToken]),
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'fiumicello-dev-secret-change-me',
      signOptions: { expiresIn: (process.env.JWT_EXPIRES_IN || '12h') as unknown as number },
    }),
  ],
  controllers: [AuthController, RolesController],
  providers: [
    AuthService,
    JwtStrategy,
    RolesPermisosService,
    RolesService,
    // EmailService: usa Resend (real) si hay RESEND_TOKEN; si no, simulado
    // (loguea el código) para no romper el registro en entornos sin correo.
    {
      provide: EmailService,
      useFactory: () =>
        (process.env.RESEND_TOKEN || '').trim()
          ? new EmailServiceReal()
          : new EmailServiceSimulado(),
    },
  ],
  exports: [AuthService, RolesPermisosService, RolesService],
})
export class AuthModule {}