import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

/** A line item of an order, with an optional note (ingredient changes). */
@Entity('pedido_items')
export class PedidoItem {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'integer', nullable: false })
  id_pedido: number;

  @Column({ type: 'integer', nullable: true })
  id_producto: number | null;

  @Column({ type: 'text', nullable: false })
  nombre: string;

  @Column({ type: 'text', nullable: true })
  tamanio: string | null;

  @Column({ type: 'integer', nullable: false, default: 1 })
  cantidad: number;

  @Column({ type: 'numeric', precision: 14, scale: 2, nullable: false })
  precio_unitario: number;

  @Column({ type: 'numeric', precision: 14, scale: 2, nullable: false })
  subtotal: number;

  // Note: e.g. "sin cebolla", "quitar aceitunas".
  @Column({ type: 'text', nullable: true })
  nota: string | null;

  @Column({ type: 'text', nullable: true })
  created_at: string | null;
}