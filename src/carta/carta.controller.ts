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
} from '@nestjs/common';
import { CartaService } from './carta.service';
import { Public } from '../auth/public.decorator';
import { RequirePermiso } from '../auth/permiso.decorator';
import { PERMISSIONS } from '../auth/permissions';

@Controller('carta')
export class CartaController {
  constructor(private readonly carta: CartaService) {}

  /** Public menu — anyone (even logged-out visitors) can see the carta. */
  @Public()
  @Get()
  ver() {
    return this.carta.obtenerCarta();
  }

  /** Admin: all products (active + disabled) for the products page. */
  @Get('administracion')
  @RequirePermiso(PERMISSIONS.carta_editar)
  administracion() {
    return this.carta.obtenerCartaAdmin();
  }

  // ---- Admin CRUD (SuperAdmin/Admin with carta:editar) ----

  @Post('categorias')
  @RequirePermiso(PERMISSIONS.carta_editar)
  @HttpCode(HttpStatus.CREATED)
  crearCategoria(@Body() b: { nombre: string; orden?: number }) {
    return this.carta.crearCategoria(b.nombre, b.orden);
  }

  @Put('categorias/:id')
  @RequirePermiso(PERMISSIONS.carta_editar)
  actualizarCategoria(@Param('id', ParseIntPipe) id: number, @Body() b: { nombre: string; orden?: number }) {
    return this.carta.actualizarCategoria(id, b.nombre, b.orden);
  }

  @Delete('categorias/:id')
  @RequirePermiso(PERMISSIONS.carta_editar)
  @HttpCode(HttpStatus.OK)
  eliminarCategoria(@Param('id', ParseIntPipe) id: number) {
    return this.carta.eliminarCategoria(id);
  }

  @Post('items')
  @RequirePermiso(PERMISSIONS.carta_editar)
  @HttpCode(HttpStatus.CREATED)
  crearItem(@Body() b: Record<string, unknown>) {
    return this.carta.crearItem(b as never);
  }

  @Put('items/:id')
  @RequirePermiso(PERMISSIONS.carta_editar)
  actualizarItem(@Param('id', ParseIntPipe) id: number, @Body() b: Record<string, unknown>) {
    return this.carta.actualizarItem(id, b as never);
  }

  @Delete('items/:id')
  @RequirePermiso(PERMISSIONS.carta_editar)
  @HttpCode(HttpStatus.OK)
  eliminarItem(@Param('id', ParseIntPipe) id: number) {
    return this.carta.eliminarProducto(id);
  }

  // ---- Product lifecycle: enable/disable ----
  @Post('items/:id/toggle')
  @RequirePermiso(PERMISSIONS.carta_editar)
  @HttpCode(HttpStatus.OK)
  toggleActivo(@Param('id', ParseIntPipe) id: number) {
    return this.carta.toggleActivo(id);
  }
}