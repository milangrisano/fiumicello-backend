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
  Query,
} from '@nestjs/common';
import { PedidosService, CreatePedidoInput, AddItemInput } from './pedidos.service';
import { RequirePermiso } from '../auth/permiso.decorator';
import { PERMISSIONS } from '../auth/permissions';
import { CurrentUser, JwtUser } from '../auth/current-user.decorator';

@Controller('pedidos')
export class PedidosController {
  constructor(private readonly pedidos: PedidosService) {}

  @Post()
  @RequirePermiso(PERMISSIONS.ventas_crear)
  @HttpCode(HttpStatus.CREATED)
  crear(@Body() body: CreatePedidoInput, @CurrentUser() user: JwtUser) {
    return this.pedidos.crear(body, user?.id || 0);
  }

  // ---- Cocina (cola) ----
  /** Comandas en cocina: todas, con estado_cocina (para que cocinero y mesero vean los 4 estados). */
  @Get('cocina/cola')
  @RequirePermiso(PERMISSIONS.cocina_ver)
  cola() {
    return this.pedidos.colaCocina();
  }

  /** Avanzar/cambiar el estado de cocina de una comanda (cocinero: recibida->preparando->lista; mesero: retirada). */
  @Post(':id/cocina')
  @RequirePermiso(PERMISSIONS.cocina_actualizar)
  cambiarEstadoCocina(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { estado_cocina: string },
  ) {
    return this.pedidos.cambiarEstadoCocina(id, body.estado_cocina || '');
  }

  @Get()
  @RequirePermiso(PERMISSIONS.ventas_ver)
  listar(
    @Query('estado') estado?: string,
    @Query('escenario') escenario?: string,
    @Query('id_turno') idTurno?: string,
  ) {
    return this.pedidos.listar(estado, escenario, idTurno ? Number(idTurno) : undefined);
  }

  @Get(':id')
  @RequirePermiso(PERMISSIONS.ventas_ver)
  obtener(@Param('id', ParseIntPipe) id: number) {
    return this.pedidos.obtener(id);
  }

  @Post(':id/items')
  @RequirePermiso(PERMISSIONS.ventas_crear)
  agregarItems(@Param('id', ParseIntPipe) id: number, @Body() body: { items: AddItemInput[] }) {
    return this.pedidos.agregarItemsApi(id, body.items || []);
  }

  @Post(':id/cobrar')
  @RequirePermiso(PERMISSIONS.ventas_crear)
  cobrar(@Param('id', ParseIntPipe) id: number, @Body() body: { id_forma_pago?: number | null }) {
    return this.pedidos.cobrar(id, body.id_forma_pago);
  }

  @Post(':id/entregar')
  @RequirePermiso(PERMISSIONS.ventas_crear)
  entregar(@Param('id', ParseIntPipe) id: number) {
    return this.pedidos.entregar(id);
  }

  @Delete(':id')
  @RequirePermiso(PERMISSIONS.ventas_crear)
  @HttpCode(HttpStatus.OK)
  cancelar(@Param('id', ParseIntPipe) id: number) {
    return this.pedidos.cancelar(id);
  }
}