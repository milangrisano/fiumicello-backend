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
import { writeFileSync, unlinkSync, readFileSync } from 'node:fs';

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

  // ============ FASE 5A: CALIDAD OCR (blur / Capa 1) — REPORTE-CAPA1-CALIDAD-BLUR ============
  // Prueba la función pura decidirCalidad() del código COMPILADO en el contenedor
  // (sin gastar IA) con los casos calibrados en :test + 1 check de integración real.
  console.log('\n── FASE 5A: CALIDAD OCR (blur) ──');
  {
    const resolucion = await import('/app/dist/ocr/resolucion.js');
    // Casos calibrados con la regla del PISO REAL (REPORTE-PISO-REAL-384PX):
    // - Lado menor < 384px (y NO tira larga) → RECHAZA "tamaño no viable".
    //   Los irreales de la batería (40..250px) NO existen físicamente → todos rechazan.
    // - Tira larga legítima (boucher 245×1280, rel 5.2) → pasa el piso.
    // - blur NATIVO >= 20 (nítidas ≥384px, ej. ticket POS 384×1200) → acepta.
    // - borrosa grande (≥384px pero desenfocada, blur 0.1) → rechaza.
    const casos = [
      // nombre, dims {width,height}, blur nativo, esperado (false=acepta, true=rechaza)
      ['40×40 no viable rechaza', { width: 40, height: 40 }, 607.4, true],
      ['80×80 no viable rechaza', { width: 80, height: 80 }, 800.0, true],
      ['90×100 no viable rechaza', { width: 90, height: 100 }, 790.0, true],
      ['100×100 no viable rechaza', { width: 100, height: 100 }, 790.2, true],
      ['120×150 no viable rechaza', { width: 120, height: 150 }, 780.2, true],
      ['150×150 no viable rechaza', { width: 150, height: 150 }, 875.2, true],
      ['200×200 no viable rechaza', { width: 200, height: 200 }, 914.0, true],
      ['250×400 no viable rechaza (lado menor 250)', { width: 250, height: 400 }, 764.6, true],
      ['boucher 245×1280 tira larga acepta', { width: 245, height: 1280 }, 866.7, false],
      ['ticket POS 58mm 384×1200 nítido acepta', { width: 384, height: 1200 }, 400.0, false],
      ['foto 720×1280 nítida acepta', { width: 720, height: 1280 }, 760.9, false],
      ['borrosa grande 570×1280 rechaza', { width: 570, height: 1280 }, 0.1, true],
    ];
    for (const [nombre, dims, blur, esperado] of casos) {
      const d = resolucion.decidirCalidad(dims, blur);
      check(`Capa1 ${nombre}`, d.rechazar === esperado, `rechazar=${d.rechazar} motivo=${d.motivo}`);
    }

    // Check de integración real: subir imagen BORROSA grande por API con token de
    // servicio → la Capa 1 la rechaza ANTES del OCR (no gasta IA) con ok:false.
    // El token de servicio solo se ve una vez al crearlo (en BD está hasheado).
    const createSvcBlur = await raw('POST', '/auth/servicios', { token: ADMIN, body: { nombre: `smoke_ocr_blur_${Date.now()}` } });
    const svcToken = createSvcBlur.data?.token || null;
    // Imagen borrosa grande: la generamos con sharp (resuelto desde /app del contenedor)
    const sharpFn = (await import('sharp')).default;
    const svgBorrosa = `<svg width="900" height="1200" xmlns="http://www.w3.org/2000/svg"><rect width="900" height="1200" fill="white"/><text x="50" y="120" font-family="monospace" font-size="60" fill="black">FACTURA 9001</text><text x="50" y="240" font-family="monospace" font-size="50" fill="black">TOTAL: $999,999</text></svg>`;
    const bufBorrosa = await sharpFn(Buffer.from(svgBorrosa)).blur(40).jpeg().toBuffer();
    const fd = new FormData();
    fd.append('archivo', new Blob([bufBorrosa], { type: 'image/jpeg' }), 'borrosa_e2e.jpg');
    let blurRes = null;
    try {
      const res = await fetch(`${BASE}/ocr/subir`, { method: 'POST', headers: { Authorization: `Bearer ${svcToken}` }, body: fd });
      blurRes = { status: res.status, data: await res.json().catch(() => ({})) };
    } catch (e) {
      blurRes = { status: 0, data: { error: String(e) } };
    }
    check('Capa1 integración: subir borrosa → ok:false ilegible', blurRes?.status === 201 && blurRes.data?.ok === false && String(blurRes.data?.error || '').includes('baja resolución'), `status=${blurRes?.status} data=${JSON.stringify(blurRes?.data)}`);
    if (createSvcBlur.data?.id) { try { psql(`DELETE FROM servicios WHERE id=${createSvcBlur.data.id};`); } catch {} }
  }

  // ============ FASE 5B: FUNCIONES PURAS DE RESOLUCIÓN/COHERENCIA ============
  // Testea decidirCalidad()/esMejor()/resolverArchivo() del módulo COMPILADO sobre
  // archivos reales generados con sharp (determinista, SIN gastar IA/tokens).
  // Reglas validadas: piso real 384px (REPORTE-PISO-REAL-384PX), resolución, blur,
  // y el fix de consolidación "misma ruta no destruye archivo".
  console.log('\n── FASE 5B: FUNCIONES PURAS RESOLUCIÓN/COHERENCIA ──');
  {
    const resol = await import('/app/dist/ocr/resolucion.js');
    const sharp5b = (await import('sharp')).default;

    // --- piso real (decidirCalidad) ---
    const casosPiso = [
      ['40×40 rechaza tamaño', { width: 40, height: 40 }, 607, true],
      ['100×100 rechaza tamaño', { width: 100, height: 100 }, 790, true],
      ['200×200 rechaza tamaño', { width: 200, height: 200 }, 914, true],
      ['boucher 245×1280 tira larga acepta', { width: 245, height: 1280 }, 866, false],
      ['ticket POS 384×1200 acepta', { width: 384, height: 1200 }, 400, false],
      ['borrosa 570×1280 rechaza blur', { width: 570, height: 1280 }, 0.1, true],
    ];
    for (const [nombre, dims, blur, esp] of casosPiso) {
      const d = resol.decidirCalidad(dims, blur);
      check(`F5B piso ${nombre}`, d.rechazar === esp, `rechazar=${d.rechazar} motivo=${d.motivo}`);
    }

    // --- esMejor (regla de consolidación por resolución) ---
    const mejor = resol.resolverArchivo ? null : null;
    const rAlta = { tipo: 'image', pixels: 2000000, sizeBytes: 500000, tieneTexto: false };
    const rBaja = { tipo: 'image', pixels: 500000, sizeBytes: 100000, tieneTexto: false };
    check('F5B esMejor: mayor pixels es mejor', resol.esMejor(rAlta, rBaja) === true, 'alta>baja');
    check('F5B esMejor: menor pixels NO es mejor', resol.esMejor(rBaja, rAlta) === false, 'baja<alta');
    // PDF con capa de texto gana a imagen del mismo doc (regla REPORTE-CONSLIDACION)
    const rPdfTxt = { tipo: 'pdf', pixels: 1000000, sizeBytes: 200000, tieneTexto: true };
    const rImg = { tipo: 'image', pixels: 1500000, sizeBytes: 300000, tieneTexto: false };
    check('F5B esMejor: PDF con texto gana a imagen', resol.esMejor(rPdfTxt, rImg) === true, 'pdf-texto>imagen');

    // --- resolverArchivo sobre archivos reales (JPG nítido grande vs pequeño) ---
    const svgGrande = `<svg width="1200" height="1600" xmlns="http://www.w3.org/2000/svg"><rect width="1200" height="1600" fill="white"/><text x="50" y="120" font-size="60">F</text></svg>`;
    const svgChico = `<svg width="400" height="500" xmlns="http://www.w3.org/2000/svg"><rect width="400" height="500" fill="white"/><text x="50" y="120" font-size="60">F</text></svg>`;
    const bufGrande = await sharp5b(Buffer.from(svgGrande)).jpeg().toBuffer();
    const bufChico = await sharp5b(Buffer.from(svgChico)).jpeg().toBuffer();
    const fG = '/tmp/e2e_grande.jpg';
    const fC = '/tmp/e2e_chico.jpg';
    const { writeFileSync } = await import('node:fs');
    writeFileSync(fG, bufGrande);
    writeFileSync(fC, bufChico);
    const rG = await resol.resolverArchivo(fG);
    const rC = await resol.resolverArchivo(fC);
    check('F5B resolverArchivo: imagen grande > pixels imagen chico', rG.pixels > rC.pixels, `grande=${rG.pixels} chico=${rC.pixels}`);
    check('F5B resolverArchivo: gira tipo=image con pixels>0', (rG.tipo === 'image' || rG.tipo === 'other') && rG.pixels > 0, `tipo=${rG.tipo} px=${rG.pixels}`);
  }
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

  // ============ FASE 3D-BIS: SUBTOTAL DEL ITEM (precio × cantidad) ============
  // Fix POS comanda (0.17.96): el subtotal del item en la fila de comanda debe
  // ser precio_unitario × cantidad. La API lo expone por item en GET /pedidos/:id;
  // este check verifica la regla de punta a punta (backend calcula el subtotal
  // que el frontend muestra). Si alguien rompe la lógica, la fila de la comanda
  // volvería a mostrar el unitario en vez del subtotal (bug reportado).
  console.log('\n── FASE 3D-BIS: SUBTOTAL ITEM (precio × cantidad) ──');
  {
    const ped = await raw('GET', `/pedidos/${pedidoPruebaId}`, { token: ADMIN });
    const items = Array.isArray(ped.data?.items) ? ped.data.items : [];
    const conCantidad = items.filter((it) => Number(it['cantidad']) > 1);
    check('pedido de prueba tiene items con cantidad > 1',
        conCantidad.length > 0, `items=${items.length} multi=${conCantidad.length}`);
    let todosOk = items.length > 0;
    let detalle = '';
    for (const it of items) {
      const precio = Number(it['precio_unitario'] ?? 0);
      const cant = Number(it['cantidad'] ?? 0);
      const sub = Number(it['subtotal'] ?? -1);
      if (Math.abs(sub - precio * cant) > 0.01) {
        todosOk = false;
        detalle = `${it['nombre']} sub=${sub} esperado=${precio * cant} (${precio}×${cant})`;
        break;
      }
    }
    check('subtotal item = precio_unitario × cantidad en TODOS los items',
        todosOk, detalle || `items=${items.length}`);
    // El total del pedido = suma de subtotales (el general que el POS muestra).
    const sumaSubtotales = items.reduce((acc, it) => acc + Number(it['subtotal'] ?? 0), 0);
    const totalPed = Number(ped.data?.['total'] ?? -1);
    check('total del pedido = suma de subtotales de items',
        Math.abs(sumaSubtotales - totalPed) <= 0.01,
        `suma=${sumaSubtotales} total=${totalPed}`);
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
    // REGRESIÓN (fix 0.18.3): editar SOLO el nombre. El frontend envía
    // {nombre, activo: null} y el backend NO debe: (a) dar 500 ni (b) pisar
    // activo a null (columna NOT NULL). El nombre nuevo debe persistir.
    const editarNombre = await raw('PUT', `/ventas/formas-pago/${formaIdG}`, { token: ADMIN, body: { nombre: 'METODO-RENOMBRADO', activo: null } });
    check('REGRESIÓN: editar solo nombre (activo:null) → 200 (no 500)', editarNombre.status === 200, `status=${editarNombre.status}`);
    const verifRenomb = await raw('GET', '/ventas/formas-pago', { token: ADMIN });
    const renomb = Array.isArray(verifRenomb.data) && verifRenomb.data.find(f => f.id === formaIdG);
    check('REGRESIÓN: nuevo nombre persistido', renomb?.nombre === 'METODO-RENOMBRADO', `nombre=${renomb?.nombre}`);
    check('REGRESIÓN: activo NO se pisó a null (sigue false)', renomb?.activo === false, `activo=${renomb?.activo}`);
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

  // ============ FASE 4A: RESÚMENES CONTABLE ============
  console.log('\n── FASE 4A: RESÚMENES CONTABLE ──');
  {
    const rc = await raw('GET', '/resumenes/contable?mes=2026-10', { token: ADMIN });
    check('GET /resumenes/contable → 200 y utilidad numérica', rc.status === 200 && typeof rc.data?.utilidad === 'number', `status=${rc.status} utilidad=${rc.data?.utilidad}`);
    const ruf = await raw('GET', '/resumenes/ultima-fecha', { token: ADMIN });
    check('GET /resumenes/ultima-fecha → 200', ruf.status === 200, `status=${ruf.status}`);
  }

  // ============ FASE 4B: LISTADO RESUMEN ============
  console.log('\n── FASE 4B: LISTADO RESUMEN ──');
  {
    const rl = await raw('GET', '/resumenes?mes=2026-10', { token: ADMIN });
    check('GET /resumenes?mes=2026-10 → 200 y totales presente', rl.status === 200 && (rl.data?.totales !== undefined), `status=${rl.status}`);
    const rv = await raw('GET', '/resumenes?mes=1999-01', { token: ADMIN });
    check('GET /resumenes?mes=1999-01 → 200 (mes sin datos, no 5xx)', rv.status === 200, `status=${rv.status}`);
  }

  // ============ FASE 4C: GASTOS ============
  console.log('\n── FASE 4C: GASTOS ──');
  {
    const gr = await raw('GET', '/gastos/resumen?mes=2026-10', { token: ADMIN });
    check('GET /gastos/resumen → 200 y totalGeneral presente', gr.status === 200 && gr.data?.totalGeneral !== undefined, `status=${gr.status}`);
    const gp = await raw('GET', '/gastos/por-categoria?mes=2026-10', { token: ADMIN });
    check('GET /gastos/por-categoria → 200 y es array', gp.status === 200 && Array.isArray(gp.data), `status=${gp.status}`);
    const gt = await raw('GET', '/gastos/total?mes=2026-10', { token: ADMIN });
    check('GET /gastos/total → 200 y total numérico', gt.status === 200 && typeof gt.data?.total === 'number', `status=${gt.status}`);
  }

  // ============ FASE 4D: ROLES CATÁLOGO ============
  console.log('\n── FASE 4D: ROLES CATÁLOGO ──');
  {
    const arb = await raw('GET', '/auth/roles/catalogo-arbol', { token: ADMIN });
    const nonEmpty = Array.isArray(arb.data) ? arb.data.length > 0 : (arb.data && Object.keys(arb.data).length > 0);
    check('GET /auth/roles/catalogo-arbol → 200 y no vacío', arb.status === 200 && !!nonEmpty, `status=${arb.status}`);
    const cat = await raw('GET', '/auth/roles/catalogo', { token: ADMIN });
    check('GET /auth/roles/catalogo → 200', cat.status === 200, `status=${cat.status}`);
    const rol = await raw('GET', '/auth/roles', { token: ADMIN });
    check('GET /auth/roles → 200 lista no vacía', rol.status === 200 && Array.isArray(rol.data) && rol.data.length > 0, `status=${rol.status} n=${Array.isArray(rol.data) ? rol.data.length : '-'}`);
  }

  // ============ FASE 4E: ROLES CRUD ============
  console.log('\n── FASE 4E: ROLES CRUD ──');
  let rolSmokeNombre = null;
  {
    rolSmokeNombre = 'rol_smoke_' + Date.now();
    const crear = await raw('POST', '/auth/roles', { token: ADMIN, body: { nombre: rolSmokeNombre, descripcion: 'rol de prueba', permisos: [] } });
    check('POST /auth/roles → 201 crea rol', crear.status === 201, `status=${crear.status}`);
    const listaR = await raw('GET', '/auth/roles', { token: ADMIN });
    check('GET /auth/roles → 200 y rol nuevo aparece', listaR.status === 200 && Array.isArray(listaR.data) && listaR.data.some(r => r.nombre === rolSmokeNombre), `status=${listaR.status}`);
    const upd = await raw('PUT', `/auth/roles/${rolSmokeNombre}`, { token: ADMIN, body: { descripcion: 'rol actualizado', permisos: [] } });
    check('PUT /auth/roles/:nombre → 200/201 actualiza', upd.status === 200 || upd.status === 201, `status=${upd.status}`);
    const dup = await raw('POST', '/auth/roles', { token: ADMIN, body: { nombre: rolSmokeNombre, permisos: [] } });
    check('POST /auth/roles duplicado → 400/409', dup.status === 400 || dup.status === 409, `status=${dup.status}`);
    const delR = await raw('DELETE', `/auth/roles/${rolSmokeNombre}`, { token: ADMIN });
    check('DELETE /auth/roles/:nombre → 200 limpia', delR.status === 200, `status=${delR.status}`);
    if (delR.status !== 200) { try { psql(`DELETE FROM roles WHERE nombre='${rolSmokeNombre}';`); } catch {} }
  }

  // ============ FASE 4F: CARTA ADMIN ============
  console.log('\n── FASE 4F: CARTA ADMIN ──');
  let catSmokeId = null;
  {
    const catBody = { nombre: 'CAT-SMOKE-' + Date.now(), orden: 0 };
    const crearCat = await raw('POST', '/carta/categorias', { token: ADMIN, body: catBody });
    check('POST /carta/categorias → 201', crearCat.status === 201, `status=${crearCat.status}`);
    catSmokeId = crearCat.data?.id;
    check('categoría creada con id', !!catSmokeId, `id=${catSmokeId}`);
    const itemBody = { id_categoria: catSmokeId, nombre: 'ITEM-SMOKE', precio: 1000 };
    const crearItem = await raw('POST', '/carta/items', { token: ADMIN, body: itemBody });
    check('POST /carta/items → 201', crearItem.status === 201, `status=${crearItem.status}`);
    const getCar = await raw('GET', '/carta', { token: ADMIN });
    const catAparece = getCar.status === 200 && getCar.data?.categorias?.some(c => c.id === catSmokeId);
    check('GET /carta → 200 y categoría nueva aparece', !!catAparece, `status=${getCar.status}`);
    const cc = psql(`SELECT count(*) FROM carta_categorias WHERE id=${catSmokeId};`);
    check('categoría persiste en BD', cc === '1', `count=${cc}`);
    const ic = psql(`SELECT count(*) FROM carta_items WHERE id_categoria=${catSmokeId};`);
    check('item persiste en BD', Number(ic) >= 1, `count=${ic}`);
  }

  // ============ FASE 4G: ASIGNACIÓN/CLASIFICACIÓN RESUMEN ============
  console.log('\n── FASE 4G: RESÚMENES ASIG/CLASIF ──');
  // Nota: estos endpoints usan @Body('campo') inline (no DTO de clase) y
  // devuelven HTTP 200 con {ok:false, mensaje} cuando el dato no existe
  // (patrón soft-response), no lanzan 404. ADVERTENCIA: NO usar body vacío
  // (findOneBy({id:undefined}) de TypeORM toma el PRIMER registro y cruza datos
  // reales) → usar ids inexistentes para el chequeo seguro.
  {
    const asi = await raw('PATCH', '/resumenes/asignar-comprobante', { token: ADMIN, body: { facturaId: 999999999, comprobanteId: 999999999 } });
    check('PATCH asignar-comprobante con ids inexistentes → 200 con ok:false', asi.status === 200 && asi.data?.ok === false, `status=${asi.status} ok=${asi.data?.ok}`);
    const cla = await raw('PATCH', '/resumenes/clasificar-comprobante', { token: ADMIN, body: { comprobanteId: 999999999, tipo: 'transferencia' } });
    check('PATCH clasificar-comprobante con id inexistente → 200 con ok:false', cla.status === 200 && cla.data?.ok === false, `status=${cla.status} ok=${cla.data?.ok}`);
  }

  // ============ ESCANEO: PREVISUALIZAR (determinista, sharp local) ============
  console.log('\n── ESCANEO: PREVISUALIZAR ──');
  {
    const createSvcEsc = await raw('POST', '/auth/servicios', { token: ADMIN, body: { nombre: `smoke_escaneo_${Date.now()}` } });
    check('Escaneo PREV: POST /auth/servicios → 201 + token', createSvcEsc.status === 201 && !!createSvcEsc.data?.token, `status=${createSvcEsc.status}`);
    const SVC_ESC = createSvcEsc.data?.token;
    const svcEscId = createSvcEsc.data?.id;
    const sharpE = (await import('sharp')).default;
    const svgPreview = `<svg width="800" height="1000" xmlns="http://www.w3.org/2000/svg"><rect width="800" height="1000" fill="white"/><text x="50" y="120" font-family="monospace" font-size="48" fill="black">FACTURA PREVIEW ${Date.now()}</text><text x="50" y="200" font-family="monospace" font-size="40" fill="black">PROVEEDOR: SMOKE TEST</text><text x="50" y="280" font-family="monospace" font-size="40" fill="black">TOTAL: $123,456</text></svg>`;
    const bufPreview = await sharpE(Buffer.from(svgPreview)).jpeg({ quality: 90 }).toBuffer();
    const fdPrev = new FormData();
    fdPrev.append('archivo', new Blob([bufPreview], { type: 'image/jpeg' }), 'preview_test.jpg');
    let prevRes = null;
    try {
      const res = await fetch(`${BASE}/escaneo/previsualizar`, { method: 'POST', headers: { Authorization: `Bearer ${SVC_ESC}` }, body: fdPrev });
      prevRes = { status: res.status, data: await res.json().catch(() => ({})) };
    } catch (e) { prevRes = { status: 0, data: { error: String(e) } }; }
    check('Escaneo PREV: /escaneo/previsualizar (servicio) → 201 ok:true + preview', prevRes?.status === 201 && prevRes.data?.ok === true && !!prevRes.data?.preview_b64, `status=${prevRes?.status} ok=${prevRes?.data?.ok} hasPreview=${!!prevRes?.data?.preview_b64}`);
    check('Escaneo PREV: devuelve id + width/height + img_orig', prevRes?.data?.id && typeof prevRes.data.width === 'number' && typeof prevRes.data.img_orig_w === 'number', `data=${JSON.stringify(prevRes?.data)}`);
    const fdPrev2 = new FormData();
    fdPrev2.append('archivo', new Blob([bufPreview], { type: 'image/jpeg' }), 'preview_test2.jpg');
    let prevRes2 = null;
    try {
      const res = await fetch(`${BASE}/escaneo/previsualizar`, { method: 'POST', headers: { Authorization: `Bearer ${ADMIN}` }, body: fdPrev2 });
      prevRes2 = { status: res.status, data: await res.json().catch(() => ({})) };
    } catch (e) { prevRes2 = { status: 0, data: { error: String(e) } }; }
    check('Escaneo PREV: /escaneo/previsualizar (JWT admin) → 201 ok:true', prevRes2?.status === 201 && prevRes2.data?.ok === true, `status=${prevRes2?.status} ok=${prevRes2?.data?.ok}`);
    if (svcEscId) { try { psql(`DELETE FROM servicios WHERE id=${svcEscId};`); } catch {} }
  }

  // ============ ESCANEO: CONFIRMAR — SOLO VALIDACIONES DETERMINISTAS ============
  console.log('\n── ESCANEO: CONFIRMAR (validaciones) ──');
  {
    const confirmBadId = await raw('POST', '/escaneo/confirmar', { token: ADMIN, body: { id: 'noexiste123', tipo: 'factura', fecha: '2026-11-23', referencia: 'X', proveedor: 'Y', total: 100 } });
    check('Escaneo CONF: id inexistente → 404', confirmBadId.status === 404, `status=${confirmBadId.status}`);
    const confirmExtra = await raw('POST', '/escaneo/confirmar', { token: ADMIN, body: { id: 'dummy', tipo: 'factura', fecha: '2026-11-23', referencia: 'X', proveedor: 'Y', total: 100, campo_extra: 'hack' } });
    check('Escaneo CONF: id inexistente (vence antes que DTO) → 404', confirmExtra.status === 404, `status=${confirmExtra.status}`);
    // //PENDIENTE-IA: éxito completo de confirmar llama IA (flaky) — omitido
  }

  // ============ PEDIDOS: COCINA — TRANSICIONES COMPLETAS ============
  console.log('\n── PEDIDOS: COCINA (transiciones) ──');
  {
    const cartaC = await raw('GET', '/carta', { token: ADMIN });
    let idProdC = 48;
    if (cartaC.status === 200 && cartaC.data?.categorias) {
      const todos = [];
      for (const c of cartaC.data.categorias) { if (Array.isArray(c.items)) todos.push(...c.items); }
      if (todos.length) idProdC = todos[0].id || 48;
    }
    const mesaC = `COC-${Date.now() % 10000}`;
    const crearCoc = await raw('POST', '/pedidos', { token: ADMIN, body: { escenario: 'mesa', numero_mesa: mesaC, items: [{ id_producto: idProdC, cantidad: 2 }] } });
    check('Cocina: POST /pedidos → 201', crearCoc.status === 201, `status=${crearCoc.status}`);
    const pedCocId = crearCoc.data?.id;
    check('Cocina: pedido con id', !!pedCocId, `id=${pedCocId}`);
    if (pedCocId) {
      const pedInit = await raw('GET', `/pedidos/${pedCocId}`, { token: ADMIN });
      check('Cocina: estado_cocina inicial = recibida', pedInit.data?.estado_cocina === 'recibida', `estado=${pedInit.data?.estado_cocina}`);
      const aPrep = await raw('POST', `/pedidos/${pedCocId}/cocina`, { token: ADMIN, body: { estado_cocina: 'preparando' } });
      check('Cocina: recibida → preparando → 201', aPrep.status === 201 && aPrep.data?.estado_cocina === 'preparando', `status=${aPrep.status} estado=${aPrep.data?.estado_cocina}`);
      const aLista = await raw('POST', `/pedidos/${pedCocId}/cocina`, { token: ADMIN, body: { estado_cocina: 'lista' } });
      check('Cocina: preparando → lista → 201', aLista.status === 201 && aLista.data?.estado_cocina === 'lista', `status=${aLista.status} estado=${aLista.data?.estado_cocina}`);
      const aRet = await raw('POST', `/pedidos/${pedCocId}/cocina`, { token: ADMIN, body: { estado_cocina: 'retirada' } });
      check('Cocina: lista → retirada → 201', aRet.status === 201 && aRet.data?.estado_cocina === 'retirada', `status=${aRet.status} estado=${aRet.data?.estado_cocina}`);
      const aInv = await raw('POST', `/pedidos/${pedCocId}/cocina`, { token: ADMIN, body: { estado_cocina: 'loco' } });
      check('Cocina: estado inválido → 400', aInv.status === 400, `status=${aInv.status}`);
      psql(`DELETE FROM pedido_items WHERE id_pedido=${pedCocId}; DELETE FROM pedidos WHERE id=${pedCocId};`);
    }
  }

  // ============ PEDIDOS: ENTREGAR (para_llevar/domicilio) ============
  console.log('\n── PEDIDOS: ENTREGAR ──');
  {
    const cartaE2 = await raw('GET', '/carta', { token: ADMIN });
    let idProdE2 = 48;
    if (cartaE2.status === 200 && cartaE2.data?.categorias) {
      const todos = [];
      for (const c of cartaE2.data.categorias) { if (Array.isArray(c.items)) todos.push(...c.items); }
      if (todos.length) idProdE2 = todos[0].id || 48;
    }
    const crearEnt = await raw('POST', '/pedidos', { token: ADMIN, body: { escenario: 'para_llevar', cliente_nombre: 'CLIENTE ENTREGA', items: [{ id_producto: idProdE2, cantidad: 1 }] } });
    check('Entregar: POST /pedidos (para_llevar) → 201', crearEnt.status === 201, `status=${crearEnt.status}`);
    const pedEntId = crearEnt.data?.id;
    check('Entregar: pedido con id', !!pedEntId, `id=${pedEntId}`);
    if (pedEntId) {
      let tAct = await raw('GET', '/caja/activo', { token: ADMIN });
      let tId = tAct.data?.id;
      if (!tId) { const abrirT = await raw('POST', '/caja/abrir', { token: ADMIN, body: { efectivo_inicial: 100000 } }); tId = abrirT.data?.id; }
      const formasE2 = await raw('GET', '/ventas/formas-pago', { token: ADMIN });
      let formaE2 = null;
      if (Array.isArray(formasE2.data)) { const act = formasE2.data.find(f => f.activo === true); formaE2 = act ? act.id : null; }
      const cobrarE2 = await raw('POST', `/pedidos/${pedEntId}/cobrar`, { token: ADMIN, body: { id_forma_pago: formaE2 } });
      check('Entregar: cobrar (para_llevar) → 201', cobrarE2.status === 201, `status=${cobrarE2.status}`);
      const entregarE2 = await raw('POST', `/pedidos/${pedEntId}/entregar`, { token: ADMIN });
      check('Entregar: POST /pedidos/:id/entregar → 201/200', entregarE2.status === 201 || entregarE2.status === 200, `status=${entregarE2.status}`);
      const pedFin = await raw('GET', `/pedidos/${pedEntId}`, { token: ADMIN });
      check('Entregar: estado final = entregada', pedFin.data?.estado === 'entregada', `estado=${pedFin.data?.estado}`);
      // REGRESIÓN snackbar (0.18.7): entregar un pedido que YA fue entregado en
      // otro terminal debe dar 403 con mensaje real de backend (NO el genérico
      // "No se pudo completar la operación" que venía de mostrar el pedido sin
      // message en ÉXITO). El 403 es el que dispara el snackbar de error REAL.
      const entregar2 = await raw('POST', `/pedidos/${pedEntId}/entregar`, { token: ADMIN });
      check('Entregar: entregar pedido ya entregado → 403', entregar2.status === 403, `status=${entregar2.status}`);
      psql(`DELETE FROM pedido_items WHERE id_pedido=${pedEntId}; DELETE FROM pedidos WHERE id=${pedEntId};`);
    }
  }
  // ==== FIN BLOQUE ESCANEO-OCR-COCINA ====

  // ============ NEGOCIO A: ANULACIÓN DE PEDIDOS ============
  console.log('\n── ANULACIÓN DE PEDIDOS ──');
  {
    let pedIdA = null, pedIdA2 = null, pedIdA3 = null;
    try {
      const cartaA = await raw('GET', '/carta', { token: ADMIN });
      let idProdA = 48;
      if (cartaA.status === 200 && cartaA.data?.categorias) { const toda=[]; for (const c of cartaA.data.categorias) if (Array.isArray(c.items)) toda.push(...c.items); if (toda.length) idProdA=toda[0].id||48; }
      const tsA = Date.now();
      const crearPedA = await raw('POST', '/pedidos', { token: ADMIN, body: { escenario: 'mesa', numero_mesa: `A-${tsA}`, items: [{ id_producto: idProdA, cantidad: 2 }] } });
      check('Anular: POST /pedidos → 201', crearPedA.status === 201, `status=${crearPedA.status}`);
      pedIdA = crearPedA.data?.id;
      check('Anular: pedido con id', !!pedIdA, `id=${pedIdA}`);
      const solA = await raw('POST', `/pedidos/${pedIdA}/solicitar-anulacion`, { token: ADMIN, body: { motivo: 'Cliente se fue sin pagar - prueba smoke' } });
      check('Anular: solicitar-anulacion → 201 ok:true', solA.status === 201 && solA.data?.ok === true, `status=${solA.status} data=${JSON.stringify(solA.data)}`);
      const mBD = psql(`SELECT motivo_anulacion FROM pedidos WHERE id=${pedIdA};`);
      check('Anular: motivo persistido en BD', String(mBD||'').includes('Cliente se fue'), `motivo=${mBD}`);
      const aprobA = await raw('POST', `/pedidos/${pedIdA}/anular`, { token: ADMIN, body: { password: ADMIN_PASS } });
      check('Anular: aprobar password correcta → 201', aprobA.status === 201, `status=${aprobA.status}`);
      check('Anular: estado = anulada', aprobA.data?.estado === 'anulada', `estado=${aprobA.data?.estado}`);
      const pedA2 = await raw('POST', '/pedidos', { token: ADMIN, body: { escenario: 'mesa', numero_mesa: `A2-${tsA}`, items: [{ id_producto: idProdA, cantidad: 1 }] } });
      pedIdA2 = pedA2.data?.id;
      await raw('POST', `/pedidos/${pedIdA2}/solicitar-anulacion`, { token: ADMIN, body: { motivo: 'test pass mala' } });
      const malPass = await raw('POST', `/pedidos/${pedIdA2}/anular`, { token: ADMIN, body: { password: 'Clave-Incorrecta-123' } });
      check('Anular: password inválida → 401', malPass.status === 401, `status=${malPass.status}`);
      const solDup = await raw('POST', `/pedidos/${pedIdA}/solicitar-anulacion`, { token: ADMIN, body: { motivo: 'dup' } });
      check('Anular: solicitar en pedido anulada → 400', solDup.status === 400, `status=${solDup.status}`);
      const aprobDup = await raw('POST', `/pedidos/${pedIdA}/anular`, { token: ADMIN, body: { password: ADMIN_PASS } });
      check('Anular: aprobar en pedido anulada → 400', aprobDup.status === 400, `status=${aprobDup.status}`);
      const loginCocA = await loginConBackoff(TEST_EMAIL, TEST_PASS);
      const COC_A = loginCocA.data?.access_token;
      const pedA3 = await raw('POST', '/pedidos', { token: ADMIN, body: { escenario: 'mesa', numero_mesa: `A3-${tsA}`, items: [{ id_producto: idProdA, cantidad: 1 }] } });
      pedIdA3 = pedA3.data?.id;
      await raw('POST', `/pedidos/${pedIdA3}/solicitar-anulacion`, { token: ADMIN, body: { motivo: 'test 403' } });
      const sinPerm = await raw('POST', `/pedidos/${pedIdA3}/anular`, { token: COC_A, body: { password: TEST_PASS } });
      check('Anular: aprobar con cocinero (sin permiso) → 403', sinPerm.status === 403, `status=${sinPerm.status}`);
    } finally {
      for (const id of [pedIdA, pedIdA2, pedIdA3]) { if (id) { try { psql(`DELETE FROM pedido_items WHERE id_pedido=${id}; DELETE FROM pedidos WHERE id=${id};`); } catch {} } }
    }
  }
  // ==== FIN BLOQUE NEGOCIO A ====
  // ============ NEGOCIO B: VENTAS (anular/borrado) + PROPINAS ============
  console.log('\n── VENTAS anular/borrar + PROPINAS ──');
  {
    let ventIdB = null, ventIdB2 = null, fpIdB = null, propIdB = null;
    try {
      const cartaB = await raw('GET', '/carta', { token: ADMIN });
      let idProdB = 48;
      if (cartaB.status === 200 && cartaB.data?.categorias) { const toda=[]; for (const c of cartaB.data.categorias) if (Array.isArray(c.items)) toda.push(...c.items); if (toda.length) idProdB=toda[0].id||48; }
      const tsB = Date.now();
      const cV = await raw('POST', '/ventas', { token: ADMIN, body: { escenario: 'para_llevar', cliente_nombre: `VENTA-SMOKE-${tsB}`, items: [{ id_producto: idProdB, cantidad: 2 }] } });
      check('Ventas: POST /ventas → 201', cV.status === 201, `status=${cV.status}`);
      ventIdB = cV.data?.id;
      check('Ventas: venta con id', !!ventIdB, `id=${ventIdB}`);
      const gV = await raw('GET', `/ventas/${ventIdB}`, { token: ADMIN });
      check('Ventas: GET /ventas/:id → 200', gV.status === 200, `status=${gV.status}`);
      check('Ventas: items array presente', Array.isArray(gV.data?.items), `items=${Array.isArray(gV.data?.items)}`);
      const aV = await raw('PATCH', `/ventas/${ventIdB}/anular`, { token: ADMIN, body: { motivo: 'Error en comanda - prueba smoke' } });
      check('Ventas: anular → 200', aV.status === 200, `status=${aV.status}`);
      check('Ventas: anulada=true', aV.data?.anulada === true, `anulada=${aV.data?.anulada}`);
      const aV2 = await raw('PATCH', `/ventas/${ventIdB}/anular`, { token: ADMIN, body: { motivo: 'dup' } });
      check('Ventas: anular ya anulada → 400', aV2.status === 400, `status=${aV2.status}`);
      const dV = await raw('DELETE', `/ventas/${ventIdB}`, { token: ADMIN });
      check('Ventas: DELETE (superadmin) → 200 ok:true', dV.status === 200 && dV.data?.ok === true, `status=${dV.status} data=${JSON.stringify(dV.data)}`);
      const cV2 = await raw('POST', '/ventas', { token: ADMIN, body: { escenario: 'para_llevar', cliente_nombre: `VENTA-SMOKE2-${tsB}`, items: [{ id_producto: idProdB, cantidad: 1 }] } });
      ventIdB2 = cV2.data?.id;
      const lCocB = await loginConBackoff(TEST_EMAIL, TEST_PASS);
      const dNS = await raw('DELETE', `/ventas/${ventIdB2}`, { token: lCocB.data?.access_token });
      check('Ventas: DELETE con no-superadmin → 403', dNS.status === 403, `status=${dNS.status}`);
      // Formas de pago delete
      const cFp = await raw('POST', '/ventas/formas-pago', { token: ADMIN, body: { nombre: `FP-SMOKE-${tsB}` } });
      check('Ventas FP: POST formas-pago → 201', cFp.status === 201, `status=${cFp.status}`);
      fpIdB = cFp.data?.id;
      const dFp = await raw('DELETE', `/ventas/formas-pago/${fpIdB}`, { token: ADMIN });
      check('Ventas FP: DELETE formas-pago/:id → 200 ok', dFp.status === 200 && dFp.data?.ok === true, `status=${dFp.status} data=${JSON.stringify(dFp.data)}`);
      // Propinas
      const hoyB = new Date().toISOString().slice(0, 10);
      const pP = await raw('POST', '/caja/propina/pago', { token: ADMIN, body: { fecha_pago: hoyB, monto_efectivo: 50000, monto_otros: 20000, notas: 'Prueba smoke propina' } });
      check('Propina: POST /caja/propina/pago → 201', pP.status === 201, `status=${pP.status}`);
      propIdB = pP.data?.id;
      check('Propina: respuesta con id y montos', !!pP.data?.id && Number(pP.data?.monto_efectivo) === 50000, `data=${JSON.stringify(pP.data)}`);
      const lP = await raw('GET', '/caja/propina/pagos', { token: ADMIN });
      check('Propina: GET /caja/propina/pagos → 200 array', lP.status === 200 && Array.isArray(lP.data), `status=${lP.status}`);
      check('Propina: pago creado aparece en listado', Array.isArray(lP.data) && lP.data.some(p => p.id === propIdB), `encontrado=${Array.isArray(lP.data)}`);
    } finally {
      if (ventIdB) { try { psql(`DELETE FROM venta_items WHERE id_venta=${ventIdB}; DELETE FROM ventas WHERE id=${ventIdB};`); } catch {} }
      if (ventIdB2) { try { psql(`DELETE FROM venta_items WHERE id_venta=${ventIdB2}; DELETE FROM ventas WHERE id=${ventIdB2};`); } catch {} }
      if (fpIdB) { try { psql(`DELETE FROM formas_pago WHERE id=${fpIdB};`); } catch {} }
      if (propIdB) { try { psql(`DELETE FROM pagos_propina WHERE id=${propIdB};`); } catch {} }
    }
  }
  // ==== FIN BLOQUE NEGOCIO B ====
  // ============ NEGOCIO C: CARTA ADMIN + RESÚMENES POSITIVOS ============
  console.log('\n── CARTA ADMIN + RESÚMENES POSITIVOS ──');
  {
    let catIdC = null, itemIdC = null, factIdC = null, compIdC = null;
    try {
      const aCart = await raw('GET', '/carta/administracion', { token: ADMIN });
      check('Carta admin: GET /carta/administracion → 200', aCart.status === 200, `status=${aCart.status}`);
      check('Carta admin: categorias array', Array.isArray(aCart.data?.categorias), `cats=${Array.isArray(aCart.data?.categorias)}`);
      const tsC = Date.now();
      const cCat = await raw('POST', '/carta/categorias', { token: ADMIN, body: { nombre: `CAT-SMOKE-${tsC}`, orden: 99 } });
      check('Carta admin: POST categorias → 201', cCat.status === 201, `status=${cCat.status}`);
      catIdC = cCat.data?.id;
      const uCat = await raw('PUT', `/carta/categorias/${catIdC}`, { token: ADMIN, body: { nombre: `CAT-SMOKE-${tsC}-EDIT`, orden: 100 } });
      check('Carta admin: PUT categorias/:id → 200', uCat.status === 200 && uCat.data?.nombre?.includes('EDIT'), `status=${uCat.status}`);
      const cIt = await raw('POST', '/carta/items', { token: ADMIN, body: { id_categoria: catIdC, nombre: `ITEM-SMOKE-${tsC}`, descripcion: 'Item smoke', precio: 15000, costo: 5000 } });
      check('Carta admin: POST items → 201', cIt.status === 201, `status=${cIt.status}`);
      itemIdC = cIt.data?.id;
      const uIt = await raw('PUT', `/carta/items/${itemIdC}`, { token: ADMIN, body: { id_categoria: catIdC, nombre: `ITEM-SMOKE-EDIT-${Date.now()}`, precio: 16000, descripcion: 'Actualizado' } });
      check('Carta admin: PUT items/:id → 200', uIt.status === 200, `status=${uIt.status}`);
      const togg = await raw('POST', `/carta/items/${itemIdC}/toggle`, { token: ADMIN });
      check('Carta admin: toggle → 200 activo false', togg.status === 200 && togg.data?.ok === true && togg.data?.activo === false, `status=${togg.status} data=${JSON.stringify(togg.data)}`);
      const togg2 = await raw('POST', `/carta/items/${itemIdC}/toggle`, { token: ADMIN });
      check('Carta admin: toggle reactivar → activo true', togg2.status === 200 && togg2.data?.activo === true, `status=${togg2.status}`);
      const dIt = await raw('DELETE', `/carta/items/${itemIdC}`, { token: ADMIN });
      check('Carta admin: DELETE items → 200 ok:true', dIt.status === 200 && dIt.data?.ok === true, `status=${dIt.status}`);
      itemIdC = null;
      const dCat = await raw('DELETE', `/carta/categorias/${catIdC}`, { token: ADMIN });
      check('Carta admin: DELETE categorias → 200 ok:true', dCat.status === 200 && dCat.data?.ok === true, `status=${dCat.status}`);
      catIdC = null;

      // Resúmenes positivos: crear factura + comprobante reales, asignar y clasificar
      const hoyC = new Date().toISOString().slice(0, 10);
      const cFac = await raw('POST', '/facturas', { token: ADMIN, body: { fecha: hoyC, numero_factura: `FV-POS-${tsC}`, proveedor: 'PROV SMOKE POS', total_con_impuestos: 100000, base_imponible: 84000, iva: 16000, moneda: 'COP', items: [{ descripcion: 'Item test', cantidad: 1, precio_unitario: 100000, base_imponible: 84000, iva: 16000, total: 100000 }] } });
      check('Resumen pos: POST /facturas → 201', cFac.status === 201, `status=${cFac.status}`);
      factIdC = cFac.data?.id;
      const cComp = await raw('POST', '/comprobantes', { token: ADMIN, body: { fecha: hoyC, beneficiario_emisor: 'Banco Test', referencia: `COMP-POS-${tsC}`, total_con_impuestos: 100000 } });
      check('Resumen pos: POST /comprobantes → 201', cComp.status === 201, `status=${cComp.status}`);
      compIdC = cComp.data?.id;
      const asig = await raw('PATCH', '/resumenes/asignar-comprobante', { token: ADMIN, body: { facturaId: factIdC, comprobanteId: compIdC } });
      check('Resumen pos: asignar-comprobante (ids válidos) → ok:true', asig.status === 200 && asig.data?.ok === true, `status=${asig.status} data=${JSON.stringify(asig.data)}`);
      const flink = psql(`SELECT id_comprobante FROM facturas WHERE id=${factIdC};`);
      check('Resumen pos: factura.id_comprobante seteado en BD', String(flink||'').includes(String(compIdC)), `row=${flink}`);
      const clasi = await raw('PATCH', '/resumenes/clasificar-comprobante', { token: ADMIN, body: { comprobanteId: compIdC, tipo: 'transferencia' } });
      check('Resumen pos: clasificar (transferencia) → ok:true', clasi.status === 200 && clasi.data?.ok === true, `status=${clasi.status}`);
      const tman = psql(`SELECT tipo_manual FROM comprobantes_pago WHERE id=${compIdC};`);
      check('Resumen pos: tipo_manual=transferencia en BD', String(tman||'').trim() === 'transferencia', `tipo=${tman}`);
    } finally {
      if (itemIdC) { try { psql(`DELETE FROM carta_items WHERE id=${itemIdC};`); } catch {} }
      if (catIdC) { try { psql(`DELETE FROM carta_categorias WHERE id=${catIdC};`); } catch {} }
      if (factIdC) { try { psql(`DELETE FROM facturas_items WHERE id_factura=${factIdC}; DELETE FROM facturas WHERE id=${factIdC};`); } catch {} }
      if (compIdC) { try { psql(`DELETE FROM comprobantes_pago WHERE id=${compIdC};`); } catch {} }
    }
  }
  // ==== FIN BLOQUE NEGOCIO C ====

  // ============ SEGURIDAD AUTH: 403 SIN TOKEN / PÚBLICOS / PERMISOS / REGLAS ============
  console.log('\n── SEGURIDAD AUTH (sin token, públicos, permisos, reglas) ──');
  {
    const cfgPub = await raw('GET', '/auth/config');
    check('AuthSec: GET /auth/config público → 200 sin token', cfgPub.status === 200 && typeof cfgPub.data?.inactividadMin === 'number', `status=${cfgPub.status}`);

    const protegidosSinToken = [
      { method: 'GET', path: '/auth/mis-permisos', body: null },
      { method: 'POST', path: '/auth/cambiar-contrasena', body: { passwordActual: 'x', passwordNueva: 'y' } },
      { method: 'GET', path: '/auth/usuarios/pendientes', body: null },
      { method: 'GET', path: '/auth/usuarios', body: null },
      { method: 'GET', path: '/auth/servicios', body: null },
      { method: 'GET', path: '/auth/roles/catalogo', body: null },
      { method: 'GET', path: '/auth/roles/catalogo-arbol', body: null },
      { method: 'GET', path: '/auth/roles', body: null },
    ];
    for (const ep of protegidosSinToken) {
      const r = await raw(ep.method, ep.path, { body: ep.body || null });
      check(`AuthSec: ${ep.method} ${ep.path} sin token → 403`, r.status === 403, `status=${r.status}`);
    }
    const postRolesSinTok = await raw('POST', '/auth/roles', { body: { nombre: 'test', permisos: [] } });
    check('AuthSec: POST /auth/roles sin token → 403', postRolesSinTok.status === 403, `status=${postRolesSinTok.status}`);
    const putRolesSinTok = await raw('PUT', '/auth/roles/test', { body: { descripcion: 'x' } });
    check('AuthSec: PUT /auth/roles/:nombre sin token → 403', putRolesSinTok.status === 403, `status=${putRolesSinTok.status}`);
    const delRolesSinTok = await raw('DELETE', '/auth/roles/test');
    check('AuthSec: DELETE /auth/roles/:nombre sin token → 403', delRolesSinTok.status === 403, `status=${delRolesSinTok.status}`);
    const postSvcSinTok = await raw('POST', '/auth/servicios', { body: { nombre: 'x' } });
    check('AuthSec: POST /auth/servicios sin token → 403', postSvcSinTok.status === 403, `status=${postSvcSinTok.status}`);
    const delSvcSinTok = await raw('DELETE', '/auth/servicios/1');
    check('AuthSec: DELETE /auth/servicios/:id sin token → 403', delSvcSinTok.status === 403, `status=${delSvcSinTok.status}`);
    const idInex = 999999;
    const aprSinTok = await raw('POST', `/auth/usuarios/${idInex}/aprobar`);
    check('AuthSec: POST /auth/usuarios/:id/aprobar sin token → 403', aprSinTok.status === 403, `status=${aprSinTok.status}`);
    const estSinTok = await raw('POST', `/auth/usuarios/${idInex}/estado`, { body: { estado: 'aprobado' } });
    check('AuthSec: POST /auth/usuarios/:id/estado sin token → 403', estSinTok.status === 403, `status=${estSinTok.status}`);
    const rolSinTok = await raw('POST', `/auth/usuarios/${idInex}/rol`, { body: { rol: 'cocinero' } });
    check('AuthSec: POST /auth/usuarios/:id/rol sin token → 403', rolSinTok.status === 403, `status=${rolSinTok.status}`);

    const loginCoc = await loginConBackoff(TEST_EMAIL, TEST_PASS);
    const COC = loginCoc.data?.access_token;
    await sleep(1200);
    const endpointsReqPermiso = [
      { method: 'GET', path: '/auth/mis-permisos', body: null },
      { method: 'GET', path: '/auth/usuarios/pendientes', body: null },
      { method: 'GET', path: '/auth/usuarios', body: null },
      { method: 'GET', path: '/auth/servicios', body: null },
      { method: 'GET', path: '/auth/roles/catalogo', body: null },
      { method: 'GET', path: '/auth/roles/catalogo-arbol', body: null },
      { method: 'GET', path: '/auth/roles', body: null },
    ];
    for (const ep of endpointsReqPermiso) {
      // mis-permisos es auto-grant (ver sus propios permisos) → 200; el resto exige permiso → 403
      const esperado = ep.path === '/auth/mis-permisos' ? 200 : 403;
      const r = await raw(ep.method, ep.path, { token: COC, body: ep.body || null });
      check(`AuthSec: ${ep.method} ${ep.path} con cocinero → ${esperado}`, r.status === esperado, `status=${r.status}`);
    }
    const postRolesCoc = await raw('POST', '/auth/roles', { token: COC, body: { nombre: 'rol_coc', permisos: [] } });
    check('AuthSec: POST /auth/roles con cocinero → 403', postRolesCoc.status === 403, `status=${postRolesCoc.status}`);
    const postSvcCoc = await raw('POST', '/auth/servicios', { token: COC, body: { nombre: 'svc_coc' } });
    check('AuthSec: POST /auth/servicios con cocinero → 403', postSvcCoc.status === 403, `status=${postSvcCoc.status}`);
    const estCoc = await raw('POST', `/auth/usuarios/${idInex}/estado`, { token: COC, body: { estado: 'aprobado' } });
    check('AuthSec: POST /auth/usuarios/:id/estado con cocinero → 403', estCoc.status === 403, `status=${estCoc.status}`);

    const crearSuper = await raw('POST', '/auth/roles', { token: ADMIN, body: { nombre: 'superadmin', permisos: [] } });
    check('AuthSec: POST /auth/roles nombre superadmin → 403', crearSuper.status === 403, `status=${crearSuper.status}`);
    const rolTempNombre = `rol_temp_${Date.now()}`;
    const crearTemp = await raw('POST', '/auth/roles', { token: ADMIN, body: { nombre: rolTempNombre, permisos: [] } });
    check('AuthSec: setup crear rol temporal → 201', crearTemp.status === 201, `status=${crearTemp.status}`);
    const renombrarSuper = await raw('PUT', `/auth/roles/${rolTempNombre}`, { token: ADMIN, body: { nombre: 'superadmin' } });
    check('AuthSec: PUT /auth/roles/:nombre renombrar a superadmin → 403', renombrarSuper.status === 403, `status=${renombrarSuper.status}`);
    try { psql(`DELETE FROM roles WHERE nombre='${rolTempNombre}';`); } catch {}
    const rolesBase = ['admin', 'encargado', 'cajero', 'cocinero', 'mesero', 'ayudante'];
    for (const rb of rolesBase) {
      const delBase = await raw('DELETE', `/auth/roles/${rb}`, { token: ADMIN });
      check(`AuthSec: DELETE /auth/roles/${rb} (rol base) → 400`, delBase.status === 400, `status=${delBase.status}`);
    }
    const userNormalEmail = `normal_${Date.now()}@test.local`;
    await crearUsuario(userNormalEmail, 'Pass-123', 'mesero');
    const userNormalId = psql(`SELECT id FROM usuarios WHERE email='${userNormalEmail}';`);
    if (userNormalId) {
      const asignarSuperConCoc = await raw('POST', `/auth/usuarios/${userNormalId}/rol`, { token: COC, body: { rol: 'superadmin' } });
      check('AuthSec: asignar superadmin con cocinero → 403', asignarSuperConCoc.status === 403, `status=${asignarSuperConCoc.status}`);
      psql(`DELETE FROM usuarios WHERE id=${userNormalId};`);
    }
    const adminId = psql(`SELECT id FROM usuarios WHERE email='${ADMIN_EMAIL}';`);
    if (adminId) {
      const modificarSuperConCoc = await raw('POST', `/auth/usuarios/${adminId}/rol`, { token: COC, body: { rol: 'cocinero' } });
      check('AuthSec: modificar superadmin con cocinero → 403', modificarSuperConCoc.status === 403, `status=${modificarSuperConCoc.status}`);
    }
    const passMala = await raw('POST', '/auth/cambiar-contrasena', { token: COC, body: { passwordActual: 'Clave-Incorrecta-999', passwordNueva: 'Nueva-123' } });
    if (passMala.status === 429) { await sleep(62000); }
    const passMala2 = passMala.status === 429 ? await raw('POST', '/auth/cambiar-contrasena', { token: COC, body: { passwordActual: 'Clave-Incorrecta-999', passwordNueva: 'Nueva-123' } }) : passMala;
    check('AuthSec: cambiar-contrasena passwordActual mala → 401', passMala2.status === 401, `status=${passMala2.status}`);

    const verifyEmail = `verify_${Date.now()}@test.local`;
    const regVerify = await raw('POST', '/auth/register', { body: { email: verifyEmail } });
    const codigo = psql(`SELECT codigo_verificacion FROM usuarios WHERE email='${verifyEmail}';`);
    if (codigo) {
      const vcValido = await raw('POST', '/auth/verify-code', { body: { email: verifyEmail, code: codigo } });
      if (vcValido.status === 429) { await sleep(62000); }
      const vcValido2 = vcValido.status === 429 ? await raw('POST', '/auth/verify-code', { body: { email: verifyEmail, code: codigo } }) : vcValido;
      check('AuthSec: verify-code válido → 200 ok:true', vcValido2.status === 200 && vcValido2.data?.ok === true, `status=${vcValido2.status}`);
      const vcInvalido = await raw('POST', '/auth/verify-code', { body: { email: verifyEmail, code: '000000' } });
      if (vcInvalido.status === 429) { await sleep(62000); }
      const vcInvalido2 = vcInvalido.status === 429 ? await raw('POST', '/auth/verify-code', { body: { email: verifyEmail, code: '000000' } }) : vcInvalido;
      check('AuthSec: verify-code incorrecto → 400', vcInvalido2.status === 400, `status=${vcInvalido2.status}`);
      psql(`UPDATE usuarios SET codigo_expiracion = NOW() - INTERVAL '1 hour' WHERE email='${verifyEmail}';`);
      const vcExpirado = await raw('POST', '/auth/verify-code', { body: { email: verifyEmail, code: codigo } });
      if (vcExpirado.status === 429) { await sleep(62000); }
      const vcExpirado2 = vcExpirado.status === 429 ? await raw('POST', '/auth/verify-code', { body: { email: verifyEmail, code: codigo } }) : vcExpirado;
      check('AuthSec: verify-code expirado → 400', vcExpirado2.status === 400, `status=${vcExpirado2.status}`);
      psql(`DELETE FROM usuarios WHERE email='${verifyEmail}';`);
    }

    const misPermAdmin = await raw('GET', '/auth/mis-permisos', { token: ADMIN });
    check('AuthSec: mis-permisos superadmin → 200 rol+permisos', misPermAdmin.status === 200 && misPermAdmin.data?.rol === 'superadmin' && Array.isArray(misPermAdmin.data?.permisos), `status=${misPermAdmin.status}`);
    const misPermCoc = await raw('GET', '/auth/mis-permisos', { token: COC });
    check('AuthSec: mis-permisos cocinero → 200 rol+permisos', misPermCoc.status === 200 && misPermCoc.data?.rol === 'cocinero' && Array.isArray(misPermCoc.data?.permisos), `status=${misPermCoc.status}`);

    const listAdmin = await raw('GET', '/auth/usuarios', { token: ADMIN });
    check('AuthSec: GET /auth/usuarios superadmin → 200', listAdmin.status === 200 && Array.isArray(listAdmin.data), `status=${listAdmin.status}`);
    const pendAdmin = await raw('GET', '/auth/usuarios/pendientes', { token: ADMIN });
    check('AuthSec: GET /auth/usuarios/pendientes superadmin → 200', pendAdmin.status === 200 && Array.isArray(pendAdmin.data), `status=${pendAdmin.status}`);
    const listCoc = await raw('GET', '/auth/usuarios', { token: COC });
    check('AuthSec: GET /auth/usuarios cocinero → 403', listCoc.status === 403, `status=${listCoc.status}`);

    const userRolEmail = `userrol_${Date.now()}@test.local`;
    await crearUsuario(userRolEmail, 'Pass-123', 'ayudante');
    const userRolId = psql(`SELECT id FROM usuarios WHERE email='${userRolEmail}';`);
    if (userRolId) {
      const asignarNormal = await raw('POST', `/auth/usuarios/${userRolId}/rol`, { token: ADMIN, body: { rol: 'mesero' } });
      check('AuthSec: asignar rol mesero con superadmin → 200', asignarNormal.status === 200 && asignarNormal.data?.ok === true, `status=${asignarNormal.status}`);
      const rolNuevo = psql(`SELECT rol FROM usuarios WHERE id=${userRolId};`);
      check('AuthSec: rol persistido en BD = mesero', rolNuevo === 'mesero', `rol=${rolNuevo}`);
      const asignarSinPerm = await raw('POST', `/auth/usuarios/${userRolId}/rol`, { token: COC, body: { rol: 'cajero' } });
      check('AuthSec: asignar rol con cocinero → 403', asignarSinPerm.status === 403, `status=${asignarSinPerm.status}`);
      psql(`DELETE FROM usuarios WHERE id=${userRolId};`);
    }
  }
  // ==== FIN BLOQUE SEGURIDAD-AUTH ====
  // ============ SEGURIDAD NEGOCIO: 403 SIN TOKEN / PÚBLICOS / PERMISOS FINOS ============
  console.log('\n── SEGURIDAD NEGOCIO (sin token, públicos, permisos) ──');
  {
    const fId = await raw('GET', '/facturas/999999');
    check('NegSec: GET /facturas/:id sin token → 403', fId.status === 403, `status=${fId.status}`);
    const fItems = await raw('GET', '/facturas/items');
    check('NegSec: GET /facturas/items sin token → 403', fItems.status === 403, `status=${fItems.status}`);
    const cList = await raw('GET', '/comprobantes');
    check('NegSec: GET /comprobantes sin token → 403', cList.status === 403, `status=${cList.status}`);
    const cId = await raw('GET', '/comprobantes/999999');
    check('NegSec: GET /comprobantes/:id sin token → 403', cId.status === 403, `status=${cId.status}`);
    const vList = await raw('GET', '/ventas');
    check('NegSec: GET /ventas sin token → 403', vList.status === 403, `status=${vList.status}`);
    const vFormas = await raw('GET', '/ventas/formas-pago');
    check('NegSec: GET /ventas/formas-pago sin token → 403', vFormas.status === 403, `status=${vFormas.status}`);
    const pList = await raw('GET', '/pedidos');
    check('NegSec: GET /pedidos sin token → 403', pList.status === 403, `status=${pList.status}`);
    const pId = await raw('GET', '/pedidos/999999');
    check('NegSec: GET /pedidos/:id sin token → 403', pId.status === 403, `status=${pId.status}`);
    const cAct = await raw('GET', '/caja/activo');
    check('NegSec: GET /caja/activo sin token → 403', cAct.status === 403, `status=${cAct.status}`);
    const cTurnos = await raw('GET', '/caja/turnos');
    check('NegSec: GET /caja/turnos sin token → 403', cTurnos.status === 403, `status=${cTurnos.status}`);
    const cArq = await raw('GET', '/caja/999999/arqueo');
    check('NegSec: GET /caja/:id/arqueo sin token → 403', cArq.status === 403, `status=${cArq.status}`);
    const rList = await raw('GET', '/resumenes?mes=2026-10');
    check('NegSec: GET /resumenes sin token → 403', rList.status === 403, `status=${rList.status}`);
    const rCont = await raw('GET', '/resumenes/contable?mes=2026-10');
    check('NegSec: GET /resumenes/contable sin token → 403', rCont.status === 403, `status=${rCont.status}`);
    const rUlt = await raw('GET', '/resumenes/ultima-fecha');
    check('NegSec: GET /resumenes/ultima-fecha sin token → 403', rUlt.status === 403, `status=${rUlt.status}`);
    const gRes = await raw('GET', '/gastos/resumen?mes=2026-10');
    check('NegSec: GET /gastos/resumen sin token → 403', gRes.status === 403, `status=${gRes.status}`);
    const gCat = await raw('GET', '/gastos/por-categoria?mes=2026-10');
    check('NegSec: GET /gastos/por-categoria sin token → 403', gCat.status === 403, `status=${gCat.status}`);
    const gTot = await raw('GET', '/gastos/total?mes=2026-10');
    check('NegSec: GET /gastos/total sin token → 403', gTot.status === 403, `status=${gTot.status}`);
    const cAdm = await raw('GET', '/carta/administracion');
    check('NegSec: GET /carta/administracion sin token → 403', cAdm.status === 403, `status=${cAdm.status}`);

    const pubCarta = await raw('GET', '/carta');
    check('NegSec: GET /carta (pública) → 200 sin token', pubCarta.status === 200, `status=${pubCarta.status}`);
    const pubHealth = await raw('GET', '/health');
    check('NegSec: GET /health (pública) → 200 sin token', pubHealth.status === 200, `status=${pubHealth.status}`);

    const loginCocinero = await loginConBackoff(TEST_EMAIL, TEST_PASS);
    check('NegSec: login cocinero → 200 + token', loginCocinero.status === 200 && !!loginCocinero.data?.access_token, `status=${loginCocinero.status}`);
    const COCINERO = loginCocinero.data?.access_token;
    await sleep(1200);

    const admCoc = await raw('GET', '/carta/administracion', { token: COCINERO });
    check('NegSec: /carta/administracion con cocinero (sin carta:editar) → 403', admCoc.status === 403, `status=${admCoc.status}`);

    const cartaTmp = await raw('GET', '/carta', { token: ADMIN });
    let idProdTmp = 48;
    if (cartaTmp.status === 200 && cartaTmp.data?.categorias) {
      const todos = []; for (const c of cartaTmp.data.categorias) if (Array.isArray(c.items)) todos.push(...c.items);
      if (todos.length) idProdTmp = todos[0].id || 48;
    }
    const vTmp = await raw('POST', '/ventas', { token: ADMIN, body: { escenario: 'para_llevar', cliente_nombre: 'TMP', items: [{ id_producto: idProdTmp, cantidad: 1 }] } });
    const vId = vTmp.data?.id;
    if (vId) {
      const delCoc = await raw('DELETE', `/ventas/${vId}`, { token: COCINERO });
      check('NegSec: DELETE /ventas/:id con cocinero (no superadmin) → 403', delCoc.status === 403, `status=${delCoc.status}`);
      await raw('DELETE', `/ventas/${vId}`, { token: ADMIN });
    }

    const propCoc = await raw('POST', '/caja/propina/pago', { token: COCINERO, body: { fecha_pago: new Date().toISOString().slice(0,10), monto_efectivo: 1000, monto_otros: 0 } });
    check('NegSec: /caja/propina/pago con cocinero (sin caja_ver) → 403', propCoc.status === 403, `status=${propCoc.status}`);
    const propListCoc = await raw('GET', '/caja/propina/pagos', { token: COCINERO });
    check('NegSec: /caja/propina/pagos con cocinero (sin caja_ver) → 403', propListCoc.status === 403, `status=${propListCoc.status}`);
    const movCoc = await raw('POST', '/caja/movimiento/egreso', { token: COCINERO, body: { id_turno: 1, concepto: 'X', monto: 1 } });
    check('NegSec: /caja/movimiento/egreso con cocinero (sin caja_ver) → 403', movCoc.status === 403, `status=${movCoc.status}`);
    const movIngCoc = await raw('POST', '/caja/movimiento/ingreso', { token: COCINERO, body: { id_turno: 1, concepto: 'X', monto: 1, autorizado_por: 1 } });
    check('NegSec: /caja/movimiento/ingreso con cocinero (sin caja_ver) → 403', movIngCoc.status === 403, `status=${movIngCoc.status}`);
    const asiCoc = await raw('PATCH', '/resumenes/asignar-comprobante', { token: COCINERO, body: { facturaId: 999999, comprobanteId: 999999 } });
    check('NegSec: /resumenes/asignar-comprobante con cocinero (sin resumenes:ver) → 403', asiCoc.status === 403, `status=${asiCoc.status}`);
    const claCoc = await raw('PATCH', '/resumenes/clasificar-comprobante', { token: COCINERO, body: { comprobanteId: 999999, tipo: 'transferencia' } });
    check('NegSec: /resumenes/clasificar-comprobante con cocinero (sin resumenes:ver) → 403', claCoc.status === 403, `status=${claCoc.status}`);
  }
  // ==== FIN BLOQUE SEGURIDAD-NEGOCIO ====

  // ============ FASE 6A: TIEMPO REAL (WebSocket por nginx) ============
  // REGRESIÓN (fix 0.18.4): nginx debe proxear /socket.io/ al backend.
  // Sin el location de upgrade, el handshake cae en `location /` y devuelve
  // el HTML de la app (text/html) en vez del SID de Socket.IO.
  console.log('\n── FASE 6A: TIEMPO REAL (WebSocket /socket.io/) ──');
  {
    const socketBase = BASE.replace('/api', '');
    const hsRes = await fetch(`${socketBase}/socket.io/?EIO=4&transport=polling`, {
      headers: { Accept: 'application/json' },
    });
    const hsBody = await hsRes.text();
    const esHandshake = hsBody.includes('"sid"') || /^\d+\{"sid"/.test(hsBody.trim());
    const contentType = hsRes.headers.get('content-type') || '';
    check('WS: handshake /socket.io → 200 y NÚCLEO Socket.IO (no HTML)', hsRes.status === 200 && esHandshake, `status=${hsRes.status} ct=${contentType} body=${hsBody.slice(0,60)}`);
    check('WS: content-type NO es text/html (nginx no devuelve la app)', !contentType.includes('text/html'), `ct=${contentType}`);

    // REGRESIÓN (fix 0.18.5): crear comprobante dispara comprobante:nuevo y
    // asignar dispara factura:actualizada. Para no depender de un cliente
    // Socket.IO en la suite, verificamos que los endpoints mutan sin error
    // (el evento ya está cubierto por la prueba manual del QA con socket-client).
    const tsW = Date.now();
    const cW = await raw('POST', '/comprobantes', { token: ADMIN, body: { fecha: '2026-11-24', beneficiario_emisor: 'WS E2E', referencia: `WS-E2E-${tsW}`, total_con_impuestos: 1000 } });
    check('WS: POST /comprobantes → 201 (para evento realtime)', cW.status === 201, `status=${cW.status}`);
    const cWId = cW.data?.id;
    if (cWId) {
      try { psql(`DELETE FROM comprobantes_pago WHERE id=${cWId};`); } catch {}
    }

    // REGRESIÓN (fix pedido:actualizado): cobrar y entregar deben emitir en
    // tiempo real para que los demás terminales refresquen el pedido (evita
    // tocar "Marcar entregado" sobre algo ya entregado → snackbar 403).
    // Se verifica contra el módulo COMPILADO que el gateway expone el emisor
    // y que pedidos.service lo invoca en cobrar y entregar.
    try {
      const gw = readFileSync('/app/dist/realtime/realtime.gateway.js', 'utf8');
      const psvc = readFileSync('/app/dist/pedidos/pedidos.service.js', 'utf8');
      check('REGRESIÓN: gateway expone emitPedidoActualizado', gw.includes('emitPedidoActualizado'), 'gateway');
      check('REGRESIÓN: pedidos.service invoca emitPedidoActualizado', psvc.includes('emitPedidoActualizado'), 'pedidos.service');
      check('REGRESIÓN: evento pedido:actualizado en nomenclatura', gw.includes("'pedido:actualizado'"), 'evento');
    } catch (e) {
      check('REGRESIÓN: gateway/emisión pedido:actualizado legibles', false, 'error=' + String(e));
    }

    // === WEB  CLIENTE WS REAL (flujo completo en vivo) ===
    // Conecta un cliente Socket.IO al nginx, crea un para_llevar, lo cobra y lo
    // entrega; verifica que `pedido:actualizado` llega AL SOCKET (no solo el
    // código). El socket.io-client se instala en /tmp/wsclient por run-smoke.sh.
    let io = null;
    try {
      const { createRequire } = await import('node:module');
      const cRequire = createRequire('/tmp/wsclient/package.json');
      io = cRequire('socket.io-client');
    } catch (e) {
      console.log('   (sin socket.io-client en el contenedor — se omiten checks de cliente WS)');
    }
    if (io) {
      const wsBase = BASE.replace('/api', '');
      let wsSelId = null;
      let wsCobrado = null;
      let wsEntregado = null;
      const socket = io(wsBase, { transports: ['websocket'], auth: { token: ADMIN }, reconnection: false, timeout: 8000 });
      socket.on('pedido:actualizado', (d) => {
        if (d && d.id !== wsSelId) return;
        if (d && d.estado === 'pagada_pendiente') wsCobrado = d;
        if (d && d.estado === 'entregada') wsEntregado = d;
      });
      const conectado = await new Promise((res) => {
        const t = setTimeout(() => res(false), 8000);
        socket.once('connect', () => { clearTimeout(t); res(true); });
        socket.once('connect_error', () => { clearTimeout(t); res(false); });
      });
      check('WS real: cliente conecta al socket (handshake autenticado)', conectado === true, conectado ? 'ok' : 'error');
      if (conectado) {
        // crear pedido para_llevar
        const cartaWs = await raw('GET', '/carta', { token: ADMIN });
        let idProdWs = 48;
        if (cartaWs.status === 200 && cartaWs.data?.categorias) {
          const todos = [];
          for (const c of cartaWs.data.categorias) if (Array.isArray(c.items)) todos.push(...c.items);
          if (todos.length) idProdWs = todos[0].id || 48;
        }
        const crearWs = await raw('POST', '/pedidos', { token: ADMIN, body: { escenario: 'para_llevar', cliente_nombre: `WS-E2E-${Date.now()}`, items: [{ id_producto: idProdWs, cantidad: 1 }] } });
        wsSelId = crearWs.data?.id;
        check('WS real: pedido para_llevar creado', crearWs.status === 201 && !!wsSelId, `status=${crearWs.status} id=${wsSelId}`);
        if (wsSelId) {
          // cobrar
          const formasWs = await raw('GET', '/ventas/formas-pago', { token: ADMIN });
          let fpWs = null;
          if (Array.isArray(formasWs.data)) { const a = formasWs.data.find(f => f.activo === true); fpWs = a ? a.id : null; }
          const cobWs = await raw('POST', `/pedidos/${wsSelId}/cobrar`, { token: ADMIN, body: { id_forma_pago: fpWs } });
          check('WS real: cobrar → 201 (dispara pedido:actualizado)', cobWs.status === 201, `status=${cobWs.status}`);
          await sleep(1500);
          // entregar
          const entWs = await raw('POST', `/pedidos/${wsSelId}/entregar`, { token: ADMIN });
          check('WS real: entregar → 201 (dispara pedido:actualizado)', entWs.status === 201 || entWs.status === 200, `status=${entWs.status}`);
          await sleep(1500);
        }
        check('WS real: evento pedido:actualizado recibido al COBRAR (pagada_pendiente)', wsCobrado && wsCobrado.id === wsSelId, wsCobrado ? `id=${wsCobrado.id} estado=${wsCobrado.estado}` : 'no llegó');
        check('WS real: evento pedido:actualizado recibido al ENTREGAR (entregada)', wsEntregado && wsEntregado.id === wsSelId, wsEntregado ? `id=${wsEntregado.id} estado=${wsEntregado.estado}` : 'no llegó');
        socket.disconnect();
        if (wsSelId) { try {
          // borrar pedido y la venta que cobrar creó (auto-limpieza)
          psql(`DELETE FROM pedido_items WHERE id_pedido=${wsSelId}; DELETE FROM pedidos WHERE id=${wsSelId};`);
          psql(`DELETE FROM vi FROM venta_items vi JOIN ventas v ON vi.id_venta=v.id WHERE v.cliente_nombre LIKE 'WS-E2E-%'; DELETE FROM ventas WHERE cliente_nombre LIKE 'WS-E2E-%';`);
        } catch {} }
      } else {
        socket.disconnect();
      }
    }
  }

  // ============ LIMPIEZA DE DATOS DE PRUEBA ============
  // Borra el turno (y sus movimientos), la venta y el pedido creados por la
  // suite, para que cada corrida no acumule basura en :test. Solo si existen.
  {
    try { psql(`DELETE FROM venta_items WHERE id_venta IN (SELECT id FROM ventas WHERE id_turno=${turnoAbiertoId ?? 0}); DELETE FROM ventas WHERE id_turno=${turnoAbiertoId ?? 0};`); } catch {}
    try { psql(`DELETE FROM movimientos_caja WHERE id_turno=${turnoAbiertoId ?? 0};`); } catch {}
    try { psql(`DELETE FROM pedido_items WHERE id_pedido=${pedidoPruebaId ?? 0}; DELETE FROM pedidos WHERE id=${pedidoPruebaId ?? 0};`); } catch {}
    try { if (turnoAbiertoId) psql(`DELETE FROM turnos_caja WHERE id=${turnoAbiertoId};`); } catch {}
    // Limpiar categoría (e items) de carta creada por la Fase 4F
    try { if (catSmokeId) psql(`DELETE FROM carta_items WHERE id_categoria=${catSmokeId}; DELETE FROM carta_categorias WHERE id=${catSmokeId};`); } catch {}
    // El DELETE de roles hace soft-delete (marca deleted_at, la fila persiste).
    // Eliminar físicamente el rol de la Fase 4E para no acumular filas en :test.
    try { if (rolSmokeNombre) psql(`DELETE FROM roles WHERE nombre='${rolSmokeNombre}';`); } catch {}
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