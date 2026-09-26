#!/bin/sh
# Lo lanza autoinstall.yaml (early-commands) dentro del instalador vivo: abre la pantalla de instalación.
#  1) brand.sh: pantalla simple con la marca (funciona siempre, sin Python)
#  2) install-tui.py: pantalla dividida (pasos a la izquierda, comandos en vivo a la derecha) que se pinta ENCIMA
#     si hay python3; recibe los eventos de subiquity por el webhook de autoinstall.yaml (127.0.0.1:8765)
# Cosmético: cualquier fallo se ignora.
DIR="$(cd "$(dirname "$0")" && pwd)"
sh "$DIR/brand.sh" "Instalando el sistema..." || true
if command -v python3 >/dev/null 2>&1 && [ -f "$DIR/install-tui.py" ]; then
  setsid -f python3 "$DIR/install-tui.py" >/dev/null 2>&1 < /dev/null
fi
exit 0
