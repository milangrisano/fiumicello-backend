import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ComprobantePago } from '../entities/comprobante.entity';
import { CreateComprobanteDto, UpdateComprobanteDto } from './dto/comprobante.dto';

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
    const result = await this.repo.findOneBy({ id });
    if (!result) throw new NotFoundException(`Comprobante ${id} no encontrado.`);
    return result;
  }

  /**
   * Duplicate rule: same referencia + total_con_impuestos already exists
   * (matches the dedup herb used previously on SQLite).
   */
  async findDuplicado(dto: CreateComprobanteDto): Promise<ComprobantePago | null> {
    const { referencia, total_con_impuestos } = dto;
    if (!referencia || total_con_impuestos === undefined) return null;
    return this.repo.findOneBy({ referencia, total_con_impuestos });
  }

  async create(dto: CreateComprobanteDto): Promise<ComprobantePago> {
    const dup = await this.findDuplicado(dto);
    if (dup) {
      throw new ConflictException(
        `El comprobante ${dto.referencia} por ${dto.total_con_impuestos} ya está registrado (id ${dup.id}).`,
      );
    }

    const comprobante = this.repo.create({
      ...dto,
      moneda: dto.moneda || 'COP',
      estado: dto.estado || 'verificado',
      created_at: new Date().toISOString(),
    });
    return await this.repo.save(comprobante);
  }

  async update(id: number, dto: UpdateComprobanteDto): Promise<ComprobantePago> {
    const comprobante = await this.findOne(id);
    Object.assign(comprobante, dto);
    return await this.repo.save(comprobante);
  }

  async remove(id: number): Promise<{ deleted: boolean; id: number }> {
    await this.findOne(id);
    await this.repo.delete(id);
    return { deleted: true, id };
  }
}