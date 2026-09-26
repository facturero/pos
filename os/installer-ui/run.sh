#!/usr/bin/env bash
# Abre / cierra la pantalla de instalación del primer arranque (a pantalla completa):
#   run.sh start    servidor local (server.py, :4080) + Xorg + openbox + la ventana Tauri apuntando a él
#   run.sh stop     lo cierra todo (firstboot.sh lo llama antes del reinicio al kiosco)
#
# Corre como root desde install.sh. La ventana la ejecuta el usuario `facturero`. Todo es cosmético: cualquier
# fallo devuelve 1 y quien llama lo ignora; la instalación no depende de esta pantalla.
# Xorg arranca con -ac (sin control de acceso) y -nolisten tcp: solo lo alcanzan procesos locales y dura los
# minutos de la instalación; el kiosco definitivo usa startx del usuario (ver os/kiosk).
set -u

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
USER_NAME="${KIOSK_USER:-facturero}"
WINDOW="${KIOSK_APP_BIN:-/opt/facturero/app/facturero-pos-app}"
PORT="${INSTALLER_PORT:-4080}"
VT="${INSTALLER_VT:-9}"
RUN=/run/facturero-installer-ui
LOG=/var/log/facturero-installer-ui.log

stop() {
  for f in window openbox xorg server; do
    [[ -f "$RUN/$f.pid" ]] && kill "$(cat "$RUN/$f.pid")" 2>/dev/null
  done
  sleep 1
  rm -rf "$RUN"
  command -v chvt >/dev/null 2>&1 && chvt 1 2>/dev/null
  return 0
}

start() {
  command -v python3 >/dev/null 2>&1 || { echo "falta python3" >> "$LOG"; return 1; }
  command -v Xorg >/dev/null 2>&1 || { echo "falta Xorg" >> "$LOG"; return 1; }
  [[ -x "$WINDOW" ]] || { echo "falta la ventana $WINDOW" >> "$LOG"; return 1; }
  mkdir -p "$RUN"

  INSTALLER_PORT="$PORT" nohup python3 "$HERE/server.py" >> "$LOG" 2>&1 &
  echo $! > "$RUN/server.pid"

  nohup Xorg :0 "vt$VT" -nolisten tcp -ac -noreset >> "$LOG" 2>&1 &
  echo $! > "$RUN/xorg.pid"
  for _ in $(seq 1 30); do [[ -S /tmp/.X11-unix/X0 ]] && break; sleep 1; done
  [[ -S /tmp/.X11-unix/X0 ]] || { echo "Xorg no arrancó" >> "$LOG"; stop; return 1; }

  export DISPLAY=:0
  # gestor de ventanas: sin él Tauri no pasa a pantalla completa
  nohup openbox >> "$LOG" 2>&1 &
  echo $! > "$RUN/openbox.pid"

  local xdg="/tmp/runtime-$USER_NAME"
  mkdir -p "$xdg"; chown "$USER_NAME:$USER_NAME" "$xdg"; chmod 700 "$xdg"
  # la ventana, como el usuario del kiosco (no como root), abriendo la pantalla de progreso y no el POS
  nohup su -s /bin/sh "$USER_NAME" -c \
    "DISPLAY=:0 XDG_RUNTIME_DIR=$xdg POS_WINDOW_URL=http://127.0.0.1:$PORT exec $WINDOW" >> "$LOG" 2>&1 &
  echo $! > "$RUN/window.pid"
  return 0
}

case "${1:-}" in
  start) start ;;
  stop) stop ;;
  *) echo "uso: run.sh start|stop" >&2; exit 2 ;;
esac
