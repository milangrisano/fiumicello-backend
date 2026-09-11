import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MovimientoCaja } from '../entities/movimiento-caja.entity';
import { TurnoCaja } from '../entities/turno-caja.entity';

@Injectable()
export class MovimientosCajaService {
  constructor(
    @InjectRepository(MovimientoCaja) private movs: Repository<MovimientoCaja>,
    @InjectRepository(TurnoCaja) private turnos: Repository<TurnoCaja>,
  ) {}

  /** Egreso: compra en efectivo, etc. Lo registra el cajero libremente. */
  async egreso(idTurno: number, concepto: string, monto: number, creadoPor: number): Promise<MovimientoCaja> {
    const t = await this.turnos.findOne({ where: { id: idTurno } });
    if (!t) throw new NotFoundException('Turno no encontrado.');
    if (t.estado === 'cerrado') throw new BadRequestException('El turno está cerrado.');
    const m = this.movs.create({ id_turno: idTurno, tipo: 'egreso', concepto, monto, creado_por: creadoPor });
    return this.movs.save(m);
  }

  /** Ingreso: devolución u otro. REQUIERE autorización de admin/encargado. */
  async ingreso(idTurno: number, concepto: string, monto: number, autorizadoPor: number, creadoPor: number): Promise<MovimientoCaja> {
    const t = await this.turnos.findOne({ where: { id: idTurno } });
    if (!t) throw new NotFoundException('Turno no encontrado.');
    if (t.estado === 'cerrado') throw new BadRequestException('El turno está cerrado.');
    if (!autorizadoPor) throw new ForbiddenException('El ingreso debe estar autorizado por un admin/encargado.');
    const m = this.movs.create({ id_turno: idTurno, tipo: 'ingreso', concepto, monto, autorizado_por: autorizadoPor, creado_por: creadoPor });
    return this.movs.save(m);
  }

  async listar(idTurno: number): Promise<MovimientoCaja[]> {
    return this.movs.find({ where: { id_turno: idTurno }, order: { id: 'ASC' } });
  }
}
