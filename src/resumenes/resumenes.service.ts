import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as fs from 'fs';
import * as path from 'path';
import { Venta } from '../entities/venta.entity';
import { VentaItem } from '../entities/venta-item.entity';
import { Factura, extraer4 } from '../entities/factura.entity';
import { ComprobantePago } from '../entities/comprobante.entity';
import { partesFechaBogota } from '../common/date-utils';

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
    @InjectRepository(Factura) private readonly facturas: Repository<Factura>,
    @InjectRepository(ComprobantePago)
    private readonly comprobantes: Repository<ComprobantePago>,
  ) {}

  /** Raíz de archivos servidos (mismo env que OCR/escaneo). */
  private static readonly IMAGENES_DIR =
    process.env.IMAGENES_DIR || path.resolve(process.cwd(), 'archivos');

  /** True si el archivo existe físicamente en el volumen servido. */
  private existeArchivo(archivo?: string | null): boolean {
    if (!archivo) return false;
    try {
      return fs.existsSync(path.join(ResumenesService.IMAGENES_DIR, archivo));
    } catch {
      return false;
    }
  }

  /** Convierte fecha ISO/date a inicio-fin + etiqueta para el período. */
  rango(
    periodo: 'año' | 'mes' | 'semana' | 'día' | 'rango',
    referencia?: string | null,
    desde?: string | null,
    hasta?: string | null,
  ): RangoPeriodo {
    // Rango libre (elección de calendario): se usa directamente desde/hasta.
    if (periodo === 'rango') {
      if (!desde || !hasta) {
        throw new Error('Se requiere desde y hasta para un período rango.');
      }
      const dIni = new Date(`${desde}T00:00:00`);
      const dFin = new Date(`${hasta}T23:59:59`);
      return {
        desde: dIni,
        hasta: dFin,
        etiqueta: `${desde} → ${hasta}`,
      };
    }
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
    periodo: 'año' | 'mes' | 'semana' | 'día' | 'rango',
    referencia?: string | null,
    desde?: string | null,
    hasta?: string | null,
  ) {
    const r = this.rango(periodo, referencia, desde, hasta);
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
      const { y, m, d } = partesFechaBogota(new Date(v.fecha));
      const clave = `${d}/${m}/${y}`;
      const ent = porDia.get(clave) ?? { dia: clave, monto: 0 };
      ent.monto += Number(v.total ?? 0);
      porDia.set(clave, ent);
    }
    const diasSorted = [...porDia.values()].sort((a, b) => b.monto - a.monto);
    if (diasSorted.length > 0) diaMayor = diasSorted[0];

    // Serie diaria para el gráfico de barras: TODOS los días del rango, en orden
    // cronológico, con monto 0 en los días sin ventas (para el período completo).
    const seriePorFecha = new Map<string, number>();
    // Compacta la clave d/m/aaaa -> aaaa-mm-dd para cruzar con los días del rango.
    for (const [clave, ent] of porDia) {
      const [dd, mm, aaaa] = clave.split('/');
      seriePorFecha.set(`${aaaa}-${(mm.length === 1 ? '0' : '') + mm}-${(dd.length === 1 ? '0' : '') + dd}`, ent.monto);
    }
    const serieDia: Array<{ fecha: string; etiqueta: string; monto: number }> = [];
    const cursor = new Date(r.desde);
    cursor.setHours(0, 0, 0, 0);
    const fin = new Date(r.hasta);
    fin.setHours(0, 0, 0, 0);
    const z2 = (n: number) => String(n).padStart(2, '0');
    let guardia = 0;
    while (cursor.getTime() <= fin.getTime() && guardia < 372) {
      const aaaa = cursor.getFullYear();
      const mm = z2(cursor.getMonth() + 1);
      const dd = z2(cursor.getDate());
      const fechaKey = `${aaaa}-${mm}-${dd}`;
      serieDia.push({
        fecha: fechaKey,
        etiqueta: `${cursor.getDate()}/${cursor.getMonth() + 1}/${aaaa}`,
        monto: seriePorFecha.get(fechaKey) ?? 0,
      });
      cursor.setDate(cursor.getDate() + 1);
      guardia++;
    }

    // Semana de mayor venta (suma por año-número de semana ISO)
    const porSemana = new Map<string, { semana: string; monto: number; n: number }>();
    for (const v of ventas) {
      if (!v.fecha) continue;
      const d = new Date(v.fecha);
      const { y, m, d: dd } = partesFechaBogota(d);
      const dayOfYear = (Date.UTC(y, m - 1, dd) - Date.UTC(y, 0, 0)) / (24 * 60 * 60 * 1000);
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
      const { y, m } = partesFechaBogota(new Date(v.fecha));
      const clave = `${y}-${m}`;
      const ent = porMes.get(clave) ?? { mes: `${m}/${y}`, monto: 0 };
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
      serie_dia: serieDia,
      kpis: {
        mas_vendido_cantidad: masVendidoCantidad,
        mas_vendido_monto: masVendidoMonto,
        semana_mayor: semanaMayor,
        dia_mayor: diaMayor,
        mes_mayor: mesMayor,
      },
    };
  }

  /** Última fecha (día) con ventas no anuladas, en zona America/Bogota (YYYY-MM-DD). */
  async ultimaFecha(): Promise<string | null> {
    const rows = await this.ventas
      .createQueryBuilder('v')
      .select(['v.fecha as fecha'])
      .where('v.anulada = false')
      .orderBy('v.fecha', 'DESC')
      .take(1)
      .getRawMany<{ fecha: string }>();
    if (!rows || rows.length === 0 || !rows[0] || !rows[0].fecha) {
      return null;
    }
    const { y, m, d } = partesFechaBogota(new Date(rows[0].fecha));
    const z = (n: number) => String(n).padStart(2, '0');
    return `${y}-${z(m)}-${z(d)}`;
  }

  /** Resumen contable (haber/deber) para un período: ventas vs gastos.
   *
   * - ventas       = ingresos (no anuladas) del período
   * - facturas     = gastos/costos (deber) del período
   * - comprobantes = movimientos de dinero (haber) del período
   * - utilidad     = ventas − facturas
   *
   * Concilación: si una factura tiene id_comprobante (o el comprobante tiene
   * id_factura), se marca como "conciliada". El resto queda para asignación
   * manual por interfaz gráfica (trasabilidad del pago de cada factura).
   */
  async contable(
    periodo: 'año' | 'mes' | 'semana' | 'día' | 'rango',
    referencia?: string | null,
    desde?: string | null,
    hasta?: string | null,
  ) {
    const r = this.rango(periodo, referencia, desde, hasta);
    const d = r.desde.toISOString();
    const h = r.hasta.toISOString();
    const dFecha = d.slice(0, 10);
    const hFecha = h.slice(0, 10);

    // Ventas del período
    const ventas = await this.ventas
      .createQueryBuilder('v')
      .where('v.fecha IS NOT NULL AND v.anulada = false')
      .andWhere('substr(v.fecha,1,10) >= :d', { d: dFecha })
      .andWhere('substr(v.fecha,1,10) <= :h', { h: hFecha })
      .orderBy('v.fecha', 'ASC')
      .getMany();
    const montoVentas = ventas.reduce((s, x) => s + Number(x.total ?? 0), 0);

    // Facturas (gastos) del período
    const facturas = await this.facturas
      .createQueryBuilder('f')
      .where('f.fecha IS NOT NULL')
      .andWhere('substr(f.fecha,1,10) >= :d', { d: dFecha })
      .andWhere('substr(f.fecha,1,10) <= :h', { h: hFecha })
      .orderBy('f.fecha', 'ASC')
      .getMany();
    const montoFacturas = facturas.reduce((s, x) => s + Number(x.total_con_impuestos ?? 0), 0);

    // Comprobantes (haber/movimientos) del período
    const comprobantes = await this.comprobantes
      .createQueryBuilder('c')
      .where('c.fecha IS NOT NULL')
      .andWhere('substr(c.fecha,1,10) >= :d', { d: dFecha })
      .andWhere('substr(c.fecha,1,10) <= :h', { h: hFecha })
      .orderBy('c.fecha', 'ASC')
      .getMany();
    const montoComprobantes = comprobantes.reduce(
      (s, x) => s + Number(x.total_con_impuestos ?? 0),
      0,
    );

    const num = (v: any) => Number(v ?? 0);

    // Clasificación de comprobantes: cuentas personales del restaurante =
    // "transferencia a otras cuentas"; el resto = "pago a proveedores".
    // Override manual: si el comprobante tiene tipo_manual, ese manda.
    const CUENTAS_PERSONALES = [
      '3123524512', // Nequi
      '71800004915', // Bancolombia 718-000049-15
      '71800004889', // Bancolombia 718-000048-89
      '58200046798', // Bancolombia 582-000467-98
    ];
    const esCuentaPersonal = (s: string | null | undefined): boolean => {
      if (!s) return false;
      const t = s.toLowerCase();
      if (
        t.includes('la vera trattoria') ||
        t.includes('enrique angrisano') ||
        t.includes('nequi enrique')
      ) {
        return true;
      }
      // Comparar por dígitos (ignora guiones/espacios/puntos).
      const soloDigitos = t.replace(/\D/g, '');
      return CUENTAS_PERSONALES.some((cuenta) => soloDigitos.includes(cuenta));
    };

    const comprobantesDetalle = comprobantes.map((c) => ({
      id: c.id,
      fecha: c.fecha,
      referencia: c.referencia,
      beneficiario: c.beneficiario_emisor,
      monto: num(c.total_con_impuestos),
      conciliado: c.id_factura != null,
      id_factura: c.id_factura,
      metodo_pago: c.metodo_pago,
      metodo_pago_ultimos4:
        c.metodo_pago_ultimos4 ?? extraer4(c.metodo_pago),
      // Imagen del comprobante SOLO si el archivo existe en el volumen servido
      // (evita el 404 y el botón "Ver documento" aparece solo si es visible).
      archivo: c.archivo && this.existeArchivo(c.archivo) ? c.archivo : null,
      archivo_url:
        c.archivo && this.existeArchivo(c.archivo) ? `/archivos/${c.archivo}` : null,
      // El tipo manual (si existe) tiene prioridad sobre la regla automática.
      tipo:
        c.tipo_manual ??
        (esCuentaPersonal(c.beneficiario_emisor) ? 'transferencia' : 'proveedor'),
      tipo_manual: c.tipo_manual,
    }));

    const montoTransferencias = comprobantesDetalle
      .filter((c) => c.tipo === 'transferencia')
      .reduce((s, c) => s + c.monto, 0);
    const montoProveedores = comprobantesDetalle
      .filter((c) => c.tipo === 'proveedor')
      .reduce((s, c) => s + c.monto, 0);
    const nTransferencias = comprobantesDetalle.filter(
      (c) => c.tipo === 'transferencia',
    ).length;
    const nProveedores = comprobantesDetalle.filter(
      (c) => c.tipo === 'proveedor',
    ).length;

    return {
      periodo,
      etiqueta: r.etiqueta,
      desde: r.desde.toISOString(),
      hasta: r.hasta.toISOString(),
      ventas: { monto: montoVentas, count: ventas.length },
      facturas: { monto: montoFacturas, count: facturas.length },
      comprobantes: { monto: montoComprobantes, count: comprobantes.length },
      utilidad: montoVentas - montoFacturas,
      // Detalle de facturas con su conciliación (para la asignación manual).
      facturas_detalle: facturas.map((f) => ({
        id: f.id,
        fecha: f.fecha,
        numero_factura: f.numero_factura,
        proveedor: f.proveedor,
        monto: num(f.total_con_impuestos),
        // Conciliada si tiene comprobante asignado por cualquiera de los dos links.
        conciliada:
          f.id_comprobante != null ||
          this.comprobanteVinculado(comprobantes, f),
        id_comprobante: f.id_comprobante,
        referencia_comprobante: f.referencia_comprobante,
        metodo_pago: f.metodo_pago,
        metodo_pago_ultimos4:
          f.metodo_pago_ultimos4 ?? extraer4(f.metodo_pago),
        // Imagen de la factura SOLO si el archivo existe en el volumen servido.
        archivo: f.archivo && this.existeArchivo(f.archivo) ? f.archivo : null,
        archivo_url:
          f.archivo && this.existeArchivo(f.archivo) ? `/archivos/${f.archivo}` : null,
      })),
      // Comprobantes del período (clasificados: transferencias / proveedores).
      comprobantes_transferencias: {
        monto: montoTransferencias,
        count: nTransferencias,
      },
      comprobantes_proveedores: {
        monto: montoProveedores,
        count: nProveedores,
      },
      comprobantes_detalle: comprobantesDetalle,
    };
  }

  /** true si algún comprobante del período ya apunta a esta factura. */
  private comprobanteVinculado(
    comprobantes: ComprobantePago[],
    f: Factura,
  ): boolean {
    return comprobantes.some(
      (c) =>
        c.id_factura === f.id ||
        (f.referencia_comprobante != null &&
          c.referencia != null &&
          c.referencia === f.referencia_comprobante) ||
        (f.numero_factura != null && c.numero_factura === f.numero_factura),
    );
  }

  /** Asigna manualmente un comprobante de pago a una factura (trasabilidad del
   *  pago). Escribe el cross-link en AMBOS sentidos: factura.id_comprobante y
   *  comprobante_pago.id_factura. Igual idempotente. */
  async asignarComprobante(
    facturaId: number,
    comprobanteId: number,
  ): Promise<{ ok: boolean; mensaje: string }> {
    const factura = await this.facturas.findOneBy({ id: facturaId });
    if (!factura) return { ok: false, mensaje: 'Factura no encontrada.' };
    const comprobante = await this.comprobantes.findOneBy({ id: comprobanteId });
    if (!comprobante) return { ok: false, mensaje: 'Comprobante no encontrado.' };

    factura.id_comprobante = comprobante.id;
    factura.referencia_comprobante = comprobante.referencia;
    comprobante.id_factura = factura.id;
    comprobante.numero_factura = factura.numero_factura;

    await this.facturas.save(factura);
    await this.comprobantes.save(comprobante);
    return {
      ok: true,
      mensaje: `Factura ${factura.numero_factura ?? factura.id} vinculada al comprobante ${comprobante.referencia ?? comprobante.id}.`,
    };
  }

  /** Guarda la clasificación MANUAL de un comprobante (override de la regla
   *  automática por beneficiario). 'transferencia' | 'proveedor' | null (auto). */
  async clasificarComprobante(
    comprobanteId: number,
    tipo: 'transferencia' | 'proveedor' | null,
  ): Promise<{ ok: boolean; mensaje: string }> {
    const comprobante = await this.comprobantes.findOneBy({ id: comprobanteId });
    if (!comprobante) return { ok: false, mensaje: 'Comprobante no encontrado.' };
    comprobante.tipo_manual = tipo;
    await this.comprobantes.save(comprobante);
    const etiqueta =
      tipo === 'transferencia'
        ? 'Transferencia'
        : tipo === 'proveedor'
          ? 'Pago a proveedor'
          : 'Automático';
    return {
      ok: true,
      mensaje: `Comprobante ${comprobante.referencia ?? comprobante.id}: ${etiqueta}.`,
    };
  }
}