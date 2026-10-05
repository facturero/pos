#!/usr/bin/env bash
# Corre la prueba de integración de usuarios/roles/permisos (test/users-access.e2e.test.ts) en Linux dentro de Docker.
#
# Por qué en Docker: es el mismo entorno que compila las releases (node:22-bookworm-slim), y argon2 trae binario nativo
# que en algunas máquinas Windows bloquea el control de aplicaciones. No toca tu node_modules ni tu base de datos: copia
# el backend a un directorio del contenedor, instala, aplica las migraciones REALES a una base temporal y corre las pruebas.
#
#   bash backend/test/run-e2e.sh
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# En Git Bash de Windows, docker necesita la ruta como C:/… y sin conversión automática de MSYS.
if command -v cygpath >/dev/null 2>&1; then host="$(cygpath -m "$here")"; else host="$here"; fi

MSYS_NO_PATHCONV=1 docker run --rm -v "${host}:/src:ro" node:22-bookworm-slim bash -c '
  set -e
  apt-get update -qq >/dev/null && apt-get install -y -qq openssl >/dev/null
  mkdir /work && cd /src && tar cf - --exclude=node_modules --exclude=dist --exclude=data --exclude="*.db" . | tar xf - -C /work
  cd /work
  npm ci --no-audit --no-fund --loglevel=error
  npx prisma generate >/dev/null
  npx tsx --test test/*.e2e.test.ts
'
