import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Rol } from '../entities/rol.entity';
import { PERMISSION_DEFS, PERMISSIONS, SUPERADMIN_ROLE } from './permissions';

/**
 * Resolves which permissions a user has based on their role.
 *
 * Superadmin implicitly has ALL permissions. Other roles read their permission
 * list from the `roles` table. A role with no row or empty list gets nothing.
 */
@Injectable()
export class RolesPermisosService {
  constructor(
    @InjectRepository(Rol)
    private readonly roles: Repository<Rol>,
  ) {}

  async permisosParaRol(nombreRol: string | null | undefined): Promise<string[]> {
    if (!nombreRol) return [];
    if (nombreRol === SUPERADMIN_ROLE) {
      return PERMISSION_DEFS.map((p) => p.key);
    }
    const rol = await this.roles.findOneBy({ nombre: nombreRol });
    return rol ? rol.permisos : [];
  }

  /** All permission keys the user currently has (for their role). */
  async permisosDeUsuario(userRol: string | null | undefined): Promise<string[]> {
    return this.permisosParaRol(userRol);
  }

  async tienePermiso(
    userRol: string | null | undefined,
    permiso: string,
  ): Promise<boolean> {
    const perms = await this.permisosParaRol(userRol);
    return perms.includes(permiso);
  }

  /** Ordered catalog the admin screen uses to build its checkboxes. */
  catalogo(): typeof PERMISSION_DEFS {
    return PERMISSION_DEFS;
  }

  allPermissionKeys(): string[] {
    return Object.values(PERMISSIONS);
  }
}