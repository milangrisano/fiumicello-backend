import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

/**
 * A line item of a sale (Venta). Stores a snapshot of the product name + price
 * at sale time (so later catalog edits/price changes don't alter history).
 */
@Entity('venta_items')
export class VentaItem {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'integer', nullable: false })
  id_venta: number;

  // Reference to the menu product (carta_items), when known.
  @Column({ type: 'integer', nullable: true })
  id_producto: number | null;

  @Column({ type: 'text', nullable: false })
  nombre: string;

  @Column({ type: 'text', nullable: true })
  tamanio: string | null; // Personal | Mediana | Grande | null (single price)

  @Column({ type: 'integer', nullable: false, default: 1 })
  cantidad: number;

  @Column({ type: 'numeric', precision: 14, scale: 2, nullable: false })
  precio_unitario: number;

  @Column({ type: 'numeric', precision: 14, scale: 2, nullable: false })
  subtotal: number; // precio_unitario * cantidad

  @Column({ type: 'text', nullable: true })
  created_at: string | null;
}