import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

/** Cash movement during a shift: egreso (purchase) or ingreso (return, etc.). */
@Entity('movimientos_caja')
export class MovimientoCaja {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'integer', nullable: false })
  id_turno: number;

  // egreso | ingreso
  @Column({ type: 'text', nullable: false })
  tipo: string;

  @Column({ type: 'text', nullable: true })
  concepto: string | null;

  @Column({ type: 'numeric', precision: 14, scale: 2, nullable: false, default: 0 })
  monto: number;

  // Ingresos REQUIRE authorization by admin/encargado.
  @Column({ type: 'integer', nullable: true })
  autorizado_por: number | null;

  @Column({ type: 'integer', nullable: true })
  creado_por: number | null;

  @Column({ type: 'timestamptz', nullable: true, default: () => 'now()' })
  fecha: Date | null;
}
