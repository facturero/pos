#!/usr/bin/env bash
# Reinicia la app completa tras una actualización: backend Y ventana del kiosco. Lo invoca el
# actualizador (os/updater/updater.mjs, restartCmd) vía sudo; sudoers (install.sh) da permiso
# NOPASSWD a este script exacto y nada más.
#
# Por qué también la ventana: el kiosco (Tauri, os/kiosk/launch.sh) carga index.html UNA sola vez
# al arrancar la sesión X. Si solo se reinicia el backend, la ventana se queda con los nombres de
# archivo .js de la build anterior (Vite les pone hash) y al navegar tras el login pide un asset
# que ya no existe (404) — encontrado 2026-09-30 al pasar una VM real de 0.3.2 a 0.3.3 a mano.
# No hace falta tocar systemd para la ventana: launch.sh ya la relanza sola en cuanto el proceso
# muere, así que basta con matarla; para entonces el backend nuevo ya está sirviendo /health.
set -euo pipefail

systemctl restart facturero-backend || systemctl start facturero-backend
pkill -f facturero-pos-app || true
