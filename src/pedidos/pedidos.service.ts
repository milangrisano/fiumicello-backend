import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Pedido } from '../entities/pedido.entity';
import { PedidoItem } from '../entities/pedido-item.entity';
import { ItemCarta } from '../entities/item-carta.entity';
import { FormaPago } from '../entities/forma-pago.entity';

export interface AddItemInput {
  id_producto: number;
  tamanio?: string | null;
  cantidad?: number;
  nota?: string | null;
}

export interface CreatePedidoInput {
  escenario: 'mesa' | 'para_llevar' | 'domicilio';
  numero_mesa?: string | null;
  cliente_nombre?: string | null;
  direccion?: string | null;
  telefono?: string | null;
  items: AddItemInput[];
}

@Injectable()
export class PedidosService {
  constructor(
    @InjectRepository(Pedido) private readonly pedidos: Repository<Pedido>,
    @InjectRepository(PedidoItem)
    private readonly pedidoItems: Repository<PedidoItem>,
    @InjectRepository(FormaPago)
    private readonly formasPago: Repository<FormaPago>,
    private readonly dataSource: DataSource,
  ) {}

  private precio(prod: ItemCarta, tamanio?: string | null): number {
    const t = (tamanio || '').toLowerCase();
    if (t === 'personal') return Number(prod.precio_personal ?? 0);
    if (t === 'mediana') return Number(prod.precio_mediana ?? 0);
    if (t === 'grande') return Number(prod.precio_grande ?? 0);
    return Number(prod.precio ?? 0);
  }

  private async recalcularDirecto(
    pedidoId: number,
    repo?: Repository<PedidoItem>,
  ): Promise<number> {
    const itemRepo = repo ?? this.pedidoItems;
    const items = await itemRepo.find({ where: { id_pedido: pedidoId } });
    let t = 0;
    for (const i of items) t += Number(i.subtotal);
    return t;
  }

  /** Create an order from its items (price snapshot at creation time). */
  async crear(data: CreatePedidoInput, usuarioId: number): Promise<Pedido> {
    if (!data.items || data.items.length === 0) {
      throw new BadRequestException('El pedido debe incluir al menos un item.');
    }
    const escenario = data.escenario || 'mesa';
    if (escenario === 'mesa' && !data.numero_mesa) {
      throw new BadRequestException('Indique el número de mesa.');
    }
    if (escenario === 'mesa' && data.numero_mesa) {
      const abierta = await this.pedidos.findOne({
        where: { estado: 'abierta', escenario: 'mesa', numero_mesa: data.numero_mesa },
      });
      if (abierta) {
        throw new BadRequestException(
          `La mesa ${data.numero_mesa} ya está abierta. Agrégale productos o pide su cuenta.`,
        );
      }
    }
    if (escenario === 'para_llevar' && !data.cliente_nombre) {
      throw new BadRequestException('Indique el nombre de la persona para llevarla.');
    }
    if (escenario === 'domicilio' && !data.cliente_nombre) {
      throw new BadRequestException('Indique el nombre para el domicilio.');
    }

    const p = await this.dataSource.transaction(async (em) => {
      const ped = em.getRepository(Pedido).create({
        estado: 'abierta',
        escenario,
        numero_mesa: data.numero_mesa || null,
        cliente_nombre: data.cliente_nombre || null,
        direccion: data.direccion || null,
        telefono: data.telefono || null,
        total: 0,
        creado_por: usuarioId ?? null,
        hora_pedido: new Date().toISOString(),
      });
      await em.getRepository(Pedido).save(ped);
      await this.agregarItems(ped.id, data.items, em.getRepository(PedidoItem));
      ped.total = await this.recalcularDirecto(ped.id, em.getRepository(PedidoItem));
      await em.getRepository(Pedido).save(ped);
      return ped;
    });
    return this.obtener(p.id);
  }

  private async agregarItems(
    pedidoId: number,
    items: AddItemInput[],
    repo?: Repository<PedidoItem>,
  ) {
    const itemRepo = repo ?? this.pedidoItems;
    for (const it of items) {
      const prod = await this.dataSource
        .getRepository(ItemCarta)
        .findOneBy({ id: it.id_producto });
      if (!prod) throw new NotFoundException('Producto no encontrado.');
      const cantidad = it.cantidad && it.cantidad > 0 ? it.cantidad : 1;
      const precio = this.precio(prod, it.tamanio);
      await itemRepo.save(
        itemRepo.create({
          id_pedido: pedidoId,
          id_producto: prod.id,
          nombre: prod.nombre,
          tamanio: it.tamanio || null,
          cantidad,
          precio_unitario: precio,
          subtotal: precio * cantidad,
          nota: it.nota || null,
          created_at: new Date().toISOString(),
        }),
      );
    }
  }

  /** Add product(s) + note to an OPEN order. */
  async agregarItemsApi(id: number, items: AddItemInput[]) {
    const p = await this.pedidos.findOneBy({ id });
    if (!p) throw new NotFoundException('Pedido no encontrado.');
    if (p.estado !== 'abierta') {
      throw new ForbiddenException('Solo se pueden agregar items a pedidos abiertos.');
    }
    await this.agregarItems(id, items);
    const total = await this.recalcularDirecto(id);
    p.total = total;
    await this.pedidos.save(p);
    return this.obtener(id);
  }

  async listar(estado?: string, escenario?: string) {
    const where: any = {};
    if (estado) where.estado = estado;
    if (escenario) where.escenario = escenario;
    const rows = await this.pedidos.find({ where, order: { id: 'DESC' } });
    const items = await this.pedidoItems.find();
    const out: any[] = [];
    for (const p of rows) {
      out.push(this.shape(p, items.filter((i) => i.id_pedido === p.id)));
    }
    return out;
  }

  async obtener(id: number) {
    const p = await this.pedidos.findOneBy({ id });
    if (!p) throw new NotFoundException('Pedido no encontrado.');
    const items = await this.pedidoItems.find({ where: { id_pedido: id } });
    return this.shape(p, items);
  }

  private shape(p: Pedido, items: PedidoItem[]) {
    return { ...p, items };
  }

  /** Charge the order (mesa -> facturada; para_llevar/domicilio -> pagada_pendiente). */
  async cobrar(id: number, idFormaPago?: number | null) {
    const p = await this.pedidos.findOneBy({ id });
    if (!p) throw new NotFoundException('Pedido no encontrado.');
    if (p.estado !== 'abierta') {
      throw new ForbiddenException('El pedido ya no está abierto.');
    }
    let formaPagoNombre: string | null = null;
    if (idFormaPago) {
      const fp = await this.formasPago.findOneBy({ id: idFormaPago });
      if (fp) formaPagoNombre = fp.nombre;
    }
    p.id_forma_pago = idFormaPago || null;
    p.forma_pago_nombre = formaPagoNombre;
    p.numero_factura = await this.siguienteNumeroFactura();
    if (p.escenario === 'mesa') {
      p.estado = 'facturada';
    } else {
      p.estado = 'pagada_pendiente';
    }
    await this.pedidos.save(p);
    return this.obtener(id);
  }

  /** Mark a para_llevar/domicilio order as delivered. */
  async entregar(id: number) {
    const p = await this.pedidos.findOneBy({ id });
    if (!p) throw new NotFoundException('Pedido no encontrado.');
    if (p.escenario === 'mesa') {
      throw new ForbiddenException('Las mesas no se entregan; se cierran al cobrar.');
    }
    if (p.estado !== 'pagada_pendiente') {
      throw new ForbiddenException('El pedido no está pendiente de entrega.');
    }
    p.estado = 'entregada';
    p.hora_entrega = new Date().toISOString();
    await this.pedidos.save(p);
    return this.obtener(id);
  }

  async cancelar(id: number) {
    const p = await this.pedidos.findOneBy({ id });
    if (!p) throw new NotFoundException('Pedido no encontrado.');
    await this.pedidoItems.delete({ id_pedido: id });
    await this.pedidos.delete(id);
    return { ok: true };
  }

  private async siguienteNumeroFactura(): Promise<string> {
    const last = await this.pedidos
      .createQueryBuilder('p')
      .where('p.numero_factura IS NOT NULL')
      .orderBy('p.id', 'DESC')
      .getOne();
    let n = 0;
    if (last && last.numero_factura) {
      const m = /F-(\d+)/.exec(last.numero_factura);
      if (m) n = parseInt(m[1], 10);
    }
    return `F-${String(n + 1).padStart(4, '0')}`;
  }
}

// alias for clarity in the create signature above
type CreateUserInput = CreatePedidoInput;