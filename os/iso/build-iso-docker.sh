#!/usr/bin/env bash
# Construye la ISO del Facturero desde Windows (Git Bash) o Linux usando un contenedor Ubuntu 24.04 con
# xorriso: envuelve build-iso.sh. Es el camino normal del dueño; build-iso.sh a secas es para una máquina
# Linux con xorriso.
#
#   os/iso/build-iso-docker.sh --iso <ubuntu-24.04.X-live-server-amd64.iso> --out <carpeta> \
#       --admin-api-base https://api.ejemplo.com --ssh-key <clave-publica-tecnico.pub> \
#       [--public-key <release-public.pem>] [--manifest-url <url>] [--ssh-allow-from <CIDR>] [--hostname <nombre>]
#
# Antes: compilar la ventana (os/window/build-window.sh) para que el binario viaje en la ISO. Si falta se
# avisa: sin la ventana el kiosco muestra pantalla negra.
set -euo pipefail

die() { echo "ERROR: $*" >&2; exit 1; }
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && { pwd -W 2>/dev/null || pwd; })"
REPO="$(cd "$HERE/../.." && { pwd -W 2>/dev/null || pwd; })"
export MSYS_NO_PATHCONV=1

ISO=""; OUT=""; ADMIN=""; SSHKEY=""; PUBKEY=""; MANIFEST=""; ALLOW=""; HOST=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --iso) ISO="$2"; shift 2 ;;
    --out) OUT="$2"; shift 2 ;;
    --admin-api-base) ADMIN="$2"; shift 2 ;;
    --ssh-key) SSHKEY="$2"; shift 2 ;;
    --public-key) PUBKEY="$2"; shift 2 ;;
    --manifest-url) MANIFEST="$2"; shift 2 ;;
    --ssh-allow-from) ALLOW="$2"; shift 2 ;;
    --hostname) HOST="$2"; shift 2 ;;
    *) die "argumento desconocido: $1" ;;
  esac
done
[[ -f "$ISO" ]] || die "--iso: no existe el archivo"
[[ -n "$OUT" ]] || die "falta --out"
[[ -n "$ADMIN" ]] || die "falta --admin-api-base (URL del gateway del CRM; sin valor por defecto)"
[[ -f "$SSHKEY" ]] || die "--ssh-key: falta la clave pública del técnico"
mkdir -p "$OUT"

# ruta absoluta que docker entienda
abs() { local d; d="$(cd "$(dirname "$1")" && { pwd -W 2>/dev/null || pwd; })"; echo "$d/$(basename "$1")"; }
ISO_ABS="$(abs "$ISO")"; OUT_ABS="$(cd "$OUT" && { pwd -W 2>/dev/null || pwd; })"
[[ -f "$REPO/os/window/out/facturero-pos-app" || -f "$HERE/../window/out/facturero-pos-app" ]] || \
  echo "AVISO: no hay os/window/out/facturero-pos-app; la ISO instalará un kiosco sin ventana (ejecuta os/window/build-window.sh)" >&2

# la ISO base y la clave pública se montan de solo lectura; el trabajo va a un volumen de Docker (rápido)
args=(-e "SSH_AUTHORIZED_KEY=$(tr -d '\r\n' < "$SSHKEY")" -e "ADMIN_API_BASE_URL=$ADMIN" -e "SSH_ALLOW_FROM=$ALLOW")
[[ -n "$HOST" ]] && args+=(-e "HOSTNAME_OS=$HOST")
[[ -n "$MANIFEST" ]] && args+=(-e "MANIFEST_URL=$MANIFEST")
mounts=(-v "$REPO:/repo:ro" -v "$(dirname "$ISO_ABS"):/in:ro" -v "$OUT_ABS:/out")
if [[ -n "$PUBKEY" ]]; then
  [[ -f "$PUBKEY" ]] || die "--public-key: no existe"
  mounts+=(-v "$(dirname "$(abs "$PUBKEY")"):/keys:ro"); args+=(-e "RELEASE_PUBLIC_KEY=/keys/$(basename "$PUBKEY")")
fi

docker run --rm "${mounts[@]}" "${args[@]}" ubuntu:24.04 bash -c "
  set -euo pipefail
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq && apt-get install -y -qq xorriso >/dev/null
  bash /repo/os/iso/build-iso.sh /in/$(basename "$ISO_ABS") /tmp/work /out/facturero-pos-autoinstall.iso
  (cd /out && sha256sum facturero-pos-autoinstall.iso > facturero-pos-autoinstall.iso.sha256 && cat facturero-pos-autoinstall.iso.sha256)
"
echo "ISO: $OUT/facturero-pos-autoinstall.iso"
