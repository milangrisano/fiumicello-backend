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
import { ComprobantesService, ComprobantesFiltros } from './comprobantes.service';
import { CreateComprobanteDto, UpdateComprobanteDto } from './dto/comprobante.dto';
import { Roles } from '../auth/roles.decorator';
import { RequirePermiso } from '../auth/permiso.decorator';
import { PERMISSIONS } from '../auth/permissions';

@Controller('comprobantes')
export class ComprobantesController {
  constructor(private readonly comprobantes: ComprobantesService) {}

  @Get()
  @RequirePermiso(PERMISSIONS.facturas_ver)
  findAll(@Query() q: ComprobantesFiltros) {
    return this.comprobantes.findAll(q);
  }

  @Get(':id')
  @RequirePermiso(PERMISSIONS.facturas_ver)
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.comprobantes.findOne(id);
  }

  @Post()
  @RequirePermiso(PERMISSIONS.facturas_crear)
  create(@Body() dto: CreateComprobanteDto) {
    return this.comprobantes.create(dto);
  }

  @Put(':id')
  @RequirePermiso(PERMISSIONS.facturas_editar)
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateComprobanteDto) {
    return this.comprobantes.update(id, dto);
  }

  @Delete(':id')
  @Roles('superadmin', 'admin')
  @RequirePermiso(PERMISSIONS.facturas_eliminar)
  @HttpCode(HttpStatus.OK)
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.comprobantes.remove(id);
  }
}