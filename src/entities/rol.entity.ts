import { Entity, PrimaryGeneratedColumn, Column, Unique, DeleteDateColumn } from 'typeorm';

/**
 * A configurable role. Holds its name and the set of permissions assigned to it.
 * Users reference a role by `nombre` (repeated string, simple model).
 *
 * The `superadmin` role is implicit and always has all permissions; it may or
 * may not be present as a row.
 */
@Entity('roles')
// La Unique de nombre se quitó para permitir soft-delete (recrear un rol con
// el mismo nombre tras marcarlo deleted_at) — el borrado es lógico, no físico.
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

  // Soft delete (los usuarios pueden seguir referenciando el nombre si no se
  // reutiliza; se excluye de listas normales).
  @DeleteDateColumn({ type: 'timestamptz', nullable: true })
  deleted_at?: Date | null;

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