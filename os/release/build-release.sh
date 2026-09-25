#!/usr/bin/env bash
# Construye y firma una VERSIÓN de la capa de aplicación del POS dentro de un
# contenedor node:22-bookworm-slim y la firma con sign-release.mjs.
#
# Uso:
#   os/release/build-release.sh --version X.Y.Z --out <carpeta> \
#       [--key <release-private.pem>] \
#       [--url-base https://github.com/facturero/pos/releases/download/vX.Y.Z] \
#       [--smoke] [--stage <carpeta>]
#
# Sin --key solo arma el stage (idóneo para probar sin la clave privada, que
# no viaja en el repo). --smoke arranca el backend del stage dentro de un
# contenedor contra el MySQL del compose local (DATABASE_URL de backend/.env,
# sin imprimirla) y comprueba /health y que sirve la pantalla.
#
# Por qué en un contenedor Linux: el paquete debe llevar los motores nativos de
# Linux (argon2 y el query engine de Prisma para Debian/OpenSSL3, ver regla 3 de
# os/DISENO.md). No construimos en la máquina de desarrollo (Windows).
#
# Layout del paquete (root = /opt/facturero/current en el equipo instalado):
#   backend/dist, backend/package*.json, backend/node_modules (solo de
#   producción, con la CLI de prisma para el `migrate deploy` del actualizador),
#   backend/prisma (schema + migraciones), frontend/dist (la pantalla), VERSION.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
TAG="$$"

VERSION=""
OUT=""
KEY=""
URL_BASE=""
SMOKE=""
STAGE=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    --version) VERSION="$2"; shift 2 ;;
    --out) OUT="$2"; shift 2 ;;
    --key) KEY="$2"; shift 2 ;;
    --url-base) URL_BASE="$2"; shift 2 ;;
    --stage) STAGE="$2"; shift 2 ;;
    --smoke) SMOKE=1; shift ;;
    *) echo "argumento desconocido: $1" >&2; exit 2 ;;
  esac
done

if [ -z "$VERSION" ]; then echo "falta --version X.Y.Z" >&2; exit 2; fi
if [ -z "$OUT" ]; then echo "falta --out <carpeta de salida>" >&2; exit 2; fi
if [ -z "$URL_BASE" ]; then
  URL_BASE="https://github.com/facturero/pos/releases/download/v${VERSION}"
fi
if ! command -v docker >/dev/null; then echo "se necesita docker" >&2; exit 1; fi

STAGE="${STAGE:-$(mktemp -d "${TMPDIR:-/tmp}/pos-stage-XXXXXX")}"
mkdir -p "$OUT"
OUT="$(cd "$OUT" && pwd)"

if [ "$(uname -s)" = "Linux" ]; then
  REPO_HOST="$REPO_ROOT"; STAGE_HOST="$STAGE"
else
  # Git Bash: docker necesita rutas Windows y que no le conviertan "/stage".
  REPO_HOST="$(cygpath -w "$REPO_ROOT")"; STAGE_HOST="$(cygpath -w "$STAGE")"
fi
export MSYS_NO_PATHCONV=1

# El script interno va en un archivo montado: Git Bash (MSYS) no puede pasar
# stdin a docker.exe (proceso nativo y Windows) de forma fiable.
TMPD="$(mktemp -d "${TMPDIR:-/tmp}/pos-inner-XXXXXX")"
if [ "$(uname -s)" = "Linux" ]; then TMPD_HOST="$TMPD"; else TMPD_HOST="$(cygpath -w "$TMPD")"; fi
trap 'rm -rf "$TMPD"' EXIT

INNER=$(cat <<'EOF'
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
# openssl es imprescindible: node:*-slim no lo trae y Prisma, sin libssl,
# detectaría "openssl-1.1.x" y no encontraría el motor 3.0.x que llevamos.
apt-get install -y -qq --no-install-recommends python3 make g++ openssl >/dev/null

# --- backend (compila en el contenedor, nunca toca el node_modules de la dev) ---
mkdir -p /build/backend
tar -C /workspace/backend --exclude=node_modules --exclude=dist -cf - . | tar -C /build/backend -xf -
cd /build/backend
npm ci --no-audit --no-fund
npm run build
npm run prisma:generate
rm -rf node_modules
npm ci --omit=dev --no-audit --no-fund
# el actualizador corre `prisma migrate deploy` desde node_modules de producción
[ -x node_modules/.bin/prisma ] || { echo "FALTA la CLI de prisma en prod" >&2; exit 1; }

# --- frontend ---
mkdir -p /build/frontend
tar -C /workspace/frontend --exclude=node_modules --exclude=dist -cf - . | tar -C /build/frontend -xf -
cd /build/frontend
npm ci --no-audit --no-fund
npm run build

# --- ensamblar stage ---
rm -rf /stage/* /stage/.[!.]*
mkdir -p /stage/backend /stage/frontend
cp -r /build/backend/dist /stage/backend/dist
cp /build/backend/package.json /build/backend/package-lock.json /stage/backend/
cp -r /build/backend/node_modules /stage/backend/node_modules
cp -r /workspace/backend/prisma /stage/backend/prisma
cp -r /build/frontend/dist /stage/frontend/dist
# /health lee VERSION relativo a dist; sign-release lo escribe también en la raíz del stage
echo "$BUILD_VERSION" > /stage/VERSION
cp /stage/VERSION /stage/backend/dist/VERSION
echo "== stage listo =="
du -sh /stage
EOF
)
printf '%s\n' "$INNER" > "$TMPD/inner.sh"

echo "== Construyendo ${VERSION} (stage: ${STAGE}) =="
docker run --rm --name "pos-build-${TAG}" \
  -v "${REPO_HOST}:/workspace:ro" \
  -v "${STAGE_HOST}:/stage" \
  -v "${TMPD_HOST}:/inner:ro" \
  -e BUILD_VERSION="$VERSION" \
  node:22-bookworm-slim bash /inner/inner.sh

if [ -n "$KEY" ]; then
  echo "== Firmando =="
  # node (Windows) no entiende rutas POSIX (/c/[...] → C:\c\[...]). En Git Bash
  # `pwd` normaliza además el TEMP a /tmp/…, que Windows lee como C:\tmp: convertir.
  if [ "$(uname -s)" = "Linux" ]; then
    SIGN_SCRIPT="$SCRIPT_DIR/sign-release.mjs"
    NODE_STAGE="$STAGE"
    NODE_OUT="$OUT"
  else
    SIGN_SCRIPT="$(cygpath -w "$SCRIPT_DIR/sign-release.mjs")"
    NODE_STAGE="$(cygpath -w "$STAGE")"
    NODE_OUT="$(cygpath -w "$OUT")"
  fi
  node "$SIGN_SCRIPT" \
    --version "$VERSION" \
    --stage "$NODE_STAGE" \
    --out "$NODE_OUT" \
    --url-base "$URL_BASE" \
    --key "$KEY"
  echo "Tamaño del paquete: $(du -h "$OUT/facturero-pos-${VERSION}.tar.gz" | cut -f1)"
else
  echo "== Sin --key: no se firmó (stage en ${STAGE}) =="
fi

if [ -n "$SMOKE" ]; then
  # smoke: arranca el backend del stage contra el MySQL del compose local
  # (host.docker.internal), SIN publicar puertos: se prueba dentro del contenedor.
  if [ ! -f "$REPO_ROOT/backend/.env" ]; then
    echo "WARN: --smoke necesita backend/.env (DATABASE_URL) para el MySQL local; se omite" >&2
    exit 0
  fi
  DB_URL="$(sed -n 's/^DATABASE_URL=//p' "$REPO_ROOT/backend/.env" | head -n1 | tr -d '"')"
  if [ -z "$DB_URL" ]; then echo "WARN: backend/.env sin DATABASE_URL; se omite --smoke" >&2; exit 0; fi
  # dentro del contenedor el "localhost" del .env debe ser el host (no se imprime la URL)
  DB_URL_SMOKE="$(printf '%s' "$DB_URL" | sed -E 's#@(localhost|127\.0\.0\.1):#@host.docker.internal:#')"

  CTN="pos-smoke-${TAG}"
  docker rm -f "$CTN" >/dev/null 2>&1 || true
  # igual que en el build: sin openssl Prisma detectaría 1.1.x y no arrancaría
  docker run -d --name "$CTN" \
    -v "${STAGE_HOST}:/opt/current:ro" \
    -e DATABASE_URL="$DB_URL_SMOKE" \
    -e PORT=4000 \
    -e POS_FRONTEND_DIST=/opt/current/frontend/dist \
    node:22-bookworm-slim bash -c "apt-get update -qq >/dev/null && apt-get install -y -qq openssl >/dev/null && exec node /opt/current/backend/dist/index.js" >/dev/null
  trap 'docker rm -f "$CTN" >/dev/null 2>&1 || true' EXIT

  ok=false
  for _ in $(seq 1 40); do
    if docker exec "$CTN" node -e "fetch('http://127.0.0.1:4000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1; then
      ok=true; break
    fi
    sleep 2
  done
  if [ "$ok" != true ]; then echo "FALLO: /health no respondió 200 en el smoke" >&2; exit 1; fi
  echo "smoke /health:"
  docker exec "$CTN" node -e "fetch('http://127.0.0.1:4000/health').then(r=>r.json()).then(j=>{console.log(j);process.exit(j.status==='ok'&&j.version==='$VERSION'?0:1)})"
  echo "smoke GET / (primeros 60 chars del HTML):"
  docker exec "$CTN" node -e "fetch('http://127.0.0.1:4000/').then(r=>r.text()).then(t=>{console.log(t.slice(0,60));process.exit(t.includes('<div')?0:1)})"
fi

echo "== listo: $OUT =="