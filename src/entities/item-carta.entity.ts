import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

/**
 * A menu item, belonging to a category, with optional per-size prices (COP).
 * Items that don't have sizes (drinks, sandwich) use `precio` only.
 */
@Entity('carta_items')
export class ItemCarta {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'integer', nullable: false })
  id_categoria: number;

  @Column({ type: 'text', nullable: false })
  nombre: string;

  @Column({ type: 'text', nullable: true })
  descripcion: string | null;

  // Simple price (items without sizes).
  @Column({ type: 'numeric', precision: 14, scale: 2, nullable: true })
  precio: number | null;

  // Per-size prices (pizzas/pastas have these).
  @Column({ type: 'numeric', precision: 14, scale: 2, nullable: true })
  precio_personal: number | null;
  @Column({ type: 'numeric', precision: 14, scale: 2, nullable: true })
  precio_mediana: number | null;
  @Column({ type: 'numeric', precision: 14, scale: 2, nullable: true })
  precio_grande: number | null;

  @Column({ type: 'integer', nullable: false, default: 0 })
  orden: number;

  // Whether the product is offered. Public carta shows only active items;
  // disabled products are hidden from the menu but kept for history/admin.
  @Column({ type: 'boolean', nullable: false, default: true })
  activo: boolean;

  @Column({ type: 'text', nullable: true })
  created_at: string | null;
}