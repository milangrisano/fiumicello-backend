import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PagoPropina } from '../entities/pago-propina.entity';

@Injectable()
export class PagosPropinaService {
  constructor(@InjectRepository(PagoPropina) private pagos: Repository<PagoPropina>) {}

  async registrar(dto: {
    fecha_pago: string;
    monto_efectivo: number;
    monto_otros: number;
    turnos_desde?: number | null;
    turnos_hasta?: number | null;
    quien_registra?: number | null;
    notas?: string | null;
  }): Promise<PagoPropina> {
    const p = this.pagos.create({
      fecha_pago: dto.fecha_pago,
      monto_efectivo: dto.monto_efectivo,
      monto_otros: dto.monto_otros,
      turnos_desde: dto.turnos_desde ?? null,
      turnos_hasta: dto.turnos_hasta ?? null,
      quien_registra: dto.quien_registra ?? null,
      notas: dto.notas ?? null,
    });
    return this.pagos.save(p);
  }

  async listar(): Promise<PagoPropina[]> {
    return this.pagos.find({ order: { id: 'DESC' } });
  }
}
