#!/usr/bin/env bash
# Lleva patch-updater.sh y sus archivos a UNA caja instalada por SSH y lo ejecuta (con sudo).
# Se corre desde el equipo de servicio, no en la caja. Solo funciona en cajas con SSH habilitado
# (instaladas con install.sh --allow-ssh-from <red de administración>).
#
#   patch-box.sh <usuario@host> [-p puerto] [-i clave_privada]
#
# Ejemplo (VM de pruebas con reenvío de puerto):
#   os/provision/patch-box.sh taller@127.0.0.1 -p 2222 -i ~/facturero-keys/tecnico_ed25519
#
# Varias cajas: repetir el comando por cada una. No reinicia el backend ni la ventana: el parche
# solo cambia el actualizador y su permiso; surte efecto en la próxima corrida del actualizador.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OS_DIR="$(cd "$HERE/.." && pwd)"
TARGET="${1:?uso: patch-box.sh <usuario@host> [-p puerto] [-i clave]}"; shift
PORT=22; KEY=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    -p) PORT="${2:?}"; shift 2 ;;
    -i) KEY="${2:?}"; shift 2 ;;
    *) echo "argumento desconocido: $1" >&2; exit 2 ;;
  esac
done

SSH_OPTS=(-o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new)
[[ -n "$KEY" ]] && SSH_OPTS+=(-i "$KEY")

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
cp "$OS_DIR/updater/updater.mjs" "$OS_DIR/provision/restart-app.sh" \
   "$OS_DIR/provision/units/facturero-updater.timer" "$OS_DIR/provision/patch-updater.sh" "$STAGE/"

REMOTE="/tmp/facturero-patch-$$"
echo "[patch-box] copiando a $TARGET:$REMOTE"
ssh "${SSH_OPTS[@]}" -p "$PORT" "$TARGET" "mkdir -p $REMOTE"
scp "${SSH_OPTS[@]}" -P "$PORT" -q "$STAGE"/* "$TARGET:$REMOTE/"

echo "[patch-box] aplicando"
status=0
ssh "${SSH_OPTS[@]}" -p "$PORT" "$TARGET" "sudo bash $REMOTE/patch-updater.sh $REMOTE" || status=$?
ssh "${SSH_OPTS[@]}" -p "$PORT" "$TARGET" "rm -rf $REMOTE" || true
exit "$status"
