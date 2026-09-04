# Changelog — Fiumicello Backend

All notable changes to the fiumicello backend. Format follows [Keep a Changelog](https://keepachangelog.com/).
Dates are UTC.

## [Unreleased]

### Added (2026-09-04)
- **Registration with email verification code**:
  - `POST /api/auth/register` (send 6-digit code to email), `POST /api/auth/verify`
    (validate code + set password, bcrypt). User = email (unique).
  - `EmailService` abstract contract + `EmailServiceSimulado` (logs code; active) and
    `EmailServiceReal` (future SMTP). Protocol fixed; swap without other changes.
- **Password recovery**: `POST /api/auth/forgot-password`, `POST /api/auth/reset-password`.
- **Service tokens (agent/superadmin)**:
  - `POST/GET/DELETE /api/auth/servicios` (superadmin) — generate service token (shown once,
    stored as hash), list, revoke.
  - Auth guard accepts JWT (humans) **or** service API token (e.g. `herb`).
- **Admin approval**: `GET /api/auth/usuarios/pendientes`, `POST /api/auth/usuarios/:id/aprobar`.
- **Roles**: added `superadmin` (highest); `admin`; `editor`. DELETE on facturas/comprobantes
  now allows `superadmin` and `admin`.

### Changed (2026-09-04)
- `usuarios` schema: `email` primary identity, `rol` incl. `superadmin`, `estado`
  (`pendiente`/`aprobado`/`desactivado`), `email_verified`, `codigo_*`, `reset_token*`,
  `api_token_hash`, `nombre_servicio`. `username` removed (migrated to `email`).
- Login uses email + password; rejects pending/disabled accounts.
- `listPendientes` no longer returns password hashes.

### Fixed (2026-09-04)
- PostgreSQL sequences re-synced to `max(id)` after migration.
- Superadmin could not DELETE (roles fixed).

---

## How to deploy
- Push to `main` triggers GitHub Actions → builds + pushes `milangrisano/fiumicello-backend` to Docker Hub.
- `docker compose -f docker-compose.prod.yml up -d` (backend pulls the image).