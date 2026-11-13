import * as crypto from 'crypto';

/** Env helper: fails fast in production when a required env var is missing,
 *  never falls back to a hardcoded/public value.
 *
 *  For JWT in DEV (not production): passport-jwt rejects an empty secret
 *  (`JwtStrategy requires a secret or key`), so when the var is missing in dev
 *  we generate an ephemeral random secret in memory — not hardcoded, not
 *  reused, and never reachable in production (prod requires the real var).
 */
export function requireEnv(name: string, descripcion: string): string {
  const v = process.env[name];
  if (!v && process.env.NODE_ENV === 'production') {
    throw new Error(`❌ Falta ${name} (${descripcion}). No se arranca en producción.`);
  }
  if (v) return v;
  // Dev: sin la variable → secret efímero en memoria (jamás una clave pública).
  if (name === 'JWT_SECRET' && process.env.NODE_ENV !== 'production') {
    return crypto.randomBytes(48).toString('base64url');
  }
  return '';
}