import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { RealtimeGateway } from './realtime.gateway';

/**
 * Módulo de tiempo real: expone el gateway Socket.IO de comandas/cocina/caja.
 * Registra JwtModule con el mismo secret que AuthModule para verificar el
 * handshake del socket. Se importa en AppModule.
 */
@Module({
  imports: [
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'fiumicello-dev-secret-change-me',
      signOptions: { expiresIn: (process.env.JWT_EXPIRES_IN || '12h') as unknown as number },
    }),
  ],
  providers: [RealtimeGateway],
  exports: [RealtimeGateway],
})
export class RealtimeModule {}