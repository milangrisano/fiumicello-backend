import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

/**
 * A dynamic size option for a menu item (e.g. Personal, Mediana, Grande,
 * 1/2 Mediana, 1/2 Grande, ...). Items without sizes have no rows here and use
 * `carta_items.precio`. Replaces the fixed 3-column model
 * (precio_personal/precio_mediana/precio_grande) so sizes are unlimited.
 */
@Entity('carta_item_tamanios')
export class CartaItemTamano {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'integer', nullable: false })
  id_item: number;

  // Display name of the size (Personal, Mediana, Grande, 1/2 Mediana, ...).
  @Column({ type: 'text', nullable: false })
  nombre: string;

  @Column({ type: 'numeric', precision: 14, scale: 2, nullable: false })
  precio: number;

  @Column({ type: 'integer', nullable: false, default: 0 })
  orden: number;

  @Column({ type: 'text', nullable: true })
  created_at: string | null;
}