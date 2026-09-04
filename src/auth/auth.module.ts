import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { Usuario } from '../entities/usuario.entity';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './jwt.strategy';
import { EmailService, EmailServiceSimulado } from './email.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Usuario]),
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'fiumicello-dev-secret-change-me',
      signOptions: { expiresIn: (process.env.JWT_EXPIRES_IN || '12h') as unknown as number },
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    JwtStrategy,
    // EmailService with the simulated implementation active for now.
    // Swap to EmailServiceReal when a real SMTP/provider is configured.
    { provide: EmailService, useClass: EmailServiceSimulado },
  ],
  exports: [AuthService],
})
export class AuthModule {}