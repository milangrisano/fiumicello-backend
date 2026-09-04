import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Factura } from '../entities/factura.entity';
import { FacturaItem } from '../entities/factura-item.entity';
import { ComprobantePago } from '../entities/comprobante.entity';

@Injectable()
export class GastosService {
  constructor(
    @InjectRepository(Factura)
    private readonly facturas: Repository<Factura>,
    @InjectRepository(FacturaItem)
    private readonly items: Repository<FacturaItem>,
    @InjectRepository(ComprobantePago)
    private readonly comprobantes: Repository<ComprobantePago>,
  ) {}

  async resumen(agrupar: string = 'total') {
    const agrup = ['dia', 'mes', 'proveedor'].includes(agrupar) ? agrupar : 'total';

    const qb = this.facturas.createQueryBuilder('f');
    qb.select('COUNT(*)', 'filas').addSelect('SUM(f.total_con_impuestos)', 'total');

    if (agrup === 'dia') {
      qb.addSelect("substr(f.fecha,1,10)", 'grupo').groupBy("substr(f.fecha,1,10)");
    } else if (agrup === 'mes') {
      qb.addSelect("substr(f.fecha,1,7)", 'grupo').groupBy("substr(f.fecha,1,7)");
    } else if (agrup === 'proveedor') {
      qb.addSelect('f.proveedor', 'grupo').groupBy('f.proveedor');
    } else {
      qb.addSelect("'total'", 'grupo');
    }

    const filas = await qb.getRawMany();
    const data = filas.map((r) => ({
      grupo: r.grupo ?? 'total',
      filas: Number(r.filas) || 0,
      total: Number(r.total) || 0,
    }));
    const totalGeneral = data.reduce((s, d) => s + d.total, 0);
    return { tipo: agrup, data, totalGeneral };
  }

	  async porCategoria() {
    const qb = this.items.createQueryBuilder('i');
    qb.select('i.categoria', 'categoria')
      .addSelect('COUNT(*)', 'filas')
      .addSelect('SUM(i.total)', 'total')
      .where('i.categoria IS NOT NULL')
      .groupBy('i.categoria')
      .orderBy('SUM(i.total)', 'DESC');
    const filas = await qb.getRawMany();
    return filas.map((r) => ({
      categoria: r.categoria,
      filas: Number(r.filas) || 0,
      total: Number(r.total) || 0,
    }));
  }

	  async total() {
    const f = await this.facturas.createQueryBuilder('f').select('SUM(f.total_con_impuestos)', 't').getRawOne();
    const c = await this.comprobantes.createQueryBuilder('c').select('SUM(c.total_con_impuestos)', 't').getRawOne();
    const facturasTotal = Number(f?.t) || 0;
    const comprobantesTotal = Number(c?.t) || 0;
    return {
      facturas: facturasTotal,
      comprobantes: comprobantesTotal,
      total: facturasTotal + comprobantesTotal,
    };
  }
}