# Multi-stage build for NestJS backend
# Stage 1: install deps + build
FROM node:22 AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

# Stage 2: production runtime (lightweight)
FROM node:22 AS runtime
WORKDIR /app
ENV NODE_ENV=production
# pg_dump para el snapshot de BD por cambio de versión (SnapshotService).
# DEBE coincidir con la versión del servidor (postgres:16) — pg_dump aborta si
# la client version difiere del server (15 vs 16 = "server version mismatch").
# Se instala postgresql-client-16 desde el repo PGDG (el de Debian bookworm es 15).
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl ca-certificates gnupg \
 && install -d /usr/share/postgresql-common/pgdg \
 && curl -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc --fail https://www.postgresql.org/media/keys/ACCC4CF8.asc \
 && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" > /etc/apt/sources.list.d/pgdg.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends postgresql-client-16 \
 && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci --only=production --no-audit --no-fund
COPY --from=build /app/dist ./dist
EXPOSE 3000
CMD ["node", "dist/main"]