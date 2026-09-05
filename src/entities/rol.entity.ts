import { Entity, PrimaryGeneratedColumn, Column, Unique } from 'typeorm';

/**
 * A configurable role. Holds its name and the set of permissions assigned to it.
 * Users reference a role by `nombre` (repeated string, simple model).
 *
 * The `superadmin` role is implicit and always has all permissions; it may or
 * may not be present as a row.
 */
@Entity('roles')
@Unique(['nombre'])
export class Rol {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'text', nullable: false })
  nombre: string;

  @Column({ type: 'text', nullable: true })
  descripcion: string | null;

  /**
   * JSON array of permission strings, e.g. ["facturas:ver","ventas:crear"].
   */
  @Column({ type: 'text', nullable: false, default: '[]' })
  permisos_json: string;

  // Base roles are seeded; custom roles are user-created.
  @Column({ type: 'boolean', nullable: false, default: false })
  es_base: boolean;

  @Column({ type: 'text', nullable: true })
  created_at: string | null;

  /** Convenience accessor for the permission array. */
  get permisos(): string[] {
    try {
      const arr = JSON.parse(this.permisos_json);
      return Array.isArray(arr) ? arr : [];
    } catch {
      return [];
    }
  }

  set permisos(list: string[]) {
    this.permisos_json = JSON.stringify(list || []);
  }
}