/**
 * Utilidades de fecha/hora — zona del restaurante: America/Bogota (UTC-5).
 *
 * El backend guarda fechas/timestamps en las entidades de negocio (ventas, turnos,
 * pedidos). Con `new Date().toISOString()` quedan en UTC, y entre 00:00 y 04:59 hora
 * local el día registrado se adelanta al siguiente (ej. 23:54 del 07-10 local -> 04:54
 * del 08-10 en UTC). Estos helpers devuelven la fecha en la zona local del restaurante.
 */

const TZ_OFFSET_MS = -5 * 60 * 60 * 1000; // America/Bogota (UTC-5)

/**
 * Timestamp actual en la zona local (America/Bogota) como ISO 8601 con offset -05:00.
 * Ej.: 2026-10-07T23:54:00.000-05:00  (el día coincide con el local)
 */
export function nowLocalISO(): string {
  const d = new Date(Date.now() + TZ_OFFSET_MS);
  return d.toISOString().replace(/Z$/, '-05:00');
}

/**
 * Fecha local de hoy (America/Bogota) como YYYY-MM-DD, para agrupaciones por día.
 */
export function hoyLocal(): string {
  return nowLocalISO().slice(0, 10);
}

/**
 * Aplica el offset local a un Date/ISO dado (para convertir un valor ya generado).
 */
export function toLocalISO(val: Date | string): string {
  const d = val instanceof Date ? val : new Date(val);
  const shifted = new Date(d.getTime() + TZ_OFFSET_MS);
  return shifted.toISOString().replace(/Z$/, '-05:00');
}

/**
 * Date actual desplazado a la zona local (America/Bogota). Útil para columnas tipo
 * timestamp (Date): el valor almacenado, leído en UTC, ya representa el día/hora local.
 */
export function nowLocalDate(): Date {
  return new Date(Date.now() + TZ_OFFSET_MS);
}