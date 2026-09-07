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

  @Get()
  @RequirePermiso(PERMISSIONS.ventas_ver)
  listar(@Query('estado') estado?: string, @Query('escenario') escenario?: string) {
    return this.pedidos.listar(estado, escenario);
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