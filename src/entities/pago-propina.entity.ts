import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

/** Record of when tip money was paid/delivered to workers. */
@Entity('pagos_propina')
export class PagoPropina {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'text', nullable: false })
  fecha_pago: string;

  @Column({ type: 'numeric', precision: 14, scale: 2, nullable: false, default: 0 })
  monto_efectivo: number;

  @Column({ type: 'numeric', precision: 14, scale: 2, nullable: false, default: 0 })
  monto_otros: number;

  @Column({ type: 'integer', nullable: true })
  turnos_desde: number | null;

  @Column({ type: 'integer', nullable: true })
  turnos_hasta: number | null;

  @Column({ type: 'integer', nullable: true })
  quien_registra: number | null;

  @Column({ type: 'text', nullable: true })
  notas: string | null;
}
