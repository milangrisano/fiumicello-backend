import { Controller, Get, Query, Param, Body, Patch, HttpCode } from '@nestjs/common';
import { RequirePermiso } from '../auth/permiso.decorator';
import { ResumenesService } from './resumenes.service';

@Controller('resumenes')
export class ResumenesController {
  constructor(private readonly resumenes: ResumenesService) {}

  @Get('contable')
  @RequirePermiso('resumenes:ver')
  contable(
    @Query('periodo') periodo?: string,
    @Query('referencia') referencia?: string,
    @Query('desde') desde?: string,
    @Query('hasta') hasta?: string,
  ) {
    if (desde && hasta) {
      return this.resumenes.contable('rango', null, desde, hasta);
    }
    const p = ['año', 'mes', 'semana', 'día'].includes(periodo || '')
      ? (periodo as 'año' | 'mes' | 'semana' | 'día')
      : 'mes';
    return this.resumenes.contable(p, referencia);
  }

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

  // Asignación manual factura↔comprobante (trasabilidad del pago) vía interfaz.
  @Patch('asignar-comprobante')
  @HttpCode(200)
  @RequirePermiso('resumenes:ver')
  asignarComprobante(
    @Body('facturaId') facturaId: number,
    @Body('comprobanteId') comprobanteId: number,
  ) {
    return this.resumenes.asignarComprobante(facturaId, comprobanteId);
  }

  // Clasificación MANUAL de un comprobante (transferencia / proveedor / auto).
  @Patch('clasificar-comprobante')
  @HttpCode(200)
  @RequirePermiso('resumenes:ver')
  clasificarComprobante(
    @Body('comprobanteId') comprobanteId: number,
    @Body('tipo') tipo: 'transferencia' | 'proveedor' | null,
  ) {
    return this.resumenes.clasificarComprobante(comprobanteId, tipo ?? null);
  }
}