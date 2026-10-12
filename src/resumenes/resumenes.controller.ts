import { Controller, Get, Query } from '@nestjs/common';
import { RequirePermiso } from '../auth/permiso.decorator';
import { ResumenesService } from './resumenes.service';

@Controller('resumenes')
export class ResumenesController {
  constructor(private readonly resumenes: ResumenesService) {}

  @Get()
  @RequirePermiso('resumenes:ver')
  obtener(
    @Query('periodo') periodo?: string,
    @Query('referencia') referencia?: string,
    @Query('desde') desde?: string,
    @Query('hasta') hasta?: string,
  ) {
    // Rango libre (desde→hasta) tiene prioridad si ambos llegan.
    if (desde && hasta) {
      return this.resumenes.resumen('rango', null, desde, hasta);
    }
    const p = ['año', 'mes', 'semana', 'día'].includes(periodo || '')
      ? (periodo as 'año' | 'mes' | 'semana' | 'día')
      : 'día';
    return this.resumenes.resumen(p, referencia);
  }

  @Get('ultima-fecha')
  @RequirePermiso('resumenes:ver')
  ultimaFecha() {
    return this.resumenes.ultimaFecha();
  }
}