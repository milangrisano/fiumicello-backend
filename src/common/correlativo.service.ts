import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

/**
 * Correlativo central de facturación (F-0001, F-0002, ...).
 *
 * CORRECTO a nivel diseño: una SOLA secuencia de PostgreSQL compartida por
 * comandas (pedidos) y ventas. Reemplaza los viejos `siguienteNumeroFactura()`
 * de `ventas.service.ts` y `pedidos.service.ts`, que hacían "leer última + 1"
 * de forma NO atómica (race condition -> números duplicados) y mantenían DOS
 * contadores independientes (colisiones entre sí sin carrera).
 *
 * `nextval()` de Postgres es atómico: dos requests concurrentes SIEMPRE
 * obtienen valores distintos. Eso elimina la condición de carrera de raíz.
 */
@Injectable()
export class CorrelativoService {
  private static readonly SEQ = 'fiumi_factura_seq';

  constructor(private readonly dataSource: DataSource) {}

  /**
   * Garantiza que la secuencia exista y esté sembrada al máximo de numeración
   * ya existente (parsea formatos F-#### y FV-####). Idempotente.
   */
  async asegurarSecuencia(): Promise<void> {
    // 1) Crear la secuencia si no existe (Postgres no soporta IF NOT EXISTS).
    await this.dataSource.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE c.relkind = 'S' AND c.relname = 'fiumi_factura_seq' AND n.nspname = 'public'
        ) THEN
          CREATE SEQUENCE fiumi_factura_seq;
        END IF;
      END $$;
    `);

    // 2) Max valor numérico ya usado (ventas y comandas, formatos F-/FV-).
    //    substring(text, pattern) devuelve el primer grupo del patrón regex.
    const maxVentas = await this.dataSource.query(
      `SELECT COALESCE(MAX(SUBSTRING(v.numero_factura, 'F-([0-9]+)')::int), 0) AS n
         FROM ventas v WHERE v.numero_factura ~ 'F-[0-9]'`,
    );
    const maxPedidos = await this.dataSource.query(
      `SELECT COALESCE(MAX(SUBSTRING(p.numero_factura, 'F-([0-9]+)')::int), 0) AS n
         FROM pedidos p WHERE p.numero_factura ~ 'F-[0-9]'`,
    );
    const lastVentas = Number(maxVentas?.[0]?.n ?? 0);
    const lastPedidos = Number(maxPedidos?.[0]?.n ?? 0);
    const ultimo = Math.max(lastVentas, lastPedidos, 0);

    // 3) Sembrar al máximo (solo si la secuencia quedó por debajo).
    if (ultimo > 0) {
      await this.dataSource.query(
        `SELECT setval('fiumi_factura_seq', GREATEST((SELECT last_value FROM fiumi_factura_seq), $1))`,
        [ultimo],
      );
    }
  }

  /** Devuelve el siguiente número visible (F-0001, F-0002, ...) de forma atómica. */
  async siguiente(): Promise<string> {
    const r = await this.dataSource.query(`SELECT nextval('fiumi_factura_seq') AS n`);
    const n = Number(r[0].n);
    return `F-${String(n).padStart(4, '0')}`;
  }
}