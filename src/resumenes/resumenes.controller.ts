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
  ) {
    const p = ['año', 'mes', 'semana', 'día'].includes(periodo || '')
      ? (periodo as 'año' | 'mes' | 'semana' | 'día')
      : 'día';
    return this.resumenes.resumen(p, referencia);
  }
}