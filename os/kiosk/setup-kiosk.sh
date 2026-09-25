#!/usr/bin/env bash
# Activa el modo kiosco (idempotente, corre como root tras install.sh):
#   - autologin de $KIOSK_USER (por defecto facturero) en tty1 vía agetty
#   - tty2..6 y los objetivos de apagado/suspensión/ctrl-alt-del, enmascarados
#   - login de consola → startx → openbox-session (escritorio vacío, sin menús)
#   - autostart de openbox: source de /etc/facturero/kiosk.env + launch.sh
# Opciones para servicio técnico (sin contraseñas fijas — nunca):
#   - /etc/facturero/kiosk.env : KIOSK_APP_BIN, KIOSK_HIDE_CURSOR, KIOSK_OS_DIR
#   - SSH con clave SOLO de una red de administración: install.sh --allow-ssh-from
set -euo pipefail

die() { printf '\033[1;31m[kiosk] ERROR:\033[0m %s\n' "$*" >&2; exit 1; }
[[ "$(id -u)" -eq 0 ]] || die "corre como root"

OS_DIR=${KIOSK_OS_DIR:-/opt/facturero/os-src}
KIOSK_USER=${KIOSK_USER:-facturero}
HOME_DIR="$(getent passwd "$KIOSK_USER" | cut -d: -f6)"
[[ -d "$HOME_DIR" ]] || die "el usuario $KIOSK_USER no existe o no tiene home"

# --- autologin en tty1 --------------------------------------------------------
# agetty --autologin lanza login(1) sin pedir contraseña; sin la override de
# ExecStart systemd usaría la línea por defecto de getty@.service
install -d /etc/systemd/system/getty@tty1.service.d
cat > /etc/systemd/system/getty@tty1.service.d/autologin.conf <<EOF
[Service]
ExecStart=
ExecStart=-/sbin/agetty --autologin ${KIOSK_USER} --noclear %I \$TERM
EOF

# --- sin TTY alternativos ni atajos de consola --------------------------------
for u in 2 3 4 5 6; do
  systemctl mask "getty@tty${u}.service" 2>/dev/null || true
done
systemctl mask ctrl-alt-del.target sleep.target suspend.target \
  hibernate.target hybrid-sleep.target 2>/dev/null || true
systemctl set-default multi-user.target

# --- login → X → openbox -------------------------------------------------------
# .bash_profile: arranca X solo en el tty de consola (tty1); Ctrl+Alt+F* en un
# tty enmascarado no muestra nada (los getty no existen)
mkdir -p "$HOME_DIR/.config/openbox"
cat > "$HOME_DIR/.bash_profile" <<EOF
[[ -z "\$DISPLAY" && "\${XDG_VTNR:-}" == "1" ]] && exec startx
EOF
cat > "$HOME_DIR/.xinitrc" <<EOF
exec openbox-session
EOF
install -m 0644 "$OS_DIR/kiosk/rc.xml" "$HOME_DIR/.config/openbox/rc.xml"
cat > "$HOME_DIR/.config/openbox/autostart" <<EOF
if [ -r /etc/facturero/kiosk.env ]; then . /etc/facturero/kiosk.env; fi
$OS_DIR/kiosk/launch.sh &
EOF
chown -R "$KIOSK_USER:$KIOSK_USER" "$HOME_DIR"

systemctl daemon-reload
log() { printf '\033[1;32m[kiosk]\033[0m %s\n' "$*"; }
log "kiosco activo para $KIOSK_USER (OS_DIR=$OS_DIR); reinicia para entrar"