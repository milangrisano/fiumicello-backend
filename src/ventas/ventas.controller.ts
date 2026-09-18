import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { VentasService, CreateVentaInput } from './ventas.service';
import { RequirePermiso } from '../auth/permiso.decorator';
import { PERMISSIONS } from '../auth/permissions';
import { SUPERADMIN_ROLE } from '../auth/permissions';
import { CurrentUser, JwtUser } from '../auth/current-user.decorator';

@Controller('ventas')
export class VentasController {
  constructor(private readonly ventas: VentasService) {}

  // ---- Payment methods (editable catalog) — declared BEFORE /ventas/:id so
  // that 'formas-pago' is not captured as an :id by the numeric pipe. ----
  @Get('formas-pago')
  @RequirePermiso(PERMISSIONS.ventas_ver)
  formasPago() {
    return this.ventas.listarFormasPago();
  }

  @Post('formas-pago')
  @RequirePermiso(PERMISSIONS.ventas_crear)
  @HttpCode(HttpStatus.CREATED)
  crearFormaPago(@Body() b: { nombre?: string }) {
    return this.ventas.crearFormaPago(b.nombre || '');
  }

  @Put('formas-pago/:id')
  @RequirePermiso(PERMISSIONS.ventas_crear)
  actualizarFormaPago(
    @Param('id', ParseIntPipe) id: number,
    @Body() b: { nombre?: string; activo?: boolean },
  ) {
    return this.ventas.actualizarFormaPago(id, b.nombre || '', b.activo);
  }

  @Delete('formas-pago/:id')
  @RequirePermiso(PERMISSIONS.ventas_crear)
  @HttpCode(HttpStatus.OK)
  eliminarFormaPago(@Param('id', ParseIntPipe) id: number) {
    return this.ventas.eliminarFormaPago(id);
  }

  // ---- Sales ----
  @Post()
  @RequirePermiso(PERMISSIONS.ventas_crear)
  @HttpCode(HttpStatus.CREATED)
  crear(@Body() body: CreateVentaInput, @CurrentUser() user: JwtUser) {
    return this.ventas.crear(body, user?.id || 0);
  }

  @Get()
  @RequirePermiso(PERMISSIONS.ventas_ver)
  listar(
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Query('id_turno') idTurno?: string,
  ) {
    return this.ventas.listar(
      limit ? parseInt(limit, 10) : 500,
      offset ? parseInt(offset, 10) : 0,
      idTurno ? parseInt(idTurno, 10) : undefined,
    );
  }

  @Get(':id')
  @RequirePermiso(PERMISSIONS.ventas_ver)
  obtener(@Param('id', ParseIntPipe) id: number) {
    return this.ventas.obtener(id);
  }

  @Patch(':id/anular')
  @RequirePermiso(PERMISSIONS.ventas_eliminar)
  anular(@Param('id', ParseIntPipe) id: number) {
    return this.ventas.anular(id);
  }

  // Borrado físico: SOLO superadmin (no usa @RequirePermiso, validamos rol).
  @Delete(':id')
  eliminar(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: JwtUser) {
    if (user?.rol !== SUPERADMIN_ROLE) {
      throw new ForbiddenException('Solo el super administrador puede eliminar ventas.');
    }
    return this.ventas.eliminar(id);
  }
}