import { Controller, Get, Post, Body, Param, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RequirePermiso } from '../auth/permiso.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { PERMISSIONS } from '../auth/permissions';
import { TurnosCajaService } from './turnos-caja.service';
import { MovimientosCajaService } from './movimientos-caja.service';
import { PagosPropinaService } from './pagos-propina.service';

@Controller('caja')
@UseGuards(AuthGuard('jwt'))
export class TurnosCajaController {
  constructor(
    private turnos: TurnosCajaService,
    private movs: MovimientosCajaService,
    private pagosPropina: PagosPropinaService,
  ) {}

  /** Turno abierto del usuario actual (o null). */
  @Get('activo')
  @RequirePermiso(PERMISSIONS.caja_ver)
  async activo(@CurrentUser() u: { id: number }) {
    return this.turnos.abierto(u.id);
  }

  /** Abrir caja con efectivo inicial. */
  @Post('abrir')
  @RequirePermiso(PERMISSIONS.caja_abrir)
  async abrir(@CurrentUser() u: { id: number }, @Body() body: { efectivo_inicial: number }) {
    return this.turnos.abrir(u.id, Number(body.efectivo_inicial ?? 0));
  }

  /** Arqueo del turno. */
  @Get(':id/arqueo')
  @RequirePermiso(PERMISSIONS.caja_ver)
  async arqueo(@Param('id') id: string) {
    return this.turnos.arqueo(Number(id));
  }

  /** Cerrar turno. BLOQUEA si hay faltante. */
  @Post(':id/cerrar')
  @RequirePermiso(PERMISSIONS.caja_cerrar)
  async cerrar(
    @Param('id') id: string,
    @Body() body: { efectivo_final: number; propina_efectivo: number; propina_otros: number },
  ) {
    return this.turnos.cerrar(Number(id), Number(body.efectivo_final), Number(body.propina_efectivo ?? 0), Number(body.propina_otros ?? 0));
  }

  @Get('turnos')
  @RequirePermiso(PERMISSIONS.caja_ver)
  async listar() {
    return this.turnos.listar();
  }

  // --- Movimientos ---
  @Post('movimiento/egreso')
  @RequirePermiso(PERMISSIONS.caja_movimientos)
  async egreso(@CurrentUser() u: { id: number }, @Body() b: { id_turno: number; concepto: string; monto: number }) {
    return this.movs.egreso(Number(b.id_turno), b.concepto, Number(b.monto), u.id);
  }

  @Post('movimiento/ingreso')
  @RequirePermiso(PERMISSIONS.caja_movimientos)
  async ingreso(
    @CurrentUser() u: { id: number },
    @Body() b: { id_turno: number; concepto: string; monto: number; autorizado_por: number },
  ) {
    return this.movs.ingreso(Number(b.id_turno), b.concepto, Number(b.monto), Number(b.autorizado_por), u.id);
  }

  @Get('movimiento/:id_turno')
  @RequirePermiso(PERMISSIONS.caja_ver)
  async movimientos(@Param('id_turno') idTurno: string) {
    return this.movs.listar(Number(idTurno));
  }

  // --- Pagos de propina ---
  @Post('propina/pago')
  @RequirePermiso(PERMISSIONS.propina_pagar)
  async pagarPropina(@CurrentUser() u: { id: number }, @Body() b: { fecha_pago: string; monto_efectivo: number; monto_otros: number; turnos_desde?: number; turnos_hasta?: number; notas?: string }) {
    return this.pagosPropina.registrar({
      fecha_pago: b.fecha_pago,
      monto_efectivo: Number(b.monto_efectivo ?? 0),
      monto_otros: Number(b.monto_otros ?? 0),
      turnos_desde: b.turnos_desde ?? null,
      turnos_hasta: b.turnos_hasta ?? null,
      quien_registra: u.id,
      notas: b.notas ?? null,
    });
  }

  @Get('propina/pagos')
  @RequirePermiso(PERMISSIONS.propina_pagar)
  async listarPagosPropina() {
    return this.pagosPropina.listar();
  }
}
