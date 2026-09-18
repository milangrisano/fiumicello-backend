import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Like } from 'typeorm';
import { TurnoCaja } from '../entities/turno-caja.entity';
import { MovimientoCaja } from '../entities/movimiento-caja.entity';
import { Venta } from '../entities/venta.entity';

export interface ArqueoResult {
  turno: TurnoCaja;
  porMedio: { medio: string; total: number }[];
  efectivoInicial: number;
  ventasEfectivo: number;
  propinaEfectivo: number;
  egresos: number;
  ingresos: number;
  efectivoTeorico: number;
  efectivoFisico: number | null;
  faltante: number;   // >0 => NO se puede cerrar
  excedente: number;  // >0 => propina/sobrante (no bloquea)
  puedeCerrar: boolean;
}

@Injectable()
export class TurnosCajaService {
  constructor(
    @InjectRepository(TurnoCaja) private turnos: Repository<TurnoCaja>,
    @InjectRepository(MovimientoCaja) private movs: Repository<MovimientoCaja>,
    @InjectRepository(Venta) private ventas: Repository<Venta>,
  ) {}

  /** Turno abierto del cajero (si lo hay). */
  async abierto(idCajero: number): Promise<TurnoCaja | null> {
    return this.turnos.findOne({ where: { id_cajero: idCajero, estado: 'abierto' } });
  }

  /** Turno activo para operar (cualquiera abierto, para ligar ventas). */
  async activo(): Promise<TurnoCaja | null> {
    return this.turnos.findOne({ where: { estado: 'abierto' }, order: { id: 'DESC' } });
  }

  async abrir(idCajero: number, efectivoInicial: number): Promise<TurnoCaja> {
    const existente = await this.abierto(idCajero);
    if (existente) throw new BadRequestException('Ya tiene un turno de caja abierto.');
    const fechaHoy = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const delDia = await this.turnos.count({
      where: { fecha: Like(`${fechaHoy}%`) } as any,
    });
    const t = this.turnos.create({
      id_cajero: idCajero,
      fecha: new Date().toISOString(),
      numero_dia: delDia + 1,
      estado: 'abierto',
      efectivo_inicial: efectivoInicial,
    });
    return this.turnos.save(t);
  }

  private async calcularArqueo(t: TurnoCaja): Promise<ArqueoResult> {
    const ventasTurno = await this.ventas.find({
      where: { id_turno: t.id, anulada: false },
    });
    const porMedioMap = new Map<string, number>();
    let ventasEfectivo = 0;
    for (const v of ventasTurno) {
      const medio = v.forma_pago_nombre || 'Sin medio';
      if (medio.toLowerCase() === 'pendiente') continue; // excluido
      const total = Number(v.total ?? 0);
      porMedioMap.set(medio, (porMedioMap.get(medio) || 0) + total);
      if (medio.toLowerCase() === 'efectivo') ventasEfectivo += total;
    }
    const porMedio = [...porMedioMap.entries()].map(([medio, total]) => ({ medio, total }));

    const movs = await this.movs.find({ where: { id_turno: t.id } });
    let egresos = 0;
    let ingresos = 0;
    for (const m of movs) {
      const monto = Number(m.monto ?? 0);
      if (m.tipo === 'egreso') egresos += monto;
      else if (m.tipo === 'ingreso') ingresos += monto;
    }

    const efectivoInicial = Number(t.efectivo_inicial ?? 0);
    const propinaEfectivo = Number(t.propina_efectivo ?? 0);
    // Teórico que debe quedar en caja:
    const efectivoTeorico = efectivoInicial + ventasEfectivo - propinaEfectivo - egresos + ingresos;
    const efectivoFisico = t.efectivo_final != null ? Number(t.efectivo_final) : null;

    let faltante = 0;
    let excedente = 0;
    if (efectivoFisico != null) {
      if (efectivoTeorico > efectivoFisico) faltante = efectivoTeorico - efectivoFisico;
      else if (efectivoFisico > efectivoTeorico) excedente = efectivoFisico - efectivoTeorico;
    }
    const puedeCerrar = faltante <= 0;

    return {
      turno: t,
      porMedio,
      efectivoInicial,
      ventasEfectivo,
      propinaEfectivo,
      egresos,
      ingresos,
      efectivoTeorico,
      efectivoFisico,
      faltante,
      excedente,
      puedeCerrar,
    };
  }

  async arqueo(idTurno: number): Promise<ArqueoResult> {
    const t = await this.turnos.findOne({ where: { id: idTurno } });
    if (!t) throw new NotFoundException('Turno no encontrado.');
    return this.calcularArqueo(t);
  }

  /** Cierra el turno. BLOQUEA si hay faltante de efectivo. */
  async cerrar(idTurno: number, efectivoFinal: number, propinaEfectivo: number, propinaOtros: number): Promise<TurnoCaja> {
    const t = await this.turnos.findOne({ where: { id: idTurno } });
    if (!t) throw new NotFoundException('Turno no encontrado.');
    if (t.estado === 'cerrado') throw new BadRequestException('El turno ya está cerrado.');
    t.propina_efectivo = propinaEfectivo;
    t.propina_otros = propinaOtros;
    t.efectivo_final = efectivoFinal;
    const a = await this.calcularArqueo(t);
    if (!a.puedeCerrar) {
      // guardamos la diferencia pero no cerramos
      t.diferencia = a.faltante;
      await this.turnos.save(t);
      throw new ForbiddenException(
        `No se puede cerrar: faltante de efectivo de ${a.faltante.toFixed(2)}. Cuadre la caja antes de cerrar.`,
      );
    }
    t.diferencia = 0;
    t.estado = 'cerrado';
    t.cierre_at = new Date();
    return this.turnos.save(t);
  }

  async listar(): Promise<TurnoCaja[]> {
    return this.turnos.find({ order: { id: 'DESC' } });
  }
}
