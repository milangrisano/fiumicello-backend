import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

/**
 * A sale (POS invoice). Carries a visible consecutive invoice number (F-0001),
 * the sale scenario (mesa | para_llevar | domicilio), optional customer data,
 * payment method, and total.
 */
@Entity('ventas')
export class Venta {
  @PrimaryGeneratedColumn()
  id: number;

  // Visible consecutive invoice number (e.g. F-0001). Unique (fail loud on dupes).
  @Column({ type: 'text', nullable: false, unique: true })
  numero_factura: string;

  // mesa | para_llevar | domicilio
  @Column({ type: 'text', nullable: false, default: 'mesa' })
  escenario: string;

  @Column({ type: 'text', nullable: true })
  numero_mesa: string | null;

  // para llevar & domicilio: name of the person (required for para llevar)
  @Column({ type: 'text', nullable: true })
  cliente_nombre: string | null;

  // domicilio optional address/phone
  @Column({ type: 'text', nullable: true })
  direccion: string | null;
  @Column({ type: 'text', nullable: true })
  telefono: string | null;

  @Column({ type: 'integer', nullable: true })
  id_forma_pago: number | null;

  @Column({ type: 'text', nullable: true })
  forma_pago_nombre: string | null; // snapshot of the method label

  @Column({ type: 'numeric', precision: 18, scale: 2, nullable: false, default: 0 })
  total: number;

  @Column({ type: 'integer', nullable: false, default: 0 })
  creado_por: number | null;

  @Column({ type: 'integer', nullable: true })
  id_turno: number | null;

  // true => venta ANULADA (se conserva el registro pero se excluye de
  // totales/caja/resúmenes). Solo superadmin puede borrarla físicamente.
  @Column({ type: 'boolean', nullable: false, default: false })
  anulada: boolean;

  /// Motivo de la anulación (opcional) para trazabilidad de anulaciones.
  @Column({ type: 'text', nullable: true })
  motivo_anulacion: string | null;

  @Column({ type: 'text', nullable: true })
  fecha: string | null;
}