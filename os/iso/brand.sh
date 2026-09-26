#!/bin/sh
# Pantalla de marca: fondo claro y el nombre en el centro, en una consola virtual LIMPIA a la que se cambia
# para que no se vea el texto de la instalacion ni del primer arranque (ese texto sigue saliendo en la consola 1;
# quien instala puede verlo con Alt+F1 si algo falla).
#
#   sh brand.sh "Instalando el sistema..."      # segunda linea opcional (estado)
#
# Se usa desde autoinstall.yaml (early-commands, dentro del instalador vivo) y desde firstboot.sh. Es POSIX sh
# a proposito: en el instalador vivo no hay bash extra ni herramientas de desarrollo. Cualquier fallo se
# ignora: la marca es cosmetica y nunca debe impedir instalar.
#
# La consola de Linux solo tiene 16 colores y su "blanco" es un gris (#ccc): se REDEFINEN tres entradas de la
# paleta de esta consola (ESC ] P n rrggbb) para usar los colores de la marca: fondo casi blanco (7), azul (4)
# para el nombre y gris azulado (8) para el estado. Para cambiarlos, edita los tres valores hexadecimales
# (o pasa BRAND_BG / BRAND_NAME / BRAND_STATUS).
NAME="noahsolutions.com"
STATUS="${1:-}"
TTY_N="${BRAND_TTY:-9}"   # 9: systemd solo abre login (getty) en las consolas 1-6; en la 3 el login tapaba la marca
DEV="${BRAND_DEV:-/dev/tty${TTY_N}}"   # BRAND_DEV: solo para pruebas (un archivo en vez de la consola)
BG_HEX="${BRAND_BG:-f8f9fe}"
NAME_HEX="${BRAND_NAME:-0057ff}"
STATUS_HEX="${BRAND_STATUS:-7d859c}"

[ -c "$DEV" ] || [ -n "$BRAND_DEV" ] || exit 0

size="$(stty size < "$DEV" 2>/dev/null)" || size=""
rows="${size%% *}"; cols="${size##* }"
[ -n "$rows" ] && [ "$rows" -gt 0 ] 2>/dev/null || rows=25
[ -n "$cols" ] && [ "$cols" -gt 0 ] 2>/dev/null || cols=80

# centra un texto en la fila $1
center() {
  text="$2"
  col=$(( (cols - ${#text}) / 2 + 1 ))
  [ "$col" -ge 1 ] || col=1
  printf '\033[%d;%dH%s' "$1" "$col" "$text" >> "$DEV"
}

# paleta de la marca, cursor oculto, fondo (color 7) + texto azul (4), y limpiar (rellena con el fondo activo)
printf '\033]P7%s\033]P4%s\033]P8%s' "$BG_HEX" "$NAME_HEX" "$STATUS_HEX" >> "$DEV"
printf '\033[?25l\033[47;34m\033[2J' >> "$DEV"
mid=$(( rows / 2 ))
printf '\033[1;34m' >> "$DEV"      # el nombre en azul y negrita
center "$mid" "$NAME"
printf '\033[22;90m' >> "$DEV"     # el estado en gris (color 8); sin "0;": eso volvia al fondo negro
[ -n "$STATUS" ] && center $(( mid + 2 )) "$STATUS"

command -v chvt >/dev/null 2>&1 && chvt "$TTY_N" 2>/dev/null
exit 0
