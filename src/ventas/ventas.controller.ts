import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { VentasService, CreateVentaInput } from './ventas.service';
import { RequirePermiso } from '../auth/permiso.decorator';
import { PERMISSIONS } from '../auth/permissions';
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
  listar(@Query('limit') limit?: string, @Query('offset') offset?: string) {
    return this.ventas.listar(
      limit ? parseInt(limit, 10) : 50,
      offset ? parseInt(offset, 10) : 0,
    );
  }

  @Get(':id')
  @RequirePermiso(PERMISSIONS.ventas_ver)
  obtener(@Param('id', ParseIntPipe) id: number) {
    return this.ventas.obtener(id);
  }
}