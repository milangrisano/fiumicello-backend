import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity('facturas_items')
export class FacturaItem {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'integer', nullable: true })
 id_factura: number | null;

  @Column({ type: 'text', nullable: true })
 descripcion: string | null;

  @Column({ type: 'numeric', precision: 18, scale: 4, nullable: true })
 cantidad: number | null;

  @Column({ type: 'numeric', precision: 18, scale: 4, nullable: true })
 precio_unitario: number | null;

  @Column({ type: 'numeric', precision: 18, scale: 4, nullable: true })
 base_imponible: number | null;

  @Column({ type: 'numeric', precision: 18, scale: 4, nullable: true })
 iva: number | null;

  @Column({ type: 'numeric', precision: 18, scale: 4, nullable: true })
 total: number | null;

  @Column({ type: 'text', nullable: true })
 categoria: string | null;

  @Column({ type: 'text', nullable: true })
 numero_factura: string | null;

  @Column({ type: 'text', nullable: true })
 fecha_factura: string | null;

  @Column({ type: 'text', nullable: true })
 proveedor: string | null;

  @Column({ type: 'text', nullable: true })
 moneda: string | null;
}