import { Entity, PrimaryGeneratedColumn, Column, Unique } from 'typeorm';

export type UserRole = 'admin' | 'editor';

@Entity('usuarios')
@Unique(['username'])
export class Usuario {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'text', nullable: false })
  username: string;

  @Column({ type: 'text', nullable: false })
  password_hash: string; // bcrypt hash, never plaintext

  @Column({ type: 'text', nullable: false, default: 'editor' })
  rol: UserRole;

  @Column({ type: 'text', nullable: true })
  created_at: string | null;
}