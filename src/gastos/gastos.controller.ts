import { Controller, Get, Query } from '@nestjs/common';
import { GastosService } from './gastos.service';
import { RequirePermiso } from '../auth/permiso.decorator';
import { PERMISSIONS } from '../auth/permissions';

@Controller('gastos')
export class GastosController {
  constructor(private readonly gastos: GastosService) {}

	@Get('resumen')
	@RequirePermiso(PERMISSIONS.resumenes_ver)
	resumen(@Query('agrupar') agrupar?: string) {
  return this.gastos.resumen(agrupar ?? 'total');
  }

	@Get('por-categoria')
	@RequirePermiso(PERMISSIONS.resumenes_ver)
	porCategoria() {
  return this.gastos.porCategoria();
  }

	@Get('total')
	@RequirePermiso(PERMISSIONS.resumenes_ver)
	total() {
  return this.gastos.total();
  }
}