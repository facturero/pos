# Progreso del primer arranque: lo escribe install.sh/firstboot.sh y lo lee os/installer-ui/server.py.
# Formato del archivo (una linea por evento):  step <n> <epoch con milisegundos> | done <epoch con milisegundos> | error <epoch con milisegundos> <texto>
# `progress 1` empieza de cero (un reintento de firstboot.service vuelve a pasar por el paso 1).
PROGRESS_FILE="${INSTALLER_PROGRESS:-/var/lib/facturero/install-progress}"
progress() { mkdir -p "$(dirname "$PROGRESS_FILE")"; if [ "$1" = 1 ]; then : > "$PROGRESS_FILE"; fi; echo "step $1 $(date +%s.%3N)" >> "$PROGRESS_FILE"; }
progress_done() { echo "done $(date +%s.%3N)" >> "$PROGRESS_FILE"; }
progress_error() { echo "error $(date +%s.%3N) $*" >> "$PROGRESS_FILE" 2>/dev/null || true; }
