import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Factura } from '../entities/factura.entity';
import { FacturaItem } from '../entities/factura-item.entity';
import { CreateFacturaDto, UpdateFacturaDto } from './dto/factura.dto';

export interface FacturasFiltros {
  desde?: string;
  hasta?: string;
  proveedor?: string;
  estado?: string;
  metodo?: string;
  montoMin?: number;
  montoMax?: number;
  limit?: number;
  offset?: number;
}

@Injectable()
export class FacturasService {
  constructor(
    @InjectRepository(Factura)
    private readonly repo: Repository<Factura>,
    @InjectRepository(FacturaItem)
    private readonly itemsRepo: Repository<FacturaItem>,
    private readonly dataSource: DataSource,
  ) {}

  private buildWithFilters(filters: FacturasFiltros) {
    const qb = this.repo.createQueryBuilder('f');
    qb.orderBy('f.fecha', 'DESC');
    qb.addOrderBy('f.id', 'DESC');
    if (filters.desde) {
      qb.andWhere('f.fecha >= :desde', { desde: filters.desde });
    }
    if (filters.hasta) {
      qb.andWhere('f.fecha <= :hasta', { hasta: filters.hasta });
    }
    if (filters.proveedor) {
      qb.andWhere('f.proveedor LIKE :prov', { prov: '%' + filters.proveedor + '%' });
    }
    if (filters.estado) {
      qb.andWhere('f.estado = :estado', { estado: filters.estado });
    }
    if (filters.metodo) {
      qb.andWhere('f.metodo_pago = :met', { met: filters.metodo });
    }
    if (filters.montoMin) {
      qb.andWhere('f.total_con_impuestos >= :min', { min: filters.montoMin });
    }
    if (filters.montoMax) {
      qb.andWhere('f.total_con_impuestos <= :max', { max: filters.montoMax });
    }
    return qb;
  }

  async findAll(filters: FacturasFiltros) {
    const qb = this.buildWithFilters(filters);
    const limit = filters.limit ? filters.limit : 100;
    const offset = filters.offset ? filters.offset : 0;
    const data = await qb.getMany();
    const total = await qb.getCount();
    return { data, total, limit, offset };
  }

  async findOne(id: number) {
    const result = await this.repo.findOneBy({ id });
    if (!result) throw new NotFoundException(`Factura ${id} no encontrada.`);
    return result;
  }

  async findItems(id: number) {
    const factura = await this.findOne(id);
    const items = await this.itemsRepo.findBy({ id_factura: id });
    return { factura, items };
  }

  /**
   * Duplicate rule: same numero_factura + proveedor + fecha already exists.
   * Supports the physical + email intake paths converging on the same invoice.
   */
  async findDuplicada(dto: CreateFacturaDto): Promise<Factura | null> {
    if (!dto.numero_factura) return null;
    const qb = this.repo
      .createQueryBuilder('f')
      .where('f.numero_factura = :num', { num: dto.numero_factura });
    if (dto.proveedor) qb.andWhere('f.proveedor = :prov', { prov: dto.proveedor });
    if (dto.fecha) qb.andWhere('f.fecha = :fecha', { fecha: dto.fecha });
    return qb.getOne();
  }

  async create(dto: CreateFacturaDto): Promise<Factura> {
    const dup = await this.findDuplicada(dto);
    if (dup) {
      throw new ConflictException(
        `La factura ${dto.numero_factura} (${dto.proveedor}, ${dto.fecha}) ya está registrada (id ${dup.id}).`,
      );
    }

    return this.dataSource.transaction(async (manager) => {
      const factura = manager.create(Factura, {
        ...dto,
        moneda: dto.moneda || 'COP',
        created_at: new Date().toISOString(),
      });
      const saved = await manager.save(factura);

      if (dto.items && dto.items.length > 0) {
        const items = dto.items.map((it) =>
          manager.create(FacturaItem, {
            ...it,
            id_factura: saved.id,
            numero_factura: it.numero_factura ?? dto.numero_factura ?? null,
            fecha_factura: it.fecha_factura ?? dto.fecha ?? null,
            proveedor: it.proveedor ?? dto.proveedor ?? null,
            moneda: it.moneda ?? dto.moneda ?? 'COP',
          }),
        );
        await manager.save(items);
      }
      return saved;
    });
  }

  async update(id: number, dto: UpdateFacturaDto): Promise<Factura> {
    const factura = await this.findOne(id);
    Object.assign(factura, dto);
    await this.repo.save(factura);

    if (dto.items !== undefined) {
      // Replace the item set on update.
      await this.itemsRepo.delete({ id_factura: id });
      if (dto.items.length > 0) {
        const items = dto.items.map((it) =>
          this.itemsRepo.create({
            ...it,
            id_factura: id,
            numero_factura: it.numero_factura ?? factura.numero_factura ?? null,
            fecha_factura: it.fecha_factura ?? factura.fecha ?? null,
            proveedor: it.proveedor ?? factura.proveedor ?? null,
            moneda: it.moneda ?? factura.moneda ?? 'COP',
          }),
        );
        await this.itemsRepo.save(items);
      }
    }
    return this.findOne(id);
  }

  async remove(id: number): Promise<{ deleted: boolean; id: number }> {
    await this.findOne(id);
    await this.itemsRepo.delete({ id_factura: id });
    await this.repo.delete(id);
    return { deleted: true, id };
  }
}