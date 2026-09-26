#!/usr/bin/env bash
# Corre UNA SOLA VEZ en el primer arranque tras la instalación desatendida.
# Lo invoca facturero-firstboot.service (compared por late-commands).
#  1) lee los parámetros que dejó autoinstall.yaml
#  2) provisiona el equipo (install.sh: Node fijado, unidades, ufw,
#     primera actualización de la capa de aplicación)
#  3) activa el modo kiosco (setup-kiosk.sh)
#  4) se desactiva a sí mismo y reinicia (para entrar a la sesión X)
set -euo pipefail

OS_DIR=/opt/facturero/os-src
PARAMS=/etc/facturero/install-params.env
LOG=/var/log/facturero-firstboot.log

exec > >(tee -a "$LOG") 2>&1
# Pantalla de marca durante la provision (sin texto de consola); Alt+F1 muestra el detalle. No debe fallar.
sh "$OS_DIR/iso/brand.sh" "Configurando el equipo, esto puede tardar unos minutos..." || true
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

. "$OS_DIR/installer-ui/progress.sh"
bash "$OS_DIR/provision/install.sh" "${ADMIN_ARGS[@]}" "${SSH_ARGS[@]}"
progress 7
bash "$OS_DIR/kiosk/setup-kiosk.sh"
progress 8

: > /opt/facturero/OS-FIRSTBOOT-DONE
# OJO: `disable --now` PARABA esta misma unidad (y con ella este script, SIGTERM) antes de llegar al
# reboot: el equipo se quedaba sin reiniciar. Solo se deshabilita; el reboot la termina.
systemctl disable facturero-firstboot.service
# fin: la pantalla muestra 'Listo' unos segundos, se cierra y el reinicio entra al kiosco
progress_done
sleep 6
bash "$OS_DIR/installer-ui/run.sh" stop || true
echo "== primer arranque terminado; reiniciando al kiosco =="
systemctl reboot