import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Factura } from '../entities/factura.entity';
import { FacturaItem } from '../entities/factura-item.entity';

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

	  async findOne(id) {
    const result = await this.repo.findOneBy({ id });
    return result;
  }

	  async findItems(id) {
    const factura = await this.findOne(id);
        const items = await this.itemsRepo.findBy({ id_factura: id });
    return { factura, items };
  }
}