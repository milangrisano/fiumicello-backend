import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

/**
 * Real-time gateway (Socket.IO) that broadcasts POS events to all connected
 * clients — comandas, cocina y turno de caja — sin recarga manual.
 *
 * Corre sobre el mismo HTTP server del backend (puerto 3000). Autenticación
 * por JWT en el handshake (auth.token). No requiere Redis (una sola instancia).
 */
@WebSocketGateway({
  cors: { origin: '*', credentials: true },
})
export class RealtimeGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(RealtimeGateway.name);

  constructor(private readonly jwt: JwtService) {}

  afterInit() {
    this.logger.log('RealtimeGateway inicializado.');
  }

  /** Autentica el handshake con el JWT del payload 'token'. */
  async handleConnection(client: Socket) {
    try {
      const token = (client.handshake.auth?.token as string) ?? '';
      if (!token) {
        client.disconnect(true);
        return;
      }
      const payload = await this.jwt.verifyAsync(token);
      client.data.user = payload;
      this.logger.log(`Socket conectado: ${client.id} (${payload.email ?? payload.sub})`);
    } catch {
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Socket desconectado: ${client.id}`);
  }

  // ---- Emisores públicos ----
  emitComandaNueva(data: Record<string, unknown>) {
    this.server.emit('comanda:nueva', data);
  }

  emitCocinaEstado(data: Record<string, unknown>) {
    this.server.emit('cocina:estado', data);
  }

  emitTurnoAbierto(data: Record<string, unknown>) {
    this.server.emit('turno:abierto', data);
  }

  emitTurnoCerrado(data: Record<string, unknown>) {
    this.server.emit('turno:cerrado', data);
  }
}