import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { Usuario } from '../entities/usuario.entity';
import { Rol } from '../entities/rol.entity';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './jwt.strategy';
import { EmailService, EmailServiceSimulado } from './email.service';
import { RolesPermisosService } from './roles-permisos.service';
import { RolesService } from './roles.service';
import { RolesController } from './roles.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([Usuario, Rol]),
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
    // EmailService with the simulated implementation active for now.
    { provide: EmailService, useClass: EmailServiceSimulado },
  ],
  exports: [AuthService, RolesPermisosService, RolesService],
})
export class AuthModule {}