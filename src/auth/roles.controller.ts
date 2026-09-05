import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import { RolesService } from './roles.service';
import { RolesPermisosService } from './roles-permisos.service';
import { CurrentUser, JwtUser } from './current-user.decorator';
import { RequirePermiso } from './permiso.decorator';
import { PERMISSIONS } from './permissions';

@Controller('auth/roles')
export class RolesController {
  constructor(
    private readonly roles: RolesService,
    private readonly permisosSvc: RolesPermisosService,
  ) {}

  /** Catalog of available permissions (for the admin screen). */
  @Get('catalogo')
  @RequirePermiso(PERMISSIONS.roles_gestionar)
  catalogo() {
    return this.permisosSvc.catalogo();
  }

  @Get()
  @RequirePermiso(PERMISSIONS.roles_gestionar)
  listar() {
    return this.roles.listar();
  }

  @Post()
  @RequirePermiso(PERMISSIONS.roles_gestionar)
  @HttpCode(HttpStatus.CREATED)
  crear(
    @CurrentUser() user: JwtUser,
    @Body() body: { nombre: string; descripcion?: string; permisos?: string[] },
  ) {
    return this.roles.crear(user.rol, body.nombre, body.descripcion || null, body.permisos || []);
  }

  @Put(':nombre')
  @RequirePermiso(PERMISSIONS.roles_gestionar)
  actualizar(
    @CurrentUser() user: JwtUser,
    @Param('nombre') nombre: string,
    @Body() body: { nombre?: string; descripcion?: string; permisos?: string[] },
  ) {
    return this.roles.actualizar(
      user.rol,
      nombre,
      body.nombre || nombre,
      body.descripcion ?? null,
      body.permisos ?? [],
    );
  }

  @Delete(':nombre')
  @RequirePermiso(PERMISSIONS.roles_gestionar)
  @HttpCode(HttpStatus.OK)
  eliminar(@CurrentUser() user: JwtUser, @Param('nombre') nombre: string) {
    return this.roles.eliminar(user.rol, nombre);
  }
}