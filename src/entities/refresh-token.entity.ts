import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Refresh tokens de sesión (OAuth-style, seguro).
 *
 * Solo se guarda el HASH del token opaco (nunca en claro). Cada uso ROTA el
 * token: el usado queda marcado como reemplazado por uno nuevo. Si llega un
 * token ya rotado/revocado (reuso), se revoca TODA la cadena del usuario
 * (detección de reuso).
 */
@Entity('refresh_tokens')
@Index(['idUsuario'])
export class RefreshToken {
  @PrimaryGeneratedColumn()
  id: number;

  // Id del usuario dueño de la sesión (FK lógica a usuarios.id).
  @Column({ type: 'int', name: 'id_usuario' })
  idUsuario: number;

  // Hash SHA-256 del token opaco. Nunca se guarda el token en claro.
  @Column({ type: 'text', unique: true })
  token_hash: string;

  // Expiración del refresh token (ISO). Independiente del JWT de acceso.
  @Column({ type: 'text' })
  expira: string;

  // Id del refresh que lo reemplazó (rotación). Null si es la cabeza actual.
  @Column({ type: 'int', nullable: true, name: 'reemplazado_por' })
  reemplazadoPor: number | null;

  // Logout explícito o cadena comprometida por reuso.
  @Column({ type: 'boolean', default: false })
  revocado: boolean;

  @Column({ type: 'text', nullable: true, name: 'created_at' })
  createdAt: string | null;
}