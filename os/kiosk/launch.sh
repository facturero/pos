#!/usr/bin/env bash
# Kiosco: espera a que el backend esté sano y mantiene la ventana siempre viva.
# Lo ejecuta el autostart de Openbox (dentro de la sesión X del usuario).
# Opciones por env en /etc/facturero/kiosk.env (véase setup-kiosk.sh):
#   KIOSK_APP_BIN       binario de la ventana (por defecto /opt/facturero/app/facturero-pos-app)
#   KIOSK_HIDE_CURSOR   1 oculta el cursor (pantalla táctil)
#   KIOSK_OS_DIR        dónde vive el código del OS (para empty.xbm)
set -u

LOG=${KIOSK_LOG:-/home/facturero/kiosk.log}
OS_DIR=${KIOSK_OS_DIR:-/opt/facturero/os-src}
APP_BIN=${KIOSK_APP_BIN:-/opt/facturero/app/facturero-pos-app}
HEALTH=${KIOSK_HEALTH_URL:-http://127.0.0.1:4000/health}

log() { printf '%s %s\n' "$(date '+%F %T')" "$*" >> "$LOG"; }

mkdir -p "$(dirname "$LOG")"
log "esperando /health"
for _ in $(seq 1 90); do
  curl -fsS "$HEALTH" >/dev/null 2>&1 && break
  sleep 2
done
if ! curl -fsS "$HEALTH" >/dev/null 2>&1; then
  log "sin /health tras 3 min; no arranco la ventana"
  exit 1
fi

# sin salvapantallas ni suspensión en la sesión del kiosco
xset -dpms s off s blank >/dev/null 2>&1 || true
if [[ "${KIOSK_HIDE_CURSOR:-0}" == "1" ]]; then
  # cursor invisible: bitmap vacío 1x1 idéntico para forma y máscara
  xsetroot -cursor "$OS_DIR/kiosk/empty.xbm" "$OS_DIR/kiosk/empty.xbm" >/dev/null 2>&1 || true
fi

log "arrancando la ventana ($APP_BIN)"
while :; do
  "$APP_BIN" >> "$LOG" 2>&1
  code=$?
  log "la ventana terminó (código $code); relanzando en 2 s"
  sleep 2
done