import { Entity, PrimaryGeneratedColumn, Column, BeforeInsert, BeforeUpdate } from 'typeorm';

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

  // Últimos 4 dígitos hallados en el método de pago (identifica cuenta/tarjeta).
  @Column({ type: 'text', nullable: true })
  metodo_pago_ultimos4: string | null;

  @BeforeInsert()
  @BeforeUpdate()
  calcularUltimos4() {
    this.metodo_pago_ultimos4 = extraer4(this.metodo_pago);
  }
}

/** Extrae los últimos 4 dígitos de un texto (ej. 'Bancolombia 582-000467-98' -> '6798'). */
export function extraer4(texto: string | null | undefined): string | null {
  if (!texto) return null;
  const digitos = texto.replace(/\D/g, '');
  if (digitos.length < 4) return null;
  return digitos.slice(-4);
}