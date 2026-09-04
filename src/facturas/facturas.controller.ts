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

@Controller('facturas')
export class FacturasController {
  constructor(private readonly facturas: FacturasService) {}

  @Get()
  findAll(@Query() q: FacturasFiltros) {
    return this.facturas.findAll(q);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.facturas.findOne(id);
  }

  @Get(':id/items')
  findItems(@Param('id', ParseIntPipe) id: number) {
    return this.facturas.findItems(id);
  }

  @Post()
  create(@Body() dto: CreateFacturaDto) {
    return this.facturas.create(dto);
  }

  @Put(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateFacturaDto) {
    return this.facturas.update(id, dto);
  }

  @Delete(':id')
  @Roles('superadmin', 'admin')
  @HttpCode(HttpStatus.OK)
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.facturas.remove(id);
  }
}