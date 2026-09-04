import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity('facturas')
export class Factura {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'text', nullable: true })
  fecha: string | null;

  @Column({ type: 'text', nullable: true })
  numero_factura: string | null;

  @Column({ type: 'text', nullable: true })
  proveedor: string | null;

  @Column({ type: 'text', nullable: true })
 concepto: string | null;

  @Column({ type: 'numeric', precision: 18, scale: 4, nullable: true })
  base_imponible: number | null;

  @Column({ type: 'numeric', precision: 18, scale: 4, nullable: true })
 iva: number | null;

  @Column({ type: 'numeric', precision: 18, scale: 4, nullable: true })
  total_con_impuestos: number | null;

  @Column({ type: 'text', nullable: true })
 moneda: string | null;

  @Column({ type: 'text', nullable: true })
 metodo_pago: string | null;

  @Column({ type: 'text', nullable: true })
 fecha_pago: string | null;

  @Column({ type: 'text', nullable: true })
 estado: string | null;

  @Column({ type: 'text', nullable: true })
 archivo: string | null;

  @Column({ type: 'text', nullable: true })
 nota: string | null;

  @Column({ type: 'text', nullable: true })
 created_at: string | null;

  @Column({ type: 'integer', nullable: true })
 id_comprobante: number | null;

  @Column({ type: 'text', nullable: true })
 referencia_comprobante: string | null;
}