import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ComprobantePago } from '../entities/comprobante.entity';

export interface ComprobantesFiltros {
  desde?: string;
  hasta?: string;
  beneficiario?: string;
  estado?: string;
  metodo?: string;
  limit?: number;
  offset?: number;
}

@Injectable()
export class ComprobantesService {
  constructor(
    @InjectRepository(ComprobantePago)
    private readonly repo: Repository<ComprobantePago>,
  ) {}

	  async findAll(f: ComprobantesFiltros = {}) {
    const qb = this.repo.createQueryBuilder('c').orderBy('c.fecha', 'DESC').addOrderBy('c.id', 'DESC');
    if (f.desde) qb.andWhere('c.fecha >= :desde', { desde: f.desde });
    if (f.hasta) qb.andWhere('c.fecha <= :hasta', { hasta: f.hasta });
    if (f.beneficiario) qb.andWhere('c.beneficiario_emisor LIKE :ben', { ben: `%${f.beneficiario}%` });
    if (f.estado) qb.andWhere('c.estado = :estado', { estado: f.estado });
    if (f.metodo) qb.andWhere('c.metodo_pago = :met', { met: f.metodo });
    const limit = f.limit || 100;
    const offset = f.offset || 0;
    qb.limit(limit);
        qb.offset(offset);
    const [data, total] = await qb.getManyAndCount();
    return { data, total, limit, offset };
  }

	  async findOne(id: number) {
    return await this.repo.findOneBy({ id });
  }
}