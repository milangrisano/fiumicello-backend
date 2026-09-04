import { Entity, PrimaryGeneratedColumn, Column, Unique } from 'typeorm';

export type UserRole = 'superadmin' | 'admin' | 'editor';
export type UserStatus = 'pendiente' | 'aprobado' | 'desactivado';

/**
 * Usuarios.
 *
 * Human accounts: identified by `email` (= username), password stored ONLY as
 * bcrypt hash, verified by a one-time 6-digit code, and gated by an approval
 * state (`pendiente` -> `aprobado`).
 *
 * Service accounts (e.g. the `herb` agent): identified by a long random
 * `api_token_hash`. They need no email/password. The token is shown once when
 * generated and stored only as a hash; it can be rotated/revoked by a
 * superadmin.
 */
@Entity('usuarios')
@Unique(['email'])
@Unique(['api_token_hash'])
export class Usuario {
  @PrimaryGeneratedColumn()
  id: number;

  // Human identity (unique). Nullable because service accounts have no email.
  @Column({ type: 'text', nullable: true })
  email: string | null;

  // bcrypt hash; never plaintext. Service accounts may omit it.
  @Column({ type: 'text', nullable: true })
  password_hash: string | null;

  @Column({ type: 'text', nullable: false, default: 'editor' })
  rol: UserRole;

  // Human: pendiente -> aprobado (superadmin approves). Service: aprobado.
  @Column({ type: 'text', nullable: false, default: 'pendiente' })
  estado: UserStatus;

  @Column({ type: 'boolean', nullable: false, default: false })
  email_verified: boolean;

  // One-time email verification code (6 digits) + expiry.
  @Column({ type: 'text', nullable: true })
  codigo_verificacion: string | null;
  @Column({ type: 'text', nullable: true })
  codigo_expiracion: string | null;

  // Password reset token + expiry.
  @Column({ type: 'text', nullable: true })
  reset_token: string | null;
  @Column({ type: 'text', nullable: true })
  reset_token_expires: string | null;

  // Service account token (stored as hash). Shown once on generation.
  @Column({ type: 'text', nullable: true })
  api_token_hash: string | null;
  // Human-readable name for the service (e.g. "herb").
  @Column({ type: 'text', nullable: true })
  nombre_servicio: string | null;

  @Column({ type: 'text', nullable: true })
  created_at: string | null;
}