import { Controller, Get, Query } from '@nestjs/common';
import { GastosService } from './gastos.service';

@Controller('gastos')
export class GastosController {
  constructor(private readonly gastos: GastosService) {}

	  @Get('resumen')
	resumen(@Query('agrupar') agrupar?: string) {
  return this.gastos.resumen(agrupar ?? 'total');
  }

	  @Get('por-categoria')
	porCategoria() {
  return this.gastos.porCategoria();
  }

	  @Get('total')
	total() {
  return this.gastos.total();
  }
}