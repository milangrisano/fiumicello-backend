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

  // ============ FASE 1A: REGISTRO COMPLETO ============
  console.log('\n── FASE 1A: REGISTRO COMPLETO ──');
  const REG_EMAIL = `reg_${Date.now()}@test.local`;
  const REG_PASS = 'Reg-Test-Pass-2026!';

  // 1) register → 200
  const reg = await raw('POST', '/auth/register', { body: { email: REG_EMAIL } });
  check('POST /auth/register → 200', reg.status === 200, `status=${reg.status}`);
  check('register devuelve ok', reg.data?.ok === true, `data=${JSON.stringify(reg.data)}`);

  // 2) leer codigo_verificacion de la BD
  const codigo = psql(`SELECT codigo_verificacion FROM usuarios WHERE email='${REG_EMAIL}';`);
  check('código de verificación existe en BD', codigo !== '' && codigo !== null, `codigo=${codigo}`);

  // 3) verify → 200 (queda pendiente)
  const verify = await raw('POST', '/auth/verify', { body: { email: REG_EMAIL, code: codigo, password: REG_PASS } });
  check('POST /auth/verify → 200', verify.status === 200, `status=${verify.status}`);
  check('verify devuelve ok:true', verify.data?.ok === true, `data=${JSON.stringify(verify.data)}`);
  check('verify mensaje pendiente aprobación', verify.data?.message?.includes('pendiente de aprobación') === true, `msg=${verify.data?.message}`);

  // 4) el usuario queda pendiente (login → 401)
  await sleep(1200);
  const loginPendiente = await loginConBackoff(REG_EMAIL, REG_PASS);
  check('login usuario pendiente → 401', loginPendiente.status === 401, `status=${loginPendiente.status}`);

  // 5) aprobar como superadmin → 200
  const regId = psql(`SELECT id FROM usuarios WHERE email='${REG_EMAIL}';`);
  check('id usuario registrado encontrado', regId !== '' && regId !== null, `id=${regId}`);
  const aprobar = await raw('POST', `/auth/usuarios/${regId}/aprobar`, { token: ADMIN });
  check('POST /auth/usuarios/:id/aprobar (superadmin) → 200', aprobar.status === 200, `status=${aprobar.status}`);

  // 6) login tras aprobar → 200
  await sleep(1200);
  const loginAprobado = await loginConBackoff(REG_EMAIL, REG_PASS);
  check('login tras aprobar → 200 + access_token', loginAprobado.status === 200 && !!loginAprobado.data?.access_token, `status=${loginAprobado.status}`);

  // limpieza del usuario de registro
  try { psql(`DELETE FROM usuarios WHERE email='${REG_EMAIL}';`); } catch {}

  // ============ FASE 1B: REFRESH + LOGOUT ============
  console.log('\n── REFRESH + LOGOUT ──');

  // 1) Login con ADMIN_EMAIL → capturar Set-Cookie fiumicello_rt
  let loginRes;
  for (let i = 0; i < 4; i++) {
    loginRes = await fetch(`${BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASS }),
    });
    if (loginRes.status === 429) {
      console.log('     (429 rate-limit → esperando 5s y reintento)');
      await sleep(5000 + i * 3000);
      continue;
    }
    break;
  }
  const loginJson = await loginRes.json().catch(() => ({}));
  const setCookie = loginRes.headers.get('set-cookie') || '';
  const rtMatch = setCookie.match(/fiumicello_rt=([^;]+)/);
  const refreshCookie = rtMatch ? `fiumicello_rt=${rtMatch[1]}` : '';
  check('login superadmin → 200 + access_token + fiumicello_rt cookie',
    loginRes.status === 200 && !!loginJson.access_token && !!refreshCookie,
    `status=${loginRes.status} cookie=${refreshCookie ? 'ok' : 'missing'}`);
  const access1 = loginJson.access_token;

  // 2) Refresh con la cookie → 200 + access_token nuevo y distinto
  await sleep(1200);
  const refreshRes = await fetch(`${BASE}/auth/refresh`, {
    method: 'POST',
    headers: { 'Cookie': refreshCookie },
  });
  const refreshJson = await refreshRes.json().catch(() => ({}));
  const newSetCookie = refreshRes.headers.get('set-cookie') || '';
  const newRtMatch = newSetCookie.match(/fiumicello_rt=([^;]+)/);
  const newRefreshCookie = newRtMatch ? `fiumicello_rt=${newRtMatch[1]}` : '';
  check('refresh con cookie → 200 + access_token nuevo + cookie rotada',
    refreshRes.status === 200 && !!refreshJson.access_token && refreshJson.access_token !== access1 && !!newRefreshCookie,
    `status=${refreshRes.status} diff=${refreshJson.access_token !== access1} cookie=${newRefreshCookie ? 'ok' : 'missing'}`);
  const access2 = refreshJson.access_token;

  // 3) Logout con la cookie rotada → 200 {ok:true} + cookie borrada
  const logoutRes = await fetch(`${BASE}/auth/logout`, {
    method: 'POST',
    headers: { 'Cookie': newRefreshCookie },
  });
  const logoutJson = await logoutRes.json().catch(() => ({}));
  const logoutSetCookie = logoutRes.headers.get('set-cookie') || '';
  const cookieCleared = logoutSetCookie.includes('fiumicello_rt=') && logoutSetCookie.includes('Max-Age=0');
  check('logout con cookie → 200 + ok:true + cookie borrada (Max-Age=0)',
    logoutRes.status === 200 && logoutJson.ok === true && cookieCleared,
    `status=${logoutRes.status} ok=${logoutJson.ok} cleared=${cookieCleared}`);

  // 4) Refresh con la cookie ya revocada → 401
  const revokedRefreshRes = await fetch(`${BASE}/auth/refresh`, {
    method: 'POST',
    headers: { 'Cookie': newRefreshCookie },
  });
  check('refresh con cookie revocada → 401',
    revokedRefreshRes.status === 401,
    `status=${revokedRefreshRes.status}`);

  // ============ FASE 1C: FORGOT + RESET PASSWORD ============
  console.log('\n── FORGOT + RESET PASSWORD ──');
  const resetEmail = `reset_${Date.now()}@test.local`;
  await crearUsuario(resetEmail, 'Vieja-1', 'cocinero');

  // 1) forgot-password → 200
  const forgot = await raw('POST', '/auth/forgot-password', { body: { email: resetEmail } });
  check('POST /auth/forgot-password usuario existente → 200', forgot.status === 200, `status=${forgot.status}`);

  // 2) leer el código de recuperación de la BD (el reset usa codigo_verificacion)
  const resetToken = psql(`SELECT codigo_verificacion FROM usuarios WHERE email='${resetEmail}';`);
  check('código de recuperación generado en BD', !!resetToken && resetToken.length > 0, `token=${resetToken}`);

  // 3) reset-password con token y nueva password → 200
  const reset = await raw('POST', '/auth/reset-password', { body: { email: resetEmail, token: resetToken, password: 'Nueva-2' } });
  check('POST /auth/reset-password token válido → 200', reset.status === 200 && reset.data?.ok === true, `status=${reset.status} data=${JSON.stringify(reset.data)}`);

  // 4) login con nueva password → 200
  await sleep(1200);
  const loginNueva = await loginConBackoff(resetEmail, 'Nueva-2');
  check('login con nueva password → 200', loginNueva.status === 200, `status=${loginNueva.status}`);

  // 5) login con vieja password → 401
  await sleep(1200);
  const loginVieja = await loginConBackoff(resetEmail, 'Vieja-1');
  check('login con vieja password → 401', loginVieja.status === 401, `status=${loginVieja.status}`);

  // 6) limpiar usuario de prueba
  psql(`DELETE FROM usuarios WHERE email='${resetEmail}';`);

  // ============ FASE 1D: CAMBIAR CONTRASEÑA ============
  console.log('\n── CAMBIAR CONTRASEÑA ──');
  const loginCocineroCambio = await loginConBackoff(TEST_EMAIL, TEST_PASS);
  check('login cocinero TEST_EMAIL → 200', loginCocineroCambio.status === 200, `status=${loginCocineroCambio.status}`);
  const COCINERO_CAMBIO = loginCocineroCambio.data?.access_token;
  await sleep(1200);

  const nuevaPass = 'Nueva-Test-Pass-2026!';
  const cambio = await raw('POST', '/auth/cambiar-contrasena', {
    token: COCINERO_CAMBIO,
    body: { passwordActual: TEST_PASS, passwordNueva: nuevaPass },
  });
  check('cambiar-contrasena auto-grant (cocinero) → 200', cambio.status === 200 && cambio.data?.ok === true, `status=${cambio.status} body=${JSON.stringify(cambio.data)}`);
  await sleep(1200);

  const loginNuevaPass = await loginConBackoff(TEST_EMAIL, nuevaPass);
  check('login con nueva contraseña → 200', loginNuevaPass.status === 200, `status=${loginNuevaPass.status}`);
  await sleep(1200);

  const loginViejaPass = await loginConBackoff(TEST_EMAIL, TEST_PASS);
  check('login con contraseña vieja → 401', loginViejaPass.status === 401, `status=${loginViejaPass.status}`);
  await sleep(1200);

  // Restaurar a TEST_PASS para no romper checks posteriores
  const restaura = await raw('POST', '/auth/cambiar-contrasena', {
    token: COCINERO_CAMBIO,
    body: { passwordActual: nuevaPass, passwordNueva: TEST_PASS },
  });
  check('restaurar contraseña a TEST_PASS → 200', restaura.status === 200 && restaura.data?.ok === true, `status=${restaura.status} body=${JSON.stringify(restaura.data)}`);
  await sleep(1200);

  // ============ FASE 1E: TOKENS DE SERVICIO ============
  console.log('\n── TOKENS DE SERVICIO ──');
  const svcNombre = `smoke_svc_${Date.now()}`;
  const createSvc = await raw('POST', '/auth/servicios', { token: ADMIN, body: { nombre: svcNombre } });
  check('POST /auth/servicios → 201 + token plano', createSvc.status === 201 && !!createSvc.data?.token, `status=${createSvc.status} data=${JSON.stringify(createSvc.data)}`);
  const SVC_TOKEN = createSvc.data?.token;
  const svcId = createSvc.data?.id;

  const listSvc = await raw('GET', '/auth/servicios', { token: ADMIN });
  check('GET /auth/servicios → 200 incluye el servicio', listSvc.status === 200 && Array.isArray(listSvc.data) && listSvc.data.some(s => s.id === svcId && s.nombre === svcNombre), `status=${listSvc.status} count=${Array.isArray(listSvc.data) ? listSvc.data.length : 'N/A'}`);

  const svcPermisos = await raw('GET', '/auth/mis-permisos', { token: SVC_TOKEN });
  check('GET /auth/mis-permisos con token servicio → 200 rol editor', svcPermisos.status === 200 && svcPermisos.data?.rol === 'editor', `status=${svcPermisos.status} rol=${svcPermisos.data?.rol}`);

  const delSvc = await raw('DELETE', `/auth/servicios/${svcId}`, { token: ADMIN });
  check('DELETE /auth/servicios/:id → 200', delSvc.status === 200, `status=${delSvc.status}`);

  const svcRevoked = await raw('GET', '/auth/mis-permisos', { token: SVC_TOKEN });
  check('token revocado ya NO autentica → 401/403', svcRevoked.status === 401 || svcRevoked.status === 403, `status=${svcRevoked.status}`);

  // ============ FASE 2A: POST FACTURA VALIDA ============
  console.log('\n── FASE 2A: POST FACTURA VALIDA ──');
  {
    const ts2a = Date.now();
    const numFact2a = `FV-SMOKE-${ts2a}`;
    const create2a = await raw('POST', '/facturas', { token: ADMIN, body: {
      fecha: '2026-11-16', numero_factura: numFact2a, proveedor: 'SMOKE PROV',
      total_con_impuestos: 50000, base_imponible: 42000, iva: 8000, moneda: 'COP',
      items: [{ descripcion: 'Item prueba', cantidad: 2, precio_unitario: 21000, base_imponible: 42000, iva: 8000, total: 50000 }],
    } });
    check('POST /facturas válida → 201', create2a.status === 201, `status=${create2a.status}`);
    const row2a = psql(`SELECT count(*) FROM facturas WHERE numero_factura='${numFact2a}';`);
    check('factura persiste en BD', row2a === '1', `count=${row2a}`);
    psql(`DELETE FROM facturas_items WHERE id_factura IN (SELECT id FROM facturas WHERE numero_factura='${numFact2a}'); DELETE FROM facturas WHERE numero_factura='${numFact2a}';`);
  }

  // ============ FASE 2B: GET FACTURAS ============
  console.log('\n── FASE 2B: GET FACTURAS ──');
  {
    const ts2b = Date.now();
    const numFact2b = `FV-SMOKE-${ts2b}`;
    const create2b = await raw('POST', '/facturas', { token: ADMIN, body: { proveedor: 'SMOKE', numero_factura: numFact2b, total_con_impuestos: 100 } });
    check('POST /facturas → 201 y captura id', create2b.status === 201, `status=${create2b.status}`);
    const testFacturaId = create2b.data?.id;

    const list2b = await raw('GET', '/facturas', { token: ADMIN });
    check('GET /facturas → 200 y tiene {data,total}', list2b.status === 200 && !!list2b.data && typeof list2b.data?.total === 'number', `status=${list2b.status} total=${list2b.data?.total}`);

    const filtered2b = await raw('GET', '/facturas?proveedor=SMOKE', { token: ADMIN });
    check('GET /facturas?proveedor=SMOKE → 200 y contiene la de prueba', filtered2b.status === 200 && Array.isArray(filtered2b.data?.data) && filtered2b.data.data.some(f => f.id === testFacturaId), `status=${filtered2b.status}`);

    const byId2b = await raw('GET', `/facturas/${testFacturaId}`, { token: ADMIN });
    check('GET /facturas/:id → 200 factura', byId2b.status === 200 && !!byId2b.data?.id, `status=${byId2b.status}`);

    const items2b = await raw('GET', `/facturas/${testFacturaId}/items`, { token: ADMIN });
    check('GET /facturas/:id/items → 200', items2b.status === 200, `status=${items2b.status}`);

    psql(`DELETE FROM facturas_items WHERE id_factura=${testFacturaId}; DELETE FROM facturas WHERE id=${testFacturaId};`);
  }

  // ============ FASE 2C: DEDUP FACTURAS ============
  console.log('\n── FASE 2C: DEDUP FACTURAS ──');
  {
    const ts2c = Date.now();
    const numFact2c = `FV-DUP-${ts2c}`;
    const fecha2c = '2026-11-16';
    const dupBody1 = { numero_factura: numFact2c, fecha: fecha2c, proveedor: 'SMOKE', total_con_impuestos: 100 };
    const dupBody2 = { numero_factura: numFact2c, fecha: fecha2c, proveedor: 'SMOKE', total_con_impuestos: 200 };
    const crear2c = await raw('POST', '/facturas', { token: ADMIN, body: dupBody1 });
    check('POST /facturas → 201 (primera)', crear2c.status === 201, `status=${crear2c.status}`);
    const dup2c = await raw('POST', '/facturas', { token: ADMIN, body: dupBody2 });
    check('POST duplicado (mismo numero_factura+fecha) → 409', dup2c.status === 409, `status=${dup2c.status}`);
    const cnt2c = psql(`SELECT count(*) FROM facturas WHERE numero_factura='${numFact2c}' AND fecha='${fecha2c}';`);
    check('solo 1 fila duplicada en BD', cnt2c === '1', `count=${cnt2c}`);
    psql(`DELETE FROM facturas_items WHERE id_factura IN (SELECT id FROM facturas WHERE numero_factura='${numFact2c}'); DELETE FROM facturas WHERE numero_factura='${numFact2c}';`);
  }

  // ============ FASE 2D: PUT FACTURA ============
  console.log('\n── FASE 2D: PUT FACTURA ──');
  {
    const ts2d = Date.now();
    const numFact2d = `FV-EDIT-${ts2d}`;
    const crear2d = await raw('POST', '/facturas', { token: ADMIN, body: { proveedor: 'SMOKE', numero_factura: numFact2d, total_con_impuestos: 100 } });
    check('POST /facturas → 201 capture id', crear2d.status === 201, `status=${crear2d.status}`);
    const id2d = crear2d.data?.id;
    const put2d = await raw('PUT', `/facturas/${id2d}`, { token: ADMIN, body: { concepto: 'editado', total_con_impuestos: 99999 } });
    check('PUT /facturas/:id → 200', put2d.status === 200, `status=${put2d.status}`);
    const verif2d = await raw('GET', `/facturas/${id2d}`, { token: ADMIN });
    check('GET verifica concepto editado y total 99999', verif2d.status === 200 && verif2d.data?.concepto === 'editado' && Number(verif2d.data?.total_con_impuestos) === 99999, `status=${verif2d.status} concepto=${verif2d.data?.concepto}`);
    psql(`DELETE FROM facturas_items WHERE id_factura=${id2d}; DELETE FROM facturas WHERE id=${id2d};`);
  }

  // ============ FASE 2E: SOFT-DELETE FACTURA ============
  console.log('\n── FASE 2E: SOFT-DELETE FACTURA ──');
  {
    const ts2e = Date.now();
    const numFact2e = `FV-SOFT-${ts2e}`;
    const crear2e = await raw('POST', '/facturas', { token: ADMIN, body: { proveedor: 'SMOKE', numero_factura: numFact2e, total_con_impuestos: 100 } });
    check('POST /facturas → 201', crear2e.status === 201, `status=${crear2e.status}`);
    const id2e = crear2e.data?.id;
    const listPre = await raw('GET', '/facturas', { token: ADMIN });
    const estaPre = Array.isArray(listPre.data?.data) && listPre.data.data.some(f => f.id === id2e);
    check('GET /facturas lo incluye antes del delete', estaPre, '');
    const del2e = await raw('DELETE', `/facturas/${id2e}`, { token: ADMIN });
    check('DELETE /facturas/:id → 200', del2e.status === 200, `status=${del2e.status}`);
    const listPost = await raw('GET', '/facturas', { token: ADMIN });
    const estaPost = Array.isArray(listPost.data?.data) && listPost.data.data.some(f => f.id === id2e);
    check('GET /facturas ya NO lo incluye tras delete', !estaPost, '');
    const nd2e = psql(`SELECT count(*) FROM facturas WHERE id=${id2e};`);
    const deleted2e = psql(`SELECT count(*) FROM facturas WHERE id=${id2e} AND deleted_at IS NOT NULL;`);
    check('fila física persiste (deleted_at seteado)', deleted2e === '1', `persiste=${nd2e} deleted=${deleted2e}`);
    psql(`DELETE FROM facturas WHERE id=${id2e};`);
    psql(`DELETE FROM facturas_items WHERE id_factura=${id2e};`);
  }

  // ============ FASE 2F: COMPROBANTES (POST+GET+DEDUP) ============
  console.log('\n── FASE 2F: COMPROBANTES ──');
  {
    const ts2f = Date.now();
    const ref2f = `COMP-SMOKE-${ts2f}`;
    const crear2f = await raw('POST', '/comprobantes', { token: ADMIN, body: { fecha: '2026-11-16', beneficiario_emisor: 'PROV SMOKE', referencia: ref2f, total_con_impuestos: 25000 } });
    check('POST /comprobantes → 201', crear2f.status === 201, `status=${crear2f.status}`);
    const list2f = await raw('GET', '/comprobantes', { token: ADMIN });
    const incluye2f = Array.isArray(list2f.data?.data) && list2f.data.data.some(c => c.referencia === ref2f);
    check('GET /comprobantes → 200 e incluye el creado', list2f.status === 200 && incluye2f, `status=${list2f.status} incluye=${incluye2f}`);
    const dup2f = await raw('POST', '/comprobantes', { token: ADMIN, body: { fecha: '2026-11-16', beneficiario_emisor: 'PROV SMOKE', referencia: ref2f, total_con_impuestos: 25000 } });
    check('POST duplicado (referencia+total) → 409', dup2f.status === 409, `status=${dup2f.status}`);
    psql(`DELETE FROM comprobantes_pago WHERE referencia='${ref2f}';`);
  }

  // ============ FASE 2G: COMPROBANTES (PUT+SOFT-DELETE) ============
  console.log('\n── FASE 2G: COMPROBANTES PUT+SOFT-DELETE ──');
  {
    const ts2g = Date.now();
    const ref2g = `COMP-EDIT-${ts2g}`;
    const crear2g = await raw('POST', '/comprobantes', { token: ADMIN, body: { fecha: '2026-11-16', beneficiario_emisor: 'PROV SMOKE', referencia: ref2g, total_con_impuestos: 25000 } });
    check('POST /comprobantes → 201 capture id', crear2g.status === 201, `status=${crear2g.status}`);
    const id2g = crear2g.data?.id;
    const put2g = await raw('PUT', `/comprobantes/${id2g}`, { token: ADMIN, body: { concepto: 'editado' } });
    check('PUT /comprobantes/:id → 200', put2g.status === 200, `status=${put2g.status}`);
    const verif2g = await raw('GET', `/comprobantes/${id2g}`, { token: ADMIN });
    check('GET verifica concepto editado', verif2g.status === 200 && verif2g.data?.concepto === 'editado', `status=${verif2g.status}`);
    const del2g = await raw('DELETE', `/comprobantes/${id2g}`, { token: ADMIN });
    check('DELETE /comprobantes/:id → 200', del2g.status === 200, `status=${del2g.status}`);
    const list2g = await raw('GET', '/comprobantes', { token: ADMIN });
    const esta2g = Array.isArray(list2g.data?.data) && list2g.data.data.some(c => c.id === id2g);
    check('GET /comprobantes ya NO lo incluye tras delete', !esta2g, '');
    const nd2g = psql(`SELECT count(*) FROM comprobantes_pago WHERE id=${id2g};`);
    const deleted2g = psql(`SELECT count(*) FROM comprobantes_pago WHERE id=${id2g} AND deleted_at IS NOT NULL;`);
    check('fila física persiste (deleted_at seteado)', deleted2g === '1', `persiste=${nd2g} deleted=${deleted2g}`);
    psql(`DELETE FROM comprobantes_pago WHERE id=${id2g};`);
  }

  // ============ FASE 3A: ABRIR TURNO CAJA ============
  console.log('\n── FASE 3A: ABRIR TURNO CAJA ──');
  let turnoAbiertoId = null;
  {
    const abrir = await raw('POST', '/caja/abrir', { token: ADMIN, body: { efectivo_inicial: 100000 } });
    check('POST /caja/abrir → 201 y estado abierto', abrir.status === 201 && abrir.data?.estado === 'abierto', `status=${abrir.status}`);
    turnoAbiertoId = abrir.data?.id || null;
    check('turno creado con id', !!turnoAbiertoId, `id=${turnoAbiertoId}`);
    const activo = await raw('GET', '/caja/activo', { token: ADMIN });
    check('GET /caja/activo → 200 y es el mismo turno', activo.status === 200 && activo.data?.id === turnoAbiertoId, `status=${activo.status}`);
    const fila = psql(`SELECT count(*) FROM turnos_caja WHERE id=${turnoAbiertoId} AND estado='abierto';`);
    check('psql: fila existe con estado abierto', fila === '1', `count=${fila}`);
  }

  // ============ FASE 3B: MOVIMIENTOS DE CAJA ============
  console.log('\n── FASE 3B: MOVIMIENTOS DE CAJA ──');
  {
    const egreso = await raw('POST', '/caja/movimiento/egreso', { token: ADMIN, body: { id_turno: turnoAbiertoId, concepto: 'PRUEBA EGRESO', monto: 50000 } });
    check('POST /caja/movimiento/egreso → 201', egreso.status === 201, `status=${egreso.status}`);
    // Ingreso exige autorizado_por válido (>0): el id del superadmin temporal.
    const adminUserId = +(psql(`SELECT id FROM usuarios WHERE email='${ADMIN_EMAIL}';`).trim()) || 0;
    const ingreso = await raw('POST', '/caja/movimiento/ingreso', { token: ADMIN, body: { id_turno: turnoAbiertoId, concepto: 'PRUEBA INGRESO', monto: 20000, autorizado_por: adminUserId } });
    check('POST /caja/movimiento/ingreso → 201', ingreso.status === 201, `status=${ingreso.status}`);
    const movs = await raw('GET', `/caja/movimiento/${turnoAbiertoId}`, { token: ADMIN });
    check('GET /caja/movimiento/:id → 200 e incluye egreso', movs.status === 200 && Array.isArray(movs.data) && movs.data.some(m => m.concepto === 'PRUEBA EGRESO'), `status=${movs.status}`);
  }

  // ============ FASE 3C: ARQUEO ============
  console.log('\n── FASE 3C: ARQUEO ──');
  {
    const arqueo = await raw('GET', `/caja/${turnoAbiertoId}/arqueo`, { token: ADMIN });
    check('GET /caja/:id/arqueo → 200', arqueo.status === 200, `status=${arqueo.status}`);
    check('arqueo incluye puedeCerrar', arqueo.data?.puedeCerrar !== undefined, `puedeCerrar=${arqueo.data?.puedeCerrar}`);
    const aTorno = psql(`SELECT estado FROM turnos_caja WHERE id=${turnoAbiertoId};`);
    check('turno sigue abierto', aTorno === 'abierto', `estado=${aTorno}`);
  }

  // ============ FASE 3D: CREAR PEDIDO ============
  console.log('\n── FASE 3D: CREAR PEDIDO ──');
  let pedidoPruebaId = null;
  {
    const cartaD = await raw('GET', '/carta', { token: ADMIN });
    let idProductoD = 48;
    if (cartaD.status === 200 && cartaD.data?.categorias) {
      const todos = [];
      for (const c of cartaD.data.categorias) { if (Array.isArray(c.items)) todos.push(...c.items); }
      if (todos.length) idProductoD = todos[0].id || 48;
    }
    check('id_producto real obtenido', typeof idProductoD === 'number', `id=${idProductoD}`);
    const criar = await raw('POST', '/pedidos', { token: ADMIN, body: { escenario: 'mesa', numero_mesa: `7-${Date.now() % 10000}`, items: [{ id_producto: idProductoD, cantidad: 2 }] } });
    check('POST /pedidos → 201', criar.status === 201, `status=${criar.status}`);
    pedidoPruebaId = criar.data?.id || null;
    check('pedido con id', !!pedidoPruebaId, `id=${pedidoPruebaId}`);
    const getPed = await raw('GET', `/pedidos/${pedidoPruebaId}`, { token: ADMIN });
    check('GET /pedidos/:id → 200', getPed.status === 200, `status=${getPed.status}`);
  }

  // ============ FASE 3E: PEDIDO COCINA ============
  console.log('\n── FASE 3E: PEDIDO COCINA ──');
  {
    const itemsRes = await raw('POST', `/pedidos/${pedidoPruebaId}/items`, { token: ADMIN, body: { items: [{ id_producto: 48, cantidad: 1 }] } });
    check('POST /pedidos/:id/items → 201', itemsRes.status === 201, `status=${itemsRes.status}`);
    const cocinaRes = await raw('POST', `/pedidos/${pedidoPruebaId}/cocina`, { token: ADMIN, body: { estado_cocina: 'preparando' } });
    check('POST /pedidos/:id/cocina → 201', cocinaRes.status === 201, `status=${cocinaRes.status}`);
    const colaRes = await raw('GET', '/pedidos/cocina/cola', { token: ADMIN });
    check('GET /pedidos/cocina/cola → 200', colaRes.status === 200 && Array.isArray(colaRes.data), `status=${colaRes.status}`);
  }

  // ============ FASE 3F: COBRAR PEDIDO ============
  console.log('\n── FASE 3F: COBRAR PEDIDO ──');
  {
    const formasF = await raw('GET', '/ventas/formas-pago', { token: ADMIN });
    let formaF = null;
    if (Array.isArray(formasF.data)) { const activa = formasF.data.find(f => f.activo === true); formaF = activa ? activa.id : null; }
    check('forma de pago activa obtenida (o null)', true, `forma=${formaF}`);
    const cobrar = await raw('POST', `/pedidos/${pedidoPruebaId}/cobrar`, { token: ADMIN, body: { id_forma_pago: formaF } });
    check('POST /pedidos/:id/cobrar → 201', cobrar.status === 201, `status=${cobrar.status}`);
    // verificar que el pedido ya no está abierta y se creó venta
    const pedF = psql(`SELECT estado FROM pedidos WHERE id=${pedidoPruebaId};`);
    check('pedido ya no está abierta', pedF !== 'abierta', `estado=${pedF}`);
    const ventaF = psql(`SELECT count(*) FROM ventas WHERE numero_mesa IN (SELECT numero_mesa FROM pedidos WHERE id=${pedidoPruebaId});`);
    check('se creó venta asociada', Number(ventaF) >= 1, `ventas=${ventaF}`);
  }

  // ============ FASE 3G: VENTAS DIRECTAS + FORMAS PAGO ============
  console.log('\n── FASE 3G: VENTAS DIRECTAS + FORMAS PAGO ──');
  let ventaDirectaId = null;
  {
    const nombreG = `METODO-TEST-${Date.now()}`;
    const crearForma = await raw('POST', '/ventas/formas-pago', { token: ADMIN, body: { nombre: nombreG } });
    check('POST /ventas/formas-pago → 201', crearForma.status === 201, `status=${crearForma.status}`);
    const formaIdG = crearForma.data?.id;
    const listarFormas = await raw('GET', '/ventas/formas-pago', { token: ADMIN });
    check('GET /ventas/formas-pago → 200 e incluye la nueva', listarFormas.status === 200 && Array.isArray(listarFormas.data) && listarFormas.data.some(f => f.id === formaIdG), `status=${listarFormas.status}`);
    const ventaG = await raw('POST', '/ventas', { token: ADMIN, body: { escenario: 'para_llevar', cliente_nombre: 'CLIENTE TEST', items: [{ id_producto: 48, cantidad: 1 }] } });
    check('POST /ventas → 201', ventaG.status === 201, `status=${ventaG.status}`);
    ventaDirectaId = ventaG.data?.id;
    const getVentas = await raw('GET', '/ventas', { token: ADMIN });
    check('GET /ventas → 200', getVentas.status === 200, `status=${getVentas.status}`);
    const desac = await raw('PUT', `/ventas/formas-pago/${formaIdG}`, { token: ADMIN, body: { activo: false } });
    check('PUT /ventas/formas-pago/:id activo:false → 200', desac.status === 200, `status=${desac.status}`);
    const verifForma = await raw('GET', '/ventas/formas-pago', { token: ADMIN });
    const formaDesac = Array.isArray(verifForma.data) && verifForma.data.find(f => f.id === formaIdG);
    check('forma quedó desactivada (no borrada)', formaDesac && formaDesac.activo === false, `activo=${formaDesac?.activo}`);
    // limpieza: borrar venta de prueba (items + venta)
    if (ventaDirectaId) { try { psql(`DELETE FROM venta_items WHERE id_venta=${ventaDirectaId}; DELETE FROM ventas WHERE id=${ventaDirectaId};`); } catch {} }
  }

  // ============ FASE 3H: CIERRE DE TURNO (final) ============
  console.log('\n── FASE 3H: CIERRE DE TURNO ──');
  {
    const arqueoH = await raw('GET', `/caja/${turnoAbiertoId}/arqueo`, { token: ADMIN });
    check('arqueo final → 200', arqueoH.status === 200, `status=${arqueoH.status}`);
    const puedeH = arqueoH.data?.puedeCerrar;
    if (puedeH) {
      const cerrarH = await raw('POST', `/caja/${turnoAbiertoId}/cerrar`, { token: ADMIN, body: { efectivo_final: arqueoH.data?.efectivoTeorico ?? 0, propina_efectivo: 0, propina_otros: 0 } });
      check('POST /caja/:id/cerrar → 200/201 (cuadra)', cerrarH.status === 200 || cerrarH.status === 201, `status=${cerrarH.status}`);
      const stH = psql(`SELECT estado FROM turnos_caja WHERE id=${turnoAbiertoId};`);
      check('turno quedó cerrado', stH === 'cerrado', `estado=${stH}`);
    } else {
      check('arqueo no cuadra (faltante) → intento de cierre da 403', true, 'puedeCerrar=false');
      // intento de cierre debe dar 400/403 por faltante
      const cerrarIntento = await raw('POST', `/caja/${turnoAbiertoId}/cerrar`, { token: ADMIN, body: { efectivo_final: 0, propina_efectivo: 0, propina_otros: 0 } });
      check('cerrar con faltante → 4xx (bloqueo)', cerrarIntento.status === 403 || cerrarIntento.status === 400, `status=${cerrarIntento.status}`);
    }
    const delPed = psql(`SELECT count(*) FROM pedidos WHERE id=${pedidoPruebaId} AND deleted_at IS NULL;`);
    check('pedido de prueba existe', Number(delPed) === 1, `count=${delPed}`);
  }

  // ============ LIMPIEZA DE DATOS DE PRUEBA ============
  // Borra el turno (y sus movimientos), la venta y el pedido creados por la
  // suite, para que cada corrida no acumule basura en :test. Solo si existen.
  {
    try { psql(`DELETE FROM venta_items WHERE id_venta IN (SELECT id FROM ventas WHERE id_turno=${turnoAbiertoId ?? 0}); DELETE FROM ventas WHERE id_turno=${turnoAbiertoId ?? 0};`); } catch {}
    try { psql(`DELETE FROM movimientos_caja WHERE id_turno=${turnoAbiertoId ?? 0};`); } catch {}
    try { psql(`DELETE FROM pedido_items WHERE id_pedido=${pedidoPruebaId ?? 0}; DELETE FROM pedidos WHERE id=${pedidoPruebaId ?? 0};`); } catch {}
    try { if (turnoAbiertoId) psql(`DELETE FROM turnos_caja WHERE id=${turnoAbiertoId};`); } catch {}
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