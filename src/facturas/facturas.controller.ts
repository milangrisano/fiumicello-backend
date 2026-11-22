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
import { FacturasService, FacturasFiltros } from './facturas.service';
import { CreateFacturaDto, UpdateFacturaDto } from './dto/factura.dto';
import { Roles } from '../auth/roles.decorator';
import { RequirePermiso } from '../auth/permiso.decorator';
import { PERMISSIONS } from '../auth/permissions';

@Controller('facturas')
export class FacturasController {
  constructor(private readonly facturas: FacturasService) {}

  @Get()
  @RequirePermiso(PERMISSIONS.facturas_ver)
  findAll(@Query() q: FacturasFiltros) {
    return this.facturas.findAll(q);
  }

  @Get('items')
  @RequirePermiso(PERMISSIONS.facturas_ver)
  todosItems(@Query() q: { desde?: string; hasta?: string; q?: string }) {
    return this.facturas.todosItems(q.desde, q.hasta, q.q);
  }

  @Get(':id')
  @RequirePermiso(PERMISSIONS.facturas_ver)
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.facturas.findOne(id);
  }

  @Get(':id/items')
  @RequirePermiso(PERMISSIONS.facturas_ver)
  findItems(@Param('id', ParseIntPipe) id: number) {
    return this.facturas.findItems(id);
  }

  @Post()
  @RequirePermiso(PERMISSIONS.facturas_crear)
  create(@Body() dto: CreateFacturaDto) {
    return this.facturas.create(dto);
  }

  @Put(':id')
  @RequirePermiso(PERMISSIONS.facturas_editar)
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateFacturaDto) {
    return this.facturas.update(id, dto);
  }

  @Delete(':id')
  @Roles('superadmin', 'admin')
  @RequirePermiso(PERMISSIONS.facturas_eliminar)
  @HttpCode(HttpStatus.OK)
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.facturas.remove(id);
  }
}