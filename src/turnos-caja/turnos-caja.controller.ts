import { Controller, Get, Post, Body, Param, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RequirePermiso } from '../auth/permiso.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { PERMISSIONS } from '../auth/permissions';
import { TurnosCajaService } from './turnos-caja.service';
import { MovimientosCajaService } from './movimientos-caja.service';
import { PagosPropinaService } from './pagos-propina.service';
import {
  AbrirTurnoDto,
  CerrarTurnoDto,
  MovimientoCajaDto,
  PagarPropinaDto,
} from './dto/turnos-caja.dto';

@Controller('caja')
@UseGuards(AuthGuard('jwt'))
export class TurnosCajaController {
  constructor(
    private turnos: TurnosCajaService,
    private movs: MovimientosCajaService,
    private pagosPropina: PagosPropinaService,
  ) {}

  /** Turno abierto del restaurante (para que todos lo vean). Quien lo abrió es el responsable del cierre. */
  @Get('activo')
  @RequirePermiso(PERMISSIONS.caja_ver)
  async activo() {
    return this.turnos.activo();
  }

  /** Abrir caja con efectivo inicial. */
  @Post('abrir')
  @RequirePermiso(PERMISSIONS.caja_abrir)
  async abrir(@CurrentUser() u: { id: number }, @Body() body: AbrirTurnoDto) {
    return this.turnos.abrir(u.id, body.efectivo_inicial);
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
    @Body() body: CerrarTurnoDto,
  ) {
    return this.turnos.cerrar(Number(id), body.efectivo_final, body.propina_efectivo ?? 0, body.propina_otros ?? 0);
  }

  @Get('turnos')
  @RequirePermiso(PERMISSIONS.caja_ver)
  async listar() {
    return this.turnos.listar();
  }

  // --- Movimientos ---
  @Post('movimiento/egreso')
  @RequirePermiso(PERMISSIONS.caja_movimientos)
  async egreso(@CurrentUser() u: { id: number }, @Body() b: MovimientoCajaDto) {
    return this.movs.egreso(b.id_turno, b.concepto, b.monto, u.id);
  }

  @Post('movimiento/ingreso')
  @RequirePermiso(PERMISSIONS.caja_movimientos)
  async ingreso(
    @CurrentUser() u: { id: number },
    @Body() b: MovimientoCajaDto,
  ) {
    return this.movs.ingreso(b.id_turno, b.concepto, b.monto, b.autorizado_por ?? 0, u.id);
  }

  @Get('movimiento/:id_turno')
  @RequirePermiso(PERMISSIONS.caja_ver)
  async movimientos(@Param('id_turno') idTurno: string) {
    return this.movs.listar(Number(idTurno));
  }

  // --- Pagos de propina ---
  @Post('propina/pago')
  @RequirePermiso(PERMISSIONS.propina_pagar)
  async pagarPropina(@CurrentUser() u: { id: number }, @Body() b: PagarPropinaDto) {
    return this.pagosPropina.registrar({
      fecha_pago: b.fecha_pago,
      monto_efectivo: b.monto_efectivo,
      monto_otros: b.monto_otros,
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
