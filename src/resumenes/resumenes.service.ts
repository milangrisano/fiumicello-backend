import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Venta } from '../entities/venta.entity';
import { VentaItem } from '../entities/venta-item.entity';

export interface RangoPeriodo {
  desde: Date;
  hasta: Date;
  etiqueta: string;
}

@Injectable()
export class ResumenesService {
  constructor(
    @InjectRepository(Venta) private readonly ventas: Repository<Venta>,
    @InjectRepository(VentaItem) private readonly ventaItems: Repository<VentaItem>,
  ) {}

  /** Convierte fecha ISO/date a inicio-fin + etiqueta para el período. */
  rango(
    periodo: 'año' | 'mes' | 'semana' | 'día',
    referencia?: string | null,
  ): RangoPeriodo {
    const ref = referencia && referencia.trim() ? new Date(referencia) : new Date();
    const z = (n: number) => String(n).padStart(2, '0');
    switch (periodo) {
      case 'año': {
        const y = ref.getFullYear();
        return {
          desde: new Date(`${y}-01-01T00:00:00`),
          hasta: new Date(`${y}-12-31T23:59:59`),
          etiqueta: `Año ${y}`,
        };
      }
      case 'mes': {
        const y = ref.getFullYear();
        const m = z(ref.getMonth() + 1);
        return {
          desde: new Date(`${y}-${m}-01T00:00:00`),
          hasta: new Date(y, ref.getMonth() + 1, 0, 23, 59, 59),
          etiqueta: `${z(ref.getMonth() + 1)}/${y}`,
        };
      }
      case 'semana': {
        // Lunes de la semana de ref
        const d = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate());
        const diaSem = (d.getDay() + 6) % 7; // 0=Lunes
        d.setDate(d.getDate() - diaSem);
        const fin = new Date(d);
        fin.setDate(fin.getDate() + 6);
        fin.setHours(23, 59, 59);
        const ini = new Date(d);
        ini.setHours(0, 0, 0);
        return {
          desde: ini,
          hasta: fin,
          etiqueta: `Sem. ${ini.getDate()}/${ini.getMonth() + 1} - ${fin.getDate()}/${fin.getMonth() + 1}`,
        };
      }
      case 'día':
      default: {
        const d = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate());
        const ini = new Date(d);
        ini.setHours(0, 0, 0);
        const fin = new Date(d);
        fin.setHours(23, 59, 59);
        return {
          desde: ini,
          hasta: fin,
          etiqueta: `${z(d.getDate())}/${z(d.getMonth() + 1)}/${d.getFullYear()}`,
        };
      }
    }
  }

  /** Resumen agregado: totales, por ítems y KPIs. */
  async resumen(
    periodo: 'año' | 'mes' | 'semana' | 'día',
    referencia?: string | null,
  ) {
    const r = this.rango(periodo, referencia);
    const ventas = await this.ventas
      .createQueryBuilder('v')
      .where('v.fecha IS NOT NULL')
      .andWhere('v.anulada = false')
      .andWhere('v.fecha >= :desde', { desde: r.desde.toISOString() })
      .andWhere('v.fecha <= :hasta', { hasta: r.hasta.toISOString() })
      .orderBy('v.fecha', 'ASC')
      .getMany();

    const totalMonto = ventas.reduce((a, v) => a + Number(v.total ?? 0), 0);
    const nVentas = ventas.length;
    const promedio = nVentas > 0 ? totalMonto / nVentas : 0;

    // Items: agregar desde todos los venta_items del rango
    const itemsRaw = await this.ventaItems
      .createQueryBuilder('vi')
      .select('vi.nombre', 'nombre')
      .addSelect('vi.tamanio', 'tamanio')
      .addSelect('vi.cantidad', 'cantidad')
      .addSelect('vi.subtotal', 'subtotal')
      .innerJoin('ventas', 'v', 'v.id = vi.id_venta')
      .where('v.fecha >= :desde', { desde: r.desde.toISOString() })
      .andWhere('v.fecha <= :hasta', { hasta: r.hasta.toISOString() })
      .andWhere('v.anulada = false')
      .getRawMany();

    // Agrupar por nombre+tamaño
    const mapa = new Map<string, { nombre: string; tamanio: string | null; cantidad: number; subtotal: number }>();
    for (const raw of itemsRaw) {
      const nombre = raw.nombre as string;
      const tamanio = raw.tamanio as string | null;
      const clave = `${nombre}||${tamanio ?? ''}`;
      const ent = mapa.get(clave) ?? { nombre, tamanio, cantidad: 0, subtotal: 0 };
      ent.cantidad += Number(raw.cantidad ?? 0);
      ent.subtotal += Number(raw.subtotal ?? 0);
      mapa.set(clave, ent);
    }
    const items = [...mapa.values()].sort((a, b) => b.subtotal - a.subtotal);

    // KPIs
    let masVendidoCantidad: any = null;
    let masVendidoMonto: any = null;
    let semanaMayor: any = null;
    let diaMayor: any = null;
    let mesMayor: any = null;

    if (items.length > 0) {
      // Por cantidad (descendente)
      const porCant = [...items].sort((a, b) => b.cantidad - a.cantidad)[0];
      masVendidoCantidad = {
        nombre: porCant.nombre,
        tamanio: porCant.tamanio,
        cantidad: porCant.cantidad,
        subtotal: porCant.subtotal,
      };
      // Por monto (items ya está ordenado por subtotal desc)
      const topMonto = items[0];
      masVendidoMonto = {
        nombre: topMonto.nombre,
        tamanio: topMonto.tamanio,
        cantidad: topMonto.cantidad,
        subtotal: topMonto.subtotal,
      };
    }

    // Día de mayor venta (suma por fecha-día)
    const porDia = new Map<string, { dia: string; monto: number }>();
    for (const v of ventas) {
      if (!v.fecha) continue;
      const d = new Date(v.fecha);
      const clave = `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;
      const ent = porDia.get(clave) ?? { dia: clave, monto: 0 };
      ent.monto += Number(v.total ?? 0);
      porDia.set(clave, ent);
    }
    const diasSorted = [...porDia.values()].sort((a, b) => b.monto - a.monto);
    if (diasSorted.length > 0) diaMayor = diasSorted[0];

    // Semana de mayor venta (suma por año-número de semana ISO)
    const porSemana = new Map<string, { semana: string; monto: number; n: number }>();
    for (const v of ventas) {
      if (!v.fecha) continue;
      const d = new Date(v.fecha);
      const y = d.getFullYear();
      const dx = new Date(Date.UTC(y, d.getMonth(), d.getDate()));
      const dayOfYear = (Date.UTC(y, d.getMonth(), d.getDate()) - Date.UTC(y, 0, 0)) / (24 * 60 * 60 * 1000);
      const semana = Math.ceil((dayOfYear + new Date(Date.UTC(y, 0, 1)).getDay()) / 7);
      const clave = `${y}-S${semana}`;
      const ent = porSemana.get(clave) ?? { semana: `${y} · Sem. ${semana}`, monto: 0, n: semana };
      ent.monto += Number(v.total ?? 0);
      porSemana.set(clave, ent);
    }
    const semSorted = [...porSemana.values()].sort((a, b) => b.monto - a.monto);
    if (semSorted.length > 0) semanaMayor = semSorted[0];

    // Mes de mayor venta (suma por año-mes)
    const porMes = new Map<string, { mes: string; monto: number }>();
    for (const v of ventas) {
      if (!v.fecha) continue;
      const d = new Date(v.fecha);
      const clave = `${d.getFullYear()}-${d.getMonth() + 1}`;
      const ent = porMes.get(clave) ?? { mes: `${d.getMonth() + 1}/${d.getFullYear()}`, monto: 0 };
      ent.monto += Number(v.total ?? 0);
      porMes.set(clave, ent);
    }
    const mesSorted = [...porMes.values()].sort((a, b) => b.monto - a.monto);
    if (mesSorted.length > 0) mesMayor = mesSorted[0];

    return {
      periodo,
      etiqueta: r.etiqueta,
      desde: r.desde.toISOString(),
      hasta: r.hasta.toISOString(),
      totales: {
        monto: totalMonto,
        ventas: nVentas,
        promedio,
        venta_promedio_diaria:
          diasSorted.length > 0 ? totalMonto / diasSorted.length : 0,
      },
      items,
      kpis: {
        mas_vendido_cantidad: masVendidoCantidad,
        mas_vendido_monto: masVendidoMonto,
        semana_mayor: semanaMayor,
        dia_mayor: diaMayor,
        mes_mayor: mesMayor,
      },
    };
  }
}