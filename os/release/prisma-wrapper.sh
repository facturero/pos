#!/bin/sh
# Sustituye a node_modules/.bin/prisma DENTRO del paquete de la app (lo instala build-release.sh).
# Para todo lo que no sea `migrate deploy` es transparente (exec directo a la CLI real).
#
# Por qué existe: el actualizador instalado en la caja es de la capa del sistema operativo y NO se
# actualiza con la app, pero ejecuta `./node_modules/.bin/prisma migrate deploy` DESDE la versión nueva
# — o sea, este archivo viaja en cada release. Con la base en modo WAL (lo que dejaban las versiones
# <= 0.3.4), `migrate deploy` falla SIEMPRE con "database is locked" mientras el backend esté vivo
# (CHANGELOG 2026-10-04), y el actualizador viejo ni reintenta ni sabe parar el backend: la caja se
# quedaba atascada sin remedio salvo ir con SSH, imposible en un producto multi-organización.
#
# Qué hace en `migrate deploy`:
#   1. corre la CLI real; si sale bien, listo (caso normal, y el de las cajas con el actualizador nuevo,
#      que ya paró el backend antes)
#   2. si falla con "database is locked" (la CLI ya esperó ~10 s por el bloqueo, así que no es momentáneo):
#      TERMINA el backend de esta instalación (mismo
#      usuario, no hace falta sudo) y vuelve a intentar. systemd lo relanza solo (Restart=always) y el
#      actualizador lo reinicia con la versión nueva justo después; el nuevo backend deja la base en
#      modo DELETE y las siguientes actualizaciones ya no necesitan este truco.
#   3. cualquier otro error se devuelve tal cual, sin tocar nada.
# Solo mata procesos de ESTE usuario cuyo directorio actual cuelga de $FACTURERO_ROOT (/opt/facturero) y
# cuya línea de comando contiene dist/index.js: nunca el propio actualizador ni otros programas.
DIR=$(cd "$(dirname "$0")" && pwd)
REAL="$DIR/../prisma/build/index.js"

if [ "${1:-}" != "migrate" ] || [ "${2:-}" != "deploy" ]; then
  exec node "$REAL" "$@"
fi

# Compuerta de actualización (update-gate.mjs, junto a package.json): espera a que sea buen momento
# (caja cerrada / pantalla ociosa) ANTES de tocar la base. Así, aunque el actualizador viejo de la caja
# aplique en cuanto termina de descargar, la versión nueva solo se activa cuando no estorba. Es un extra:
# si no está o falla, se migra igual.
GATE="$DIR/../../update-gate.mjs"
if [ -f "$GATE" ]; then node "$GATE" || true; fi

ROOT="${FACTURERO_ROOT:-/opt/facturero}"
OUT=$(mktemp)
trap 'rm -f "$OUT"' EXIT

stop_backend() {
  me=$(id -u)
  for p in /proc/[0-9]*; do
    pid=${p#/proc/}
    [ "$(stat -c %u "$p" 2>/dev/null)" = "$me" ] || continue
    cwd=$(readlink "$p/cwd" 2>/dev/null) || continue
    case "$cwd" in "$ROOT"/*) ;; *) continue ;; esac
    tr '\0' ' ' <"$p/cmdline" 2>/dev/null | grep -q 'dist/index\.js' || continue
    echo "[prisma] la base está bloqueada por el backend en marcha (PID $pid); lo detengo para migrar" >&2
    kill "$pid" 2>/dev/null
  done
}

attempt=0
while :; do
  guard=""
  if [ "$attempt" -ge 1 ]; then
    # Matarlo UNA vez no basta: systemd lo relanza a los 3 s (Restart=always), justo cuando el
    # schema-engine conecta, y le gana la carrera (probado 2026-10-05: 6 intentos, 6 fallos). Mientras
    # dure este intento, un vigilante vuelve a matarlo cada medio segundo si reaparece.
    stop_backend
    ( while :; do sleep 0.5; stop_backend; done ) &
    guard=$!
  fi
  node "$REAL" "$@" >"$OUT" 2>&1
  code=$?
  if [ -n "$guard" ]; then kill "$guard" 2>/dev/null; wait "$guard" 2>/dev/null; fi
  cat "$OUT"
  [ "$code" -eq 0 ] && exit 0
  grep -q "database is locked" "$OUT" || exit "$code"
  attempt=$((attempt + 1))
  [ "$attempt" -ge 9 ] && exit "$code"
  sleep 2
done
