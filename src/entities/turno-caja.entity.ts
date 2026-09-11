import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

/** Cash shift: opening/closing of the cash drawer by a cashier. */
@Entity('turnos_caja')
export class TurnoCaja {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'integer', nullable: false })
  id_cajero: number;

  @Column({ type: 'text', nullable: false })
  fecha: string;

  // Número de turno dentro del día (1, 2, 3...) — cuenta todos los turnos de la fecha.
  @Column({ type: 'integer', nullable: false, default: 0 })
  numero_dia: number;

  // abierto | cerrado
  @Column({ type: 'text', nullable: false, default: 'abierto' })
  estado: string;

  @Column({ type: 'numeric', precision: 14, scale: 2, nullable: false, default: 0 })
  efectivo_inicial: number;

  @Column({ type: 'numeric', precision: 14, scale: 2, nullable: true })
  efectivo_final: number | null;

  // Cash tip that left the drawer this shift (workers take it).
  @Column({ type: 'numeric', precision: 14, scale: 2, nullable: false, default: 0 })
  propina_efectivo: number;

  // Tip received via other means (Qr/Nequi/etc.) owed to workers by the company.
  @Column({ type: 'numeric', precision: 14, scale: 2, nullable: false, default: 0 })
  propina_otros: number;

  // Shortage (cash missing). If > 0 the shift CANNOT be closed.
  @Column({ type: 'numeric', precision: 14, scale: 2, nullable: false, default: 0 })
  diferencia: number;

  @Column({ type: 'timestamptz', nullable: true, default: () => 'now()' })
  apertura_at: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  cierre_at: Date | null;

  @Column({ type: 'text', nullable: true })
  notas: string | null;
}
