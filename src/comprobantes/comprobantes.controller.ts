import { Controller, Get, Query, Param, ParseIntPipe } from '@nestjs/common';
import { ComprobantesService, ComprobantesFiltros } from './comprobantes.service';

@Controller('comprobantes')
export class ComprobantesController {
  constructor(private readonly comprobantes: ComprobantesService) {}

	  @Get()
	findAll(@Query() q: ComprobantesFiltros) {

  return this.comprobantes.findAll(q);
  }

	  @Get(':id')
	findOne(@Param('id', ParseIntPipe) id: number) {
  return this.comprobantes.findOne(id);
  }
}