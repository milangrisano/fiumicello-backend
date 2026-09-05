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

@Injectable()
export class PermisosGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly permisos: RolesPermisosService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<string[]>(PERMISO_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    // No @RequirePermiso decorator -> any authenticated user can access.
    if (!required || required.length === 0) return true;

    const { user } = context.switchToHttp().getRequest();
    if (!user) throw new ForbiddenException('No se pudo determinar el usuario.');

    // Superadmin bypasses permission checks.
    if (user.rol === SUPERADMIN_ROLE) return true;

    const userPerms = await this.permisos.permisosDeUsuario(user.rol);
    const ok = required.some((p) => userPerms.includes(p));
    if (!ok) {
      throw new ForbiddenException('No tienes permisos para esta operación.');
    }
    return true;
  }
}