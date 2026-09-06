import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

/**
 * A menu category (e.g. Pizzas, Pizzas de la Casa, Pastas, Paninis, Bebidas).
 */
@Entity('carta_categorias')
export class CategoriaCarta {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'text', nullable: false })
  nombre: string;

  @Column({ type: 'integer', nullable: false, default: 0 })
  orden: number;

  @Column({ type: 'text', nullable: true })
  created_at: string | null;
}