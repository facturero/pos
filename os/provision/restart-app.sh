#!/usr/bin/env bash
# Control de la app para el actualizador (os/updater/updater.mjs). Lo invoca vía sudo; sudoers
# (install.sh) da permiso NOPASSWD a este script exacto y nada más.
#
#   restart-app.sh        reinicia backend Y ventana del kiosco (restartCmd)
#   restart-app.sh stop   solo para el backend (stopCmd, justo antes de migrar)
#
# stop: con el backend encendido, `prisma migrate deploy` falla siempre con "database is locked"
# (verificado 2026-10-04), así que el actualizador lo para, migra, y restartCmd lo levanta.
#
# Por qué restart también mata la ventana: el kiosco (Tauri, os/kiosk/launch.sh) carga index.html
# UNA sola vez al arrancar la sesión X. Si solo se reinicia el backend, la ventana se queda con los
# nombres de archivo .js de la build anterior (Vite les pone hash) y al navegar tras el login pide
# un asset que ya no existe (404) — encontrado 2026-09-30 al pasar una VM real de 0.3.2 a 0.3.3 a
# mano. No hace falta tocar systemd para la ventana: launch.sh ya la relanza sola en cuanto el
# proceso muere, así que basta con matarla; para entonces el backend nuevo ya está sirviendo /health.
set -euo pipefail

case "${1:-restart}" in
  stop)
    systemctl stop facturero-backend
    ;;
  restart)
    systemctl restart facturero-backend || systemctl start facturero-backend
    pkill -f facturero-pos-app || true
    ;;
  *)
    echo "uso: restart-app.sh [restart|stop]" >&2
    exit 2
    ;;
esac
