import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Rol } from '../entities/rol.entity';
import {
  PERMISSIONS,
  PERMISSION_DEFS,
  SUPERADMIN_ROLE,
} from './permissions';
import { RolesPermisosService } from './roles-permisos.service';

/**
 * The role hierarchy: higher rank = greater capability by default.
 * Used to let an Admin only manage roles "below" its own and never grant a
 * permission it does not itself have.
 */
export const ROLES_RANK: Record<string, number> = {
  superadmin: 10,
  admin: 8,
  editor: 6, // internal service role
  encargado: 5,
  cajero: 4,
  cocinero: 3,
  mesero: 2,
  ayudante: 1,
};

/** Default permissions for each seeded base role (edited later by admin). */
const DEFAULT_PERMS: Record<string, string[]> = {
  encargado: [
    PERMISSIONS.facturas_ver,
    PERMISSIONS.ventas_ver,
    PERMISSIONS.ventas_crear,
    PERMISSIONS.ventas_editar,
    PERMISSIONS.cocina_ver,
    PERMISSIONS.caja_ver,
    PERMISSIONS.caja_cerrar,
    PERMISSIONS.resumenes_ver,
    PERMISSIONS.carta_ver,
  ],
  cajero: [
    PERMISSIONS.ventas_ver,
    PERMISSIONS.ventas_crear,
    PERMISSIONS.caja_ver,
    PERMISSIONS.carta_ver,
  ],
  cocinero: [
    PERMISSIONS.cocina_ver,
    PERMISSIONS.cocina_actualizar,
    PERMISSIONS.ventas_ver,
    PERMISSIONS.carta_ver,
  ],
  mesero: [
    PERMISSIONS.ventas_ver,
    PERMISSIONS.ventas_crear,
    PERMISSIONS.carta_ver,
  ],
  ayudante: [PERMISSIONS.cocina_ver, PERMISSIONS.ventas_ver, PERMISSIONS.carta_ver],
};

@Injectable()
export class RolesService {
  constructor(
    @InjectRepository(Rol)
    private readonly roles: Repository<Rol>,
    private readonly permisosSvc: RolesPermisosService,
  ) {}

  /** Seed the 7 base roles if the roles table is empty. */
  async seedBaseRoles() {
    const count = await this.roles.count();
    if (count > 0) return;
    const now = new Date().toISOString();
    const baseNames: Array<{ nombre: string; desc: string }> = [
      { nombre: 'encargado', desc: 'Responsable de turno/sucursal' },
      { nombre: 'cajero', desc: 'Registra ventas y caja' },
      { nombre: 'cocinero', desc: 'Prepara órdenes' },
      { nombre: 'mesero', desc: 'Toma pedidos de mesa' },
      { nombre: 'ayudante', desc: 'Apoyo general' },
    ];
    await this.roles.save(
      baseNames.map((b) =>
        this.roles.create({
          nombre: b.nombre,
          descripcion: b.desc,
          permisos_json: JSON.stringify(DEFAULT_PERMS[b.nombre] || []),
          es_base: true,
          created_at: now,
        }),
      ),
    );
  }

  /** All roles (for the admin screen). */
  async listar() {
    const rows = await this.roles.find({ order: { id: 'ASC' } });
    return rows.map((r) => ({
      id: r.id,
      nombre: r.nombre,
      descripcion: r.descripcion,
      permisos: r.permisos,
      permisos_json: undefined,
      es_base: r.es_base,
    }));
  }

  async obtener(nombre: string) {
    return this.roles.findOneBy({ nombre });
  }

  /**
   * Create a role. `actorRol` is the caller's role.
   * - Anyone (not superadmin) must not name it superadmin, and can only set
   *   permissions it itself has.
   */
  async crear(
    actorRol: string,
    nombre: string,
    descripcion: string | null,
    permisos: string[],
  ) {
    const norm = (nombre || '').trim().toLowerCase();
    if (!norm) throw new BadRequestException('Nombre de rol inválido.');
    if (norm === SUPERADMIN_ROLE) {
      throw new ForbiddenException('El rol superadmin no puede crearse.');
    }
    const exist = await this.roles.findOneBy({ nombre: norm });
    if (exist) throw new BadRequestException('El rol ya existe.');

    const clean = permisos || [];
    if (actorRol !== SUPERADMIN_ROLE) {
      const actorPerms = await this.permisosSvc.permisosDeUsuario(actorRol);
      const forbidden = clean.filter((p) => !actorPerms.includes(p));
      if (forbidden.length > 0) {
        throw new ForbiddenException(
          'No puedes asignar permisos que no tienes.',
        );
      }
    }
    return this.roles.save(
      this.roles.create({
        nombre: norm,
        descripcion: descripcion || null,
        permisos_json: JSON.stringify(clean),
        es_base: false,
        created_at: new Date().toISOString(),
      }),
    );
  }

  /** Update a role (name/desc/permisos). Internal roles locked except for admin's own fine-tune? */
  async actualizar(
    actorRol: string,
    nombreOriginal: string,
    nombreNuevo: string,
    descripcion: string | null,
    permisos: string[],
  ) {
    const role = await this.roles.findOneBy({ nombre: nombreOriginal });
    if (!role) throw new NotFoundException('Rol no encontrado.');

    if (actorRol !== SUPERADMIN_ROLE) {
      const actorPerms = await this.permisosSvc.permisosDeUsuario(actorRol);
      const forbidden = (permisos || []).filter(
        (p) => !actorPerms.includes(p),
      );
      if (forbidden.length > 0) {
        throw new ForbiddenException(
          'No puedes asignar permisos que no tienes.',
        );
      }
    }

    if (nombreNuevo && nombreNuevo.trim() !== nombreOriginal) {
      const nuevo = nombreNuevo.trim().toLowerCase();
      if (nuevo === SUPERADMIN_ROLE) {
        throw new ForbiddenException('No puedes renombrar a superadmin.');
      }
      const exist = await this.roles.findOneBy({ nombre: nuevo });
      if (exist) throw new BadRequestException('El rol nuevo ya existe.');
      role.nombre = nuevo;
    }
    role.descripcion = descripcion ?? role.descripcion;
    role.permisos_json = JSON.stringify(permisos || []);
    await this.roles.save(role);
    return role;
  }

  async eliminar(actorRol: string, nombre: string) {
    if (actorRol !== SUPERADMIN_ROLE) {
      throw new ForbiddenException('Solo superadmin puede eliminar roles.');
    }
    const role = await this.roles.findOneBy({ nombre });
    if (!role) throw new NotFoundException('Rol no encontrado.');
    if (role.es_base) {
      throw new BadRequestException('No se puede eliminar un rol base.');
    }
    await this.roles.delete(role.id);
    return { ok: true };
  }
}