import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISO_KEY } from './permiso.decorator';
import { RolesPermisosService } from './roles-permisos.service';
import { SUPERADMIN_ROLE } from './permissions';
import { IS_PUBLIC_KEY } from './public.decorator';

/**
 * PermisosGuard — DENY BY DEFAULT.
 *
 * Modelo de negocio (Enrique):
 *  - La APROBACIÓN es una compuerta de entrada (aprobado entra, pendiente no);
 *    el login ya exige `estado === 'aprobado'` antes de emitir JWT, de modo que
 *    tener sesión = estar aprobado. Este guard NO vuelve a evaluar aprobación.
 *  - El ROL otorga permisos: un aprobado solo consume lo que su rol tenga.
 *  - Endpoint sin permiso declarado => DENY (solo superadmin). Ninguno queda abierto.
 *  - AUTO-GRANT: los permisos de self-service (p. ej. `auth:cambiar-clave`) se
 *    conceden a CUALQUIER usuario autenticado/aprobado, sin pasar por el rol.
 */
const AUTO_GRANT: ReadonlySet<string> = new Set([
  'auth:cambiar-clave',
  'auth:ver-mis-permisos',
]);

@Injectable()
export class PermisosGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly permisos: RolesPermisosService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Rutas públicas (@Public) quedan fuera del deny-by-default, igual que en
    // JwtAuthGuard (login, register, health, config...).
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const required = this.reflector.getAllAndOverride<string[]>(PERMISO_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const { user } = context.switchToHttp().getRequest();

    // Autenticación previa garantiza que hay usuario aprobado (ver modelo arriba).
    if (!user) throw new ForbiddenException('No se pudo determinar el usuario.');

    // Tokens de servicio (herb, n8n...) NO son usuarios comunes: se autorizan
    // por su token aprobado y los blindajes específicos de cada API (ej. OCR
    // solo para nombreServicio==='herb'). No se rigen por el sistema de roles
    // de la GUI, así que quedan fuera del deny-by-default por rol.
    if (user.nombreServicio) return true;

    // Superadmin always passes.
    if (user.rol === SUPERADMIN_ROLE) return true;

    // Deny-by-default: sin permiso declarado => bloqueado (solo superadmin).
    if (!required || required.length === 0) {
      throw new ForbiddenException('Acción sin permiso asignado. Contacte al admin.');
    }

    // Auto-grant: self-service de cualquier aprobado (NO atado a rol).
    if (required.some((p) => AUTO_GRANT.has(p))) return true;

    const userPerms = await this.permisos.permisosDeUsuario(user.rol);
    const ok = required.some((p) => userPerms.includes(p));
    if (!ok) {
      throw new ForbiddenException('No tienes permisos para esta operación.');
    }
    return true;
  }
}