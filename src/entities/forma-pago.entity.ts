import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

/**
 * Payment method (cash, card, transfer, etc.). Editable catalog: the admin can
 * create/rename/disable forms of payment used by the POS.
 */
@Entity('formas_pago')
export class FormaPago {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'text', nullable: false })
  nombre: string;

  @Column({ type: 'boolean', nullable: false, default: true })
  activo: boolean;

  @Column({ type: 'text', nullable: true })
  created_at: string | null;
}