#!/usr/bin/env bash
# Corre UNA SOLA VEZ en el primer arranque tras la instalación desatendida.
# Lo invoca facturero-firstboot.service (compared por late-commands).
#  1) lee los parámetros que dejó autoinstall.yaml
#  2) provisiona el equipo (install.sh: MySQL, Node fijado, unidades, ufw,
#     primera actualización de la capa de aplicación)
#  3) activa el modo kiosco (setup-kiosk.sh)
#  4) se desactiva a sí mismo y reinicia (para entrar a la sesión X)
set -euo pipefail

OS_DIR=/opt/facturero/os-src
PARAMS=/etc/facturero/install-params.env
LOG=/var/log/facturero-firstboot.log

exec > >(tee -a "$LOG") 2>&1
printf '== primer arranque %s ==\n' "$(date '+%F %T')"

[[ -d "$OS_DIR/provision" ]] || {
  echo "ERROR: no está /opt/facturero/os-src (¿llegó la ISO?)" >&2
  exit 1
}
if [[ -f "$PARAMS" ]]; then . "$PARAMS"; fi

ADMIN_ARGS=()
[[ -n "${ADMIN_API_BASE_URL:-}" ]] && ADMIN_ARGS+=(--admin-api-base "$ADMIN_API_BASE_URL")
SSH_ARGS=()
[[ -n "${SSH_ALLOW_FROM:-}" ]] && SSH_ARGS+=(--allow-ssh-from "$SSH_ALLOW_FROM")

bash "$OS_DIR/provision/install.sh" "${ADMIN_ARGS[@]}" "${SSH_ARGS[@]}"
bash "$OS_DIR/kiosk/setup-kiosk.sh"

: > /opt/facturero/OS-FIRSTBOOT-DONE
systemctl disable --now facturero-firstboot.service
echo "== primer arranque terminado; reiniciando al kiosco =="
systemctl reboot