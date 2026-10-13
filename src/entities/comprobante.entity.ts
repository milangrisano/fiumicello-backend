import { Entity, PrimaryGeneratedColumn, Column, BeforeInsert, BeforeUpdate } from 'typeorm';
import { extraer4 } from './factura.entity';

@Entity('comprobantes_pago')
export class ComprobantePago {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'text', nullable: true })
  fecha: string | null;

  @Column({ type: 'text', nullable: true })
  referencia: string | null;

  @Column({ type: 'text', nullable: true })
  beneficiario_emisor: string | null;

  @Column({ type: 'text', nullable: true })
  concepto: string | null;

  @Column({ type: 'numeric', precision: 18, scale: 4, nullable: true })
  total_con_impuestos: number | null;

  @Column({ type: 'text', nullable: true })
  moneda: string | null;

  @Column({ type: 'text', nullable: true })
  metodo_pago: string | null;

  @Column({ type: 'text', nullable: true })
  fecha_pago: string | null;

  @Column({ type: 'numeric', precision: 18, scale: 4, nullable: true })
  base_imponible: number | null;

  @Column({ type: 'numeric', precision: 18, scale: 4, nullable: true })
  iva: number | null;

  @Column({ type: 'text', nullable: true })
  categoria: string | null;

  @Column({ type: 'text', nullable: true })
  estado: string | null;

  @Column({ type: 'text', nullable: true })
  archivo: string | null;

  @Column({ type: 'text', nullable: true })
  nota: string | null;

  @Column({ type: 'text', nullable: true })
  created_at: string | null;

  @Column({ type: 'integer', nullable: true })
  id_factura: number | null;

  @Column({ type: 'text', nullable: true })
  numero_factura: string | null;

  // Clasificación manual del comprobante (override de la automática por
  // beneficiario): 'transferencia' | 'proveedor' | null (auto).
  @Column({ type: 'text', nullable: true })
  tipo_manual: string | null;

  // Últimos 4 dígitos hallados en el método de pago (identifica cuenta/tarjeta).
  @Column({ type: 'text', nullable: true })
  metodo_pago_ultimos4: string | null;

  @BeforeInsert()
  @BeforeUpdate()
  calcularUltimos4() {
    this.metodo_pago_ultimos4 = extraer4(this.metodo_pago);
  }
}
