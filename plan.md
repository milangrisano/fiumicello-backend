# Fiumicello Backend — Development Plan (Trace / Roadmap)

> **Permanent rule: ALL code must be written in ENGLISH. No Spanish in code.**
> User-facing messages may be in Spanish where appropriate (API error text).

---

## 1. Project overview

**Fiumicello** backend is a **NestJS + TypeORM** REST API backed by **PostgreSQL**
(previously SQLite `payment_vouchers.db`, which now lives only as a historical backup).
Its job: serve the restaurant's accounting data (supplier invoices, invoice items, payment
vouchers) securely, and allow authenticated clients (the Flutter frontend and the `herb`
agent) to **read and write** via a CRUD API with **role-based access**.

- **Stack:** NestJS, TypeORM, PostgreSQL (`pg`), JWT (`@nestjs/jwt`, `passport-jwt`), bcrypt.
- **Database:** PostgreSQL in Docker (volume `pgdata`), creds in `/opt/data/proyectos/fiumicello/.env` (protected, out of git).
- **DB tables:** `facturas`, `facturas_items`, `comprobantes_pago`, `usuarios`.
- **CI/CD:** GitHub Actions (`ci.yml`) builds and pushes `milangrisano/fiumicello-backend` to Docker Hub on push to `main`.

---

## 2. Authentication & roles

### Mechanism (NestJS idiomatic)
- **JWT + Passport**: `JwtModule`, `JwtStrategy`, `JwtAuthGuard` (global via `APP_GUARD`).
- **Roles**: `@Roles('admin')` decorator + `RolesGuard` (global, after JwtAuthGuard) enforcing per-route roles.
- **`@Public()`** decorator marks routes that bypass auth (currently only `POST /api/auth/login`).
- **`@CurrentUser()`** injects the authenticated user `{ id, username, rol }` into handlers.

### Roles
| Role | Capabilities |
|---|---|
| `admin` | everything (CRUD read/write + **DELETE**) |
| `editor` | CRUD read/write (**no DELETE** → 403) |

- Seed: initial users created from env on first boot (`ADMIN_USERNAME/ADMIN_PASSWORD`,
  `EDITOR_USERNAME/EDITOR_PASSWORD` in `.env`). Passwords hashed with bcrypt.

---

## 3. Endpoints

### Auth
- `POST /api/auth/login` (`@Public`) → `{ access_token, user }`

### Facturas (invoices)
| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/api/facturas` | any | filters: desde/hasta/proveedor/estado/metodo/monto, pagination |
| GET | `/api/facturas/:id` | any | |
| GET | `/api/facturas/:id/items` | any | header + items |
| POST | `/api/facturas` | any | **transaction**: creates header + items; dedupe → **409** |
| PUT | `/api/facturas/:id` | any | update (replaces items if provided) |
| DELETE | `/api/facturas/:id` | **admin only** | |

### Comprobantes (payment vouchers)
| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/api/comprobantes` | any | filters, pagination |
| GET | `/api/comprobantes/:id` | any | |
| POST | `/api/comprobantes` | any | dedupe → **409** |
| PUT | `/api/comprobantes/:id` | any | |
| DELETE | `/api/comprobantes/:id` | **admin only** | |

### Gastos (summaries)
- `GET /api/gastos/resumen?agrupar=`, `GET /api/gastos/por-categoria`, `GET /api/gastos/total`

### Health
- `GET /api/health`

---

## 4. Deduplication rules (important for intake)

The backend rejects duplicates with **HTTP 409 Conflict** so that a document arriving by
**two paths** (e.g. a scanned physical invoice AND the same one downloaded from email/Drive)
does not get recorded twice.

| Entity | Duplicate key |
|---|---|
| `factura` | `numero_factura` + `proveedor` + `fecha` |
| `comprobante` | `referencia` + `total_con_impuestos` |

The `herb` agent relies on this: on `409` it reports "already exists" and never reinserts.

---

## 5. Environment variables (`.env`, protected)

Postgres connection (`POSTGRES_DB/USER/PASSWORD`, `DB_HOST/PORT/NAME/USER/PASS`) and auth
(`JWT_SECRET`, `JWT_EXPIRES_IN`, `ADMIN_*`, `EDITOR_*`). All kept in `.env`, gitignored.
**Never committed.**

---

## 6. Deployment

- `docker compose -f docker-compose.prod.yml` runs `db` (postgres) + `backend` + `frontend`.
- Backend container name: `fiumicello-backend` (reachable by service name on `fiumicello_default`).
- The `hermes` (herb) container is connected to `fiumicello_default` so it reaches the API
  as `http://fiumicello-backend:3000/api`.
- Images pulled from Docker Hub (`milangrisano/fiumicello-backend:latest`).

## 7. Notes / trace

- SQLite data migrated to PostgreSQL (119 facturas / 286 items / 15 comprobantes); sequences
  were re-synced (`setval` to max(id)) after migration.
- Auth + write CRUD added 2026-09-04; DELETE restricted to `admin` per decision with Enrique.