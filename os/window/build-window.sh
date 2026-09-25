#!/usr/bin/env bash
# Compila la ventana del POS (Tauri) en un contenedor Ubuntu 24.04 y deja el binario en
# os/window/out/facturero-pos-app. install.sh lo instala en /opt/facturero/app/ (la ventana forma parte de
# la imagen del sistema operativo y casi no cambia; la app se actualiza con os/updater).
#
#   os/window/build-window.sh
#
# Tarda: la primera vez baja Rust y compila Tauri (decenas de minutos); Docker cachea las capas, asi que
# repetirlo sin tocar src-tauri es rapido.
set -euo pipefail

# `pwd -W` (solo Git Bash en Windows) da la ruta C:/... que docker.exe entiende; en Linux cae en pwd.
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && { pwd -W 2>/dev/null || pwd; })"
REPO="$(cd "$HERE/../.." && { pwd -W 2>/dev/null || pwd; })"
IMAGE=facturero-window

command -v docker >/dev/null || { echo "ERROR: falta docker" >&2; exit 1; }
export MSYS_NO_PATHCONV=1   # Git Bash en Windows no debe convertir las rutas

docker build -t "$IMAGE" -f "$HERE/Dockerfile" "$REPO"
mkdir -p "$HERE/out"
cid="$(docker create "$IMAGE")"
trap 'docker rm -f "$cid" >/dev/null 2>&1 || true' EXIT
docker cp "$cid:/out/facturero-pos-app" "$HERE/out/facturero-pos-app"
chmod +x "$HERE/out/facturero-pos-app"
ls -la "$HERE/out/facturero-pos-app"
