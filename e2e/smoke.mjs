#!/usr/bin/env node
/**
 * SMOKE E2E — Fiumicello API
 *
 * Recorre la app en UNA sola corrida contra el stack real (:test) por nginx.
 * Verifica auth, permisos deny-by-default, DTOs (forbidNonWhitelisted),
 * seguridad /archivos, OCR, desactivar/reactivar, Swagger.
 * Sin intervención humana: al final "x/y PASSED" + exit code 0/1.
 *
 * CORRE dentro del contenedor backend (node 22 + bcrypt + psql + creds en env).
 * Golpea http://frontend/api (nginx → backend = pila real). Crea un superadmin
 * temporal + un usuario operativo al vuelo y los borra al final.
 *
 * El login tiene rate-limit (@Throttle 8/min por IP — defensa anti fuerza bruta).
 * El runner respeta ese límite: reintenta con backoff si recibe 429.
 *
 * Uso:
 *   docker cp e2e/smoke.mjs fiumicello-backend:/app/smoke-e2e.mjs
 *   docker exec fiumicello-backend node /app/smoke-e2e.mjs
 */

import { execSync } from 'node:child_process';
import { writeFileSync, unlinkSync } from 'node:fs';

// bcrypt del backend (presente en node_modules del contenedor).
const bcrypt = (await import('bcrypt')).default;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- Config (env del contenedor; secretos nunca se imprimen) ----
const BASE = (process.env.E2E_BASE_URL || '').trim() || 'http://frontend/api';

const DB = {
  host: process.env.DB_HOST || 'db',
  port: process.env.DB_PORT || '5432',
  user: process.env.DB_USER || process.env.POSTGRES_USER || 'fiumicello_user',
  db: process.env.DB_NAME || process.env.POSTGRES_DB || 'fiumicello',
  pass: process.env.DB_PASS || process.env.POSTGRES_PASSWORD || '',
};

// Usuarios temporales que el runner crea y borra (no toca los de Enrique).
const ADMIN_EMAIL = `smoke_admin_${Date.now()}@test.local`;
const ADMIN_PASS = 'Smoke-Admin-Pass-2026!';
const TEST_EMAIL = `smoke_${Date.now()}@test.local`;
const TEST_PASS = 'Smoke-Test-Pass-2026!';
const TEST_ROL = 'cocinero';

// ---- Harness ----
let passed = 0, failed = 0;
const failures = [];
function check(name, cond, detail = '') {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; failures.push(name + (detail ? ` — ${detail}` : '')); console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`); }
}

// ---- HTTP ----
async function raw(method, path, { token = null, body = null, base = BASE } = {}) {
  const headers = {};
  if (body !== null) headers['Content-Type'] = 'application/json';
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${base}${path}`, {
    method, headers, body: body !== null ? JSON.stringify(body) : undefined,
  });
  const text = await res.text().catch(() => '');
  let data = null;
  if (text) { try { data = JSON.parse(text); } catch {} }
  return { status: res.status, data, text };
}

// Login con backoff ante 429 (rate-limit del backend): espera y reintenta,
// pero solo hasta un tope — el test no debe dedicar minutos a esto.
async function loginConBackoff(email, password) {
  for (let i = 0; i < 4; i++) {
    const r = await raw('POST', '/auth/login', { body: { email, password } });
    if (r.status === 429) {
      console.log('     (429 rate-limit → esperando 5s y reintento)');
      await sleep(5000 + i * 3000);
      continue;
    }
    return r;
  }
  return { status: 429, data: null, text: 'rate limited' };
}

// ---- DB (psql -f para no corromper hashes con $) ----
const PSQL_TMP = '/tmp/smoke_psql.sql';
function psql(sql) {
  writeFileSync(PSQL_TMP, sql);
  try {
    return execSync(
      `psql -h ${DB.host} -p ${DB.port} -U ${DB.user} -d ${DB.db} -tA -f ${PSQL_TMP}`,
      { env: { ...process.env, PGPASSWORD: DB.pass }, encoding: 'utf-8' },
    ).trim();
  } finally {
    try { unlinkSync(PSQL_TMP); } catch {}
  }
}

async function crearUsuario(email, pass, rol, estado = 'aprobado') {
  const hash = await bcrypt.hash(pass, 10);
  psql(`INSERT INTO usuarios (email, password_hash, rol, estado) VALUES ('${email}', '${hash}', '${rol}', '${estado}');`);
}

function limpiarUsuarios() {
  for (const e of [ADMIN_EMAIL, TEST_EMAIL]) {
    try { psql(`DELETE FROM usuarios WHERE email='${e}';`); } catch {}
  }
}

// ---- SUITE ----
async function main() {
  console.log(`\n🧪 Smoke E2E Fiumicello — ${new Date().toISOString()}`);
  console.log(`   Base: ${BASE}`);

  await crearUsuario(ADMIN_EMAIL, ADMIN_PASS, 'superadmin');
  await crearUsuario(TEST_EMAIL, TEST_PASS, TEST_ROL);

  // ============ AUTH ============
  console.log('\n── AUTH ──');
  const login = await loginConBackoff(ADMIN_EMAIL, ADMIN_PASS);
  check('login superadmin temporal → 200 + access_token', login.status === 200 && !!login.data?.access_token, `status=${login.status}`);
  const ADMIN = login.data?.access_token;
  await sleep(1200);
  const malPass = await loginConBackoff(ADMIN_EMAIL, 'clave-incorrecta');
  check('login clave mala → 401', malPass.status === 401, `status=${malPass.status}`);

  // ============ PÚBLICAS ============
  console.log('\n── PÚBLICAS ──');
  const health = await raw('GET', '/health');
  check('GET /health → 200 ok', health.status === 200 && health.data?.status === 'ok', `status=${health.status}`);
  const carta = await raw('GET', '/carta');
  check('GET /carta → 200', carta.status === 200, `status=${carta.status}`);

  // ============ PERMISOS deny-by-default ============
  console.log('\n── PERMISOS ──');
  const noToken = await raw('GET', '/facturas');
  check('GET /facturas sin token → 403 (deny)', noToken.status === 403, `status=${noToken.status}`);
  const conSuper = await raw('GET', '/facturas', { token: ADMIN });
  check('GET /facturas con superadmin → 200 (bypass)', conSuper.status === 200, `status=${conSuper.status}`);
  await sleep(1200);
  const loginCocinero = await loginConBackoff(TEST_EMAIL, TEST_PASS);
  check('login usuario de prueba (cocinero) → 200', loginCocinero.status === 200, `status=${loginCocinero.status}`);
  const COCINERO = loginCocinero.data?.access_token;
  const comoCocinero = await raw('GET', '/facturas', { token: COCINERO });
  check('GET /facturas con cocinero → 403 (deny)', comoCocinero.status === 403, `status=${comoCocinero.status}`);
  const cocina = await raw('GET', '/pedidos/cocina/cola', { token: COCINERO });
  check('GET cocina/cola con cocinero → 200 (cocina:ver)', cocina.status === 200, `status=${cocina.status}`);

  // ============ DTOs (forbidNonWhitelisted) ============
  console.log('\n── DTOs ──');
  const caja = await raw('POST', '/caja/abrir', { token: ADMIN, body: { efectivo_inicial: 10, hack: 1 } });
  check('POST /caja/abrir + campo extra → 400', caja.status === 400, `status=${caja.status}`);
  const venta = await raw('POST', '/ventas', { token: ADMIN, body: { escenario: 'mesa', items: [{ id_producto: 1, cantidad: 1, zz: 1 }] } });
  check('POST /ventas item + campo extra → 400', venta.status === 400, `status=${venta.status}`);
  const fact = await raw('POST', '/facturas', { token: ADMIN, body: { proveedor: 'X', total_con_impuestos: 1, extra: 'y' } });
  check('POST /facturas + campo extra → 400', fact.status === 400, `status=${fact.status}`);
  const rol = await raw('POST', '/auth/roles', { token: ADMIN, body: { nombre: 'R', permisos: 'no-array' } });
  check('POST roles permisos no-array → 400', rol.status === 400, `status=${rol.status}`);

  // ============ SEGURIDAD /archivos ============
  console.log('\n── SEGURIDAD /archivos ──');
  const pdfSin = await raw('GET', '/archivos/facturas/x.pdf', { base: BASE.replace('/api', '') });
  check('GET /archivos sin token → 401', pdfSin.status === 401, `status=${pdfSin.status}`);
  const swagSin = await raw('GET', '/docs-json');
  check('GET /api/docs-json sin token → 401', swagSin.status === 401, `status=${swagSin.status}`);
  const swagCon = await raw('GET', '/docs-json', { token: ADMIN });
  check('GET /api/docs-json con admin → 200', swagCon.status === 200, `status=${swagCon.status}`);

  // ============ OCR ============
  console.log('\n── OCR ──');
  const ocrSin = await raw('POST', '/ocr/subir');
  check('POST /ocr/subir sin token → 403 (deny)', ocrSin.status === 403, `status=${ocrSin.status}`);
  const ocrHuman = await raw('POST', '/ocr/subir', { token: ADMIN });
  check('POST /ocr/subir con JWT admin → 403 (blindaje)', ocrHuman.status === 403, `status=${ocrHuman.status}`);

  // ============ DESACTIVAR / REACTIVAR ============
  console.log('\n── DESACTIVAR/REACTIVAR ──');
  const idCocinero = psql(`SELECT id FROM usuarios WHERE email='${TEST_EMAIL}';`);
  if (idCocinero) {
    const desac = await raw('POST', `/auth/usuarios/${idCocinero}/estado`, { token: ADMIN, body: { estado: 'desactivado' } });
    check('desactivar usuario → 200', desac.status === 200, `status=${desac.status}`);
    await sleep(1200);
    const loginDes = await loginConBackoff(TEST_EMAIL, TEST_PASS);
    check('login tras desactivar → 401', loginDes.status === 401, `status=${loginDes.status}`);
    const react = await raw('POST', `/auth/usuarios/${idCocinero}/estado`, { token: ADMIN, body: { estado: 'aprobado' } });
    check('reactivar usuario → 200', react.status === 200, `status=${react.status}`);
    await sleep(1200);
    const loginReact = await loginConBackoff(TEST_EMAIL, TEST_PASS);
    check('login tras reactivar → 200', loginReact.status === 200, `status=${loginReact.status}`);
  } else {
    check('usuario de prueba creado', false, 'no se encontró en BD');
  }

  // ============ RESUMEN ============
  limpiarUsuarios();
  console.log(`\n${'─'.repeat(54)}`);
  console.log(`\n📊 RESULTADO: ${passed} ✅ / ${failed} ❌`);
  if (failed > 0) {
    console.log('\nFALLOS:');
    failures.forEach((f) => console.log(`  • ${f}`));
    process.exit(1);
  }
  console.log('\n🎉 TODO PASÓ.');
}

main().catch((e) => { console.error('Error en el runner:', e); try { limpiarUsuarios(); } catch {} process.exit(1); });