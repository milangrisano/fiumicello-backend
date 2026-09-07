import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Venta } from '../entities/venta.entity';
import { VentaItem } from '../entities/venta-item.entity';
import { FormaPago } from '../entities/forma-pago.entity';
import { ItemCarta } from '../entities/item-carta.entity';

export interface CreateVentaInput {
  escenario: 'mesa' | 'para_llevar' | 'domicilio';
  numero_mesa?: string | null;
  cliente_nombre?: string | null;
  direccion?: string | null;
  telefono?: string | null;
  id_forma_pago?: number | null;
  items: Array<{
    id_producto: number;
    tamanio?: string | null; // Personal | Mediana | Grande | null
    cantidad: number;
  }>;
}

@Injectable()
export class VentasService {
  constructor(
    @InjectRepository(Venta) private readonly ventas: Repository<Venta>,
    @InjectRepository(VentaItem)
    private readonly ventaItems: Repository<VentaItem>,
    @InjectRepository(FormaPago)
    private readonly formasPago: Repository<FormaPago>,
    private readonly dataSource: DataSource,
  ) {}

  /** Next visible consecutive invoice number (F-0001, F-0002, ...). */
  private async siguienteNumeroFactura(): Promise<string> {
    const last = await this.ventas
      .createQueryBuilder('v')
      .orderBy('v.id', 'DESC')
      .getOne();
    let n = 0;
    if (last) {
      const m = /F-(\d+)/.exec(last.numero_factura || '');
      if (m) n = parseInt(m[1], 10);
    }
    return `F-${String(n + 1).padStart(4, '0')}`;
  }

  async crear(datos: CreateVentaInput, usuarioId: number): Promise<Venta> {
    if (!datos.items || datos.items.length === 0) {
      throw new BadRequestException('La venta debe incluir al menos un item.');
    }
    const escenario = datos.escenario || 'mesa';
    if (escenario === 'mesa' && !datos.numero_mesa) {
      throw new BadRequestException('Indique el número de mesa.');
    }
    if (escenario === 'para_llevar' && !datos.cliente_nombre) {
      throw new BadRequestException('Indique el nombre de la persona para llevar.');
    }

    // Resolve payment method snapshot.
    let formaPagoNombre: string | null = null;
    if (datos.id_forma_pago) {
      const fp = await this.formasPago.findOneBy({ id: datos.id_forma_pago });
      if (fp) formaPagoNombre = fp.nombre;
    }

    const numeroFactura = await this.siguienteNumeroFactura();

    // Build line items with catalog price snapshots.
    const lineas: Array<{
      id_producto: number;
      nombre: string;
      precio: number;
      cantidad: number;
      tamanio: string | null;
    }> = [];
    let total = 0;
    for (const it of datos.items) {
      const prod = await this.dataSource
        .getRepository(ItemCarta)
        .findOneBy({ id: it.id_producto });
      if (!prod) throw new NotFoundException('Producto no encontrado.');

      // Pick the price by size, or the single price.
      let precio = 0;
      const tam = it.tamanio ? it.tamanio.toLowerCase() : '';
      if (tam === 'personal') precio = Number(prod.precio_personal ?? 0);
      else if (tam === 'mediana') precio = Number(prod.precio_mediana ?? 0);
      else if (tam === 'grande') precio = Number(prod.precio_grande ?? 0);
      else precio = Number(prod.precio ?? 0);

      const cantidad = it.cantidad > 0 ? it.cantidad : 1;
      lineas.push({
        id_producto: prod.id,
        nombre: prod.nombre,
        precio,
        cantidad,
        tamanio: it.tamanio || null,
      });
      total += precio * cantidad;
    }

    // Create sale + items in a transaction.
    const venta = await this.dataSource.transaction(async (em) => {
      const v = em.getRepository(Venta).create({
        numero_factura: numeroFactura,
        escenario,
        numero_mesa: datos.numero_mesa || null,
        cliente_nombre: datos.cliente_nombre || null,
        direccion: datos.direccion || null,
        telefono: datos.telefono || null,
        id_forma_pago: datos.id_forma_pago || null,
        forma_pago_nombre: formaPagoNombre,
        total,
        creado_por: usuarioId ?? null,
        fecha: new Date().toISOString(),
      });
      await em.getRepository(Venta).save(v);

      for (const l of lineas) {
        await em.getRepository(VentaItem).save(
          em.getRepository(VentaItem).create({
            id_venta: v.id,
            id_producto: l.id_producto,
            nombre: l.nombre,
            tamanio: l.tamanio,
            cantidad: l.cantidad,
            precio_unitario: l.precio,
            subtotal: l.precio * l.cantidad,
            created_at: new Date().toISOString(),
          }),
        );
      }
      return v;
    });

    return venta;
  }

  /** List sales with their items (for history). */
  async listar(limit = 50, offset = 0) {
    const rows = await this.ventas.find({
      order: { id: 'DESC' },
      take: limit,
      skip: offset,
    });
    const items = await this.ventaItems.find();
    return rows.map((v) => ({
      ...v,
      items: items.filter((i) => i.id_venta === v.id),
    }));
  }

  async obtener(id: number) {
    const v = await this.ventas.findOneBy({ id });
    if (!v) throw new NotFoundException('Venta no encontrada.');
    const items = await this.ventaItems.find({ where: { id_venta: id } });
    return { ...v, items };
  }

  // ---- Payment methods (editable catalog) ----
  async listarFormasPago() {
    return this.formasPago.find({ order: { id: 'ASC' } });
  }
  async crearFormaPago(nombre: string) {
    if (!nombre || !nombre.trim())
      throw new BadRequestException('Nombre inválido.');
    return this.formasPago.save(
      this.formasPago.create({
        nombre: nombre.trim(),
        activo: true,
        created_at: new Date().toISOString(),
      }),
    );
  }
  async actualizarFormaPago(id: number, nombre: string, activo?: boolean) {
    const fp = await this.formasPago.findOneBy({ id });
    if (!fp) throw new NotFoundException('Forma de pago no encontrada.');
    if (nombre !== undefined) fp.nombre = nombre.trim();
    if (activo !== undefined) fp.activo = activo;
    await this.formasPago.save(fp);
    return fp;
  }
  async eliminarFormaPago(id: number) {
    await this.formasPago.delete(id);
    return { ok: true };
  }

  /** Seed default payment methods if the catalog is empty. */
  async seedFormasPago() {
    const count = await this.formasPago.count();
    if (count > 0) return;
    const now = new Date().toISOString();
    for (const n of ['Efectivo', 'Tarjeta', 'Transferencia']) {
      await this.formasPago.save(
        this.formasPago.create({ nombre: n, activo: true, created_at: now }),
      );
    }
  }
}