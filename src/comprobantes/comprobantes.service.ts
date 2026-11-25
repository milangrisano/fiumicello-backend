import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ComprobantePago } from '../entities/comprobante.entity';
import { CreateComprobanteDto, UpdateComprobanteDto } from './dto/comprobante.dto';
import { RealtimeGateway } from '../realtime/realtime.gateway';

export interface ComprobantesFiltros {
  desde?: string;
  hasta?: string;
  beneficiario?: string;
  q?: string; // texto libre: referencia + concepto + beneficiario (LIKE)
  estado?: string;
  metodo?: string;
  montoMin?: number;
  montoMax?: number;
  limit?: number;
  offset?: number;
}

@Injectable()
export class ComprobantesService {
  private readonly logger = new Logger(ComprobantesService.name);

  constructor(
    @InjectRepository(ComprobantePago)
    private readonly repo: Repository<ComprobantePago>,
    private readonly realtime: RealtimeGateway,
  ) {}

  async findAll(f: ComprobantesFiltros = {}) {
    const qb = this.repo.createQueryBuilder('c').orderBy('c.fecha', 'DESC').addOrderBy('c.id', 'DESC');
    if (f.desde) qb.andWhere('c.fecha >= :desde', { desde: f.desde });
    if (f.hasta) qb.andWhere('c.fecha <= :hasta', { hasta: f.hasta });
    if (f.beneficiario) qb.andWhere('c.beneficiario_emisor LIKE :ben', { ben: `%${f.beneficiario}%` });
    if (f.q && f.q.trim()) {
      // Texto libre: busca en referencia, concepto o beneficiario.
      qb.andWhere(
        '(c.referencia LIKE :qt OR c.concepto LIKE :qt OR c.beneficiario_emisor LIKE :qt)',
        { qt: `%${f.q.trim()}%` },
      );
    }
    if (f.estado) qb.andWhere('c.estado = :estado', { estado: f.estado });
    if (f.metodo) qb.andWhere('c.metodo_pago = :met', { met: f.metodo });
    if (f.montoMin) qb.andWhere('c.total_con_impuestos >= :min', { min: f.montoMin });
    if (f.montoMax) qb.andWhere('c.total_con_impuestos <= :max', { max: f.montoMax });
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
    const guardado = await this.repo.save(comprobante);
    // Tiempo real: avisa para que la pestaña de comprobantes se refresque sola.
    try {
      this.realtime.emitComprobanteNuevo({ id: guardado.id, referencia: guardado.referencia });
    } catch (e) {
      // El evento nunca debe romper la creación del comprobante.
      this.logger.warn(`No se pudo emitir comprobante:nuevo: ${(e as Error).message}`);
    }
    return guardado;
  }

  async update(id: number, dto: UpdateComprobanteDto): Promise<ComprobantePago> {
    const comprobante = await this.findOne(id);
    Object.assign(comprobante, dto);
    return await this.repo.save(comprobante);
  }

  async remove(id: number): Promise<{ deleted: boolean; id: number }> {
    await this.findOne(id);
    // Soft delete: se marca deleted_at (histórico contable conservado y
    // excluido de consultas normales).
    await this.repo.softDelete(id);
    return { deleted: true, id };
  }
}