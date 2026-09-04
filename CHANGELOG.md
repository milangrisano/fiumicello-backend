# Changelog — Fiumicello Backend

All notable changes to the fiumicello backend. Format follows [Keep a Changelog](https://keepachangelog.com/).
Dates are UTC.

## [Unreleased]

### Added (2026-09-04)
- **JWT authentication & roles** (`src/auth/`):
  - `usuarios` entity (username, bcrypt `password_hash`, `rol`: `admin`|`editor`).
  - Passport `JwtStrategy`, global `JwtAuthGuard` + `RolesGuard` (via `APP_GUARD`).
  - Decorators: `@Roles(...)`, `@CurrentUser()`, `@Public()`.
  - `POST /api/auth/login` (`@Public`) issues a JWT.
  - Seed of initial users (`admin`/`enrique`, `editor`/`herb`) from env on first boot.
- **Write CRUD** (previously read-only):
  - `POST /api/facturas` — creates invoice header + items in a transaction.
  - `PUT /api/facturas/:id`, `DELETE /api/facturas/:id`.
  - `POST /api/comprobantes`, `PUT /api/comprobantes/:id`, `DELETE /api/comprobantes/:id`.
  - DTOs with `class-validator`.
- **Deduplication**: duplicate invoices/comprobantes rejected with **HTTP 409**
  (factura = `numero_factura`+`proveedor`+`fecha`; comprobante = `referencia`+`total`).
- **Global validation** pipe (whitelist + transform) in `main.ts`.

### Changed (2026-09-04)
- App module registered `Usuario` entity and `AuthModule`; global guards enabled.
- `DELETE` restricted to **admin** role (editor gets 403).

### Fixed (2026-09-04)
- PostgreSQL sequences re-synced to `max(id)` after the SQLite→Postgres migration
  (prevented `duplicate key` on new inserts).

---

## How to deploy
- Push to `main` triggers GitHub Actions → builds + pushes `milangrisano/fiumicello-backend` to Docker Hub.
- `docker compose -f docker-compose.prod.yml up -d` (backend pulls the image).