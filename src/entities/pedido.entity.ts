import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

/**
 * A POS order. Lifecycle depends on the scenario:
 *  - mesa:            abierta -> (pedida la cuenta) -> facturada
 *  - para_llevar / domicilio: abierta -> pagada_pendiente (cobrada al finalizar
 *    comanda) -> entregada.
 * Times h_pedido / hora_entrega support delivery follow-up.
 */
@Entity('pedidos')
export class Pedido {
  @PrimaryGeneratedColumn()
  id: number;

  // abierta | facturada | pagada_pendiente | entregada
  @Column({ type: 'text', nullable: false, default: 'abierta' })
  estado: string;

  // Estado de cocina de la comanda completa:
  //   recibida -> preparando -> lista -> retirada
  // (recibida/preparando/lista los pone el cocinero; retirada el mesero al
  //  llevarla a la mesa). Independiente del estado de venta/facturación.
  @Column({ type: 'text', nullable: false, default: 'recibida' })
  estado_cocina: string;

  // mesa | para_llevar | domicilio
  @Column({ type: 'text', nullable: false })
  escenario: string;

  @Column({ type: 'text', nullable: true })
  numero_mesa: string | null;

  @Column({ type: 'text', nullable: true })
  cliente_nombre: string | null;

  @Column({ type: 'text', nullable: true })
  direccion: string | null;

  @Column({ type: 'text', nullable: true })
  telefono: string | null;

  @Column({ type: 'integer', nullable: true })
  id_forma_pago: number | null;

  @Column({ type: 'text', nullable: true })
  forma_pago_nombre: string | null;

  @Column({ type: 'numeric', precision: 18, scale: 2, nullable: false, default: 0 })
  total: number;

  // Visible consecutive invoice number, set when charged (F-000N). Unique (fail loud).
  @Column({ type: 'text', nullable: true, unique: true })
  numero_factura: string | null;

  @Column({ type: 'integer', nullable: true })
  creado_por: number | null;

  @Column({ type: 'text', nullable: true })
  hora_pedido: string | null;

  @Column({ type: 'text', nullable: true })
  hora_entrega: string | null;
}