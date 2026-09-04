import { Controller, Get, Query, Param, ParseIntPipe } from '@nestjs/common';
import { FacturasService, FacturasFiltros } from './facturas.service';

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
}