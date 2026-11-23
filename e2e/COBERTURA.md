# Cobertura de la suite e2e — Fiumicello

Mapa de qué verifica `smoke.mjs` hoy y qué falta para cubrir la app al 100%.
Objetivo: que ENTES de cada bump/deploy la suite recorra toda la API en UNA
corrida (sin datos sucios permanentes: los usuarios temporales se borran).

## Estado actual: 140 checks (seguridad/permisos/DTOs/email/auth/CRUD/caja/roles/calidad-OCR)

Total endpoints en la app: **88** (13 módulos). Fases cubiertas: 0 (seguridad/
permisos/DTOs/OCR/usuarios), 1 (auth completo + tokens de servicio), 2
(facturas/comprobantes CRUD+dedup+soft-delete), 3 (caja/pedidos/ventas),
4 (resúmenes/gastos/roles/carta), 5A (calidad OCR blur — Capa 1: 7 casos
calibrados con `decidirCalidad()` del módulo compilado + integración real
subiendo una imagen borrosa con token de servicio). Falta: escaneo y permisos
finos (resto de Fase 5).

---

## Mapa por módulo — cobertura hoy vs pendiente

### ✅ YA CUBIERTOS (seguridad / auth / validación)
| Módulo | Qué verifica | Checks |
|---|---|---|
| auth/login | login OK, clave mala→401, DTO campo extra→400 | 3 |
| públicas | /health, /carta sin token→200 | 2 |
| permisos | deny 403 sin token, superadmin bypass, cocinero deny facturas, cocina:ver | 4 |
| DTOs | caja, ventas(item), facturas, roles → 400 campo extra | 4 |
| seguridad /archivos | 401 sin token; Swagger 401/200 | 3 |
| OCR | 403 sin token, 403 JWT humano (blindaje) | 2 |
| usuarios | desactivar→login 401, reactivar→login 200 | 4 |
| **total** | | **22** |

### 🟠 CUBIERTOS PARCIALMENTE (falta el flujo de negocio)
| Módulo | Cubierto | Falta |
|---|---|---|
| **auth** | login, estado | register→verify→aprobado completo; refresh+logout rotación cookie; forgot/reset-password; cambiar-contraseña; tokens de servicio (generar/revocar) |
| **facturas** | DTO 400 | POST válido→201; GET listar/obtener/items; dedup→409; PUT editar; soft-delete→excluida |
| **carta** | GET público 200 | crear/editar categoría+item; toggle activo; admin (solo con carta:editar) |

### 🔴 SIN CUBRIR (flujos funcionales de negocio)
| Módulo | Endpoints | Qué verificar |
|---|---|---|
| **comprobantes** | 5 | POST válido→201; GET; PUT; DELETE soft; dedup referencia+total→409 |
| **ventas** | 9 | POST venta→201 (escenarios mesa/para_llevar/domicilio); formas-pago CRUD; GET; anulación |
| **pedidos** | 10 | POST comanda→201; add items; cambiar estado cocina (cocinero); cobrar→crea venta; solicitar/anular (password aprobador); GET cola/listar |
| **turnos-caja** | 10 | abrir turno→201; GET activo; movimientos egreso/ingreso (autorización); arqueo; cerrar (valida faltante); propina pago/listar |
| **resumenes** | 5 | GET contable/por-categoria/total/ultima-fecha; asignar/clasificar comprobante |
| **gastos** | 3 | GET resumen/por-categoria/total (con resumenes:ver) |
| **roles** | 6 | catálogo + catálogo-árbol (GUI); crear/actualizar/eliminar rol; mapear permisos |
| **escaneo** | 2 | previsualizar (subir imagen>bbox); confirmar (guarda+crea registro) |

---

## Hoja de ruta propuesta (poco a poco, en orden de valor)

Cada bloque se añade copiando el patrón de `raw()`/`psql()` ya existente, con
su `check()`. Se valida en `:test` y se pasa 22→N antes de commit.

### Fase 1 — auth completo & estados (rápido, alto valor)
- [ ] register→verify→estado pendiente→aprobar→login
- [ ] refresh (cookie) y logout (revoca session) — devuelven access nuevo / 200
- [ ] forgot-password → reset-password (con el token del correo)
- [ ] cambiar-contraseña (auto-grant, cualquier aprobado)
- [ ] tokens de servicio: generar (superadmin) → usar → revocar

### Fase 2 — CRUD facturas & comprobantes (el core contable)
- [ ] POST /facturas válido → 201 (proveedor, fecha, numero, total, items)
- [ ] GET /facturas (con filtros) → 200 lista
- [ ] POST duplicado (mismo numero+fecha) → 409 ya_existia
- [ ] PUT /facturas/:id → 200 edita
- [ ] DELETE → soft-delete: no aparece en GET, fila persiste
- [ ] POST /comprobantes válido → 201; dedup → 409; PUT; soft-delete

### Fase 3 — Caja & pedidos & ventas (el POS)
- [ ] caja: abrir turno → GET activo → egreso/ingreso → arqueo → cerrar
- [ ] pedidos: POST comanda → avanza cocina (cocinero) → cobrar → se crea venta
- [ ] ventas: POST escenario → GET; formas-pago CRUD; anulación con permiso

### Fase 4 — Resúmenes, gastos, roles, carta admin
- [ ] resumenes: GET por período devuelve totales+items+kpis
- [ ] gastos: GET agregados (con resumenes:ver)
- [ ] roles: catálogo-árbol devuelve el árbol de 3 niveles
- [ ] carta admin: crear categoría+item → aparece en GET /carta público

### Fase 5 — Escaneo & permisos finos por rol
- [ ] escaneo: previsualizar + confirmar (crea factura desde imagen)
- [ ] usuario admin SIN un permiso → 403 (deny fino, no solo cocinero)

---

## Reglas del juego
- **Antes de bumpear/desplegar → correr la suite.** Si algo nuevo del código no
  está en la suite, añadir SU check primero.
- Cada `check()` llama a la API real contra `:test` (nginx→backend).
- Datos temporales (usuarios, facturas de prueba) → crear con `psql()` y limpiar.
- Respetar el rate-limit de login (429 → backoff, no marcar como fallo).
- Al terminar cada fase, bumpear SOLO si hubo deploy (backend+frontend, mismo nº)
  y volver a correr la suite completa.

## Cómo correr
```
cd /opt/data/proyectos/fiumicello/backend
./e2e/run-smoke.sh          # usa fiumicello-backend
```
Exit 0 = todo pasa. Exit 1 = hay fallos (los lista).