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

  // Visible consecutive invoice number (e.g. F-0001). Unique.
  @Column({ type: 'text', nullable: false })
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

  @Column({ type: 'text', nullable: true })
  fecha: string | null;
}