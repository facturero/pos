# Uso: install.sh [--admin-api-base URL] [--country-code CC] [--allow-ssh-from CIDR]
# Aprovisiona el equipo (capa del SO) y baja la primera versión de la capa de
# aplicación con el actualizador. Idempotente: repetirlo no regenera secretos,
# no vuelve a descargar Node ni re-salta migraciones.
#
#  - usuario system `facturero`
#  - Node fijado en /opt/facturero/runtime/node-<v> (de nodejs.org, con SHA256
#    verificado contra SHASUMS256.txt — no se usa el node de apt, que cambia)
#  - base de datos SQLite (/var/lib/facturero/pos.db): un archivo, sin servidor ni contraseña
#  - /etc/facturero/pos.env: DATABASE_URL, JWT_SECRET, PORT, rutas de la pantalla
#    e imágenes; ADMIN_API_BASE_URL solo se escribe si se pasa --admin-api-base
#    (sin valor por defecto: si falta, el backend convive sin gateway, como se
#    ve en los logs "ADMIN_API_BASE_URL no configurado")
#  - unidades systemd: backend (Restart=always) y actualizador (oneshot + timer
#    cada hora con retraso aleatorio), más sudoers mínima para que el
#    actualizador reinicie el backend sin contraseña
#  - ufw: todo lo entrante denegado, solo salida (regla 5 del diseño)
#  - primera versión de la app: `systemctl start facturero-updater.service`
#    (no `su`: la unidad hace EnvironmentFile=pos.env, que es lo que necesita
#    `prisma migrate deploy`)
set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

log() { printf '\033[1;34m[install]\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m[install] ERROR:\033[0m %s\n' "$*" >&2; exit 1; }

[[ "$(id -u)" -eq 0 ]] || die "corre como root (sudo bash os/provision/install.sh)"
export DEBIAN_FRONTEND=noninteractive

ADMIN_API_BASE=""
COUNTRY_CODE="EC"
ALLOW_SSH_FROM=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --admin-api-base) ADMIN_API_BASE="${2:?}"; shift 2 ;;
    --country-code)   COUNTRY_CODE="${2:?}"; shift 2 ;;
    --allow-ssh-from) ALLOW_SSH_FROM="${2:?}"; shift 2 ;;
    *) die "argumento desconocido: $1" ;;
  esac
done

FACTURERO_USER="facturero"
FACTURERO_APP="/opt/facturero"
RUNTIME="$FACTURERO_APP/runtime"
UPDATE_CLI="$FACTURERO_APP/update-cli"
ETC="/etc/facturero"
DATA="/var/lib/facturero/product-images"
NODE_VERSION="22.14.0"
NODE_DIR="$RUNTIME/node-$NODE_VERSION"
NODE_BIN="$NODE_DIR/bin/node"
NODE_TARBALL="node-v${NODE_VERSION}-linux-x64.tar.xz"
NODE_URL="https://nodejs.org/dist/v${NODE_VERSION}/${NODE_TARBALL}"
NODE_SHASUM_URL="https://nodejs.org/dist/v${NODE_VERSION}/SHASUMS256.txt"
HEALTH_URL="http://127.0.0.1:4000/health"

# --- paquetes del sistema ----------------------------------------------------

log "paquetes base (firewall, runtime de la ventana, escritorio kiosco)"
apt-get update -y
apt-get install -y --no-install-recommends \
  sqlite3 sudo ufw curl ca-certificates openssl tar xz-utils \
  unattended-upgrades \
  libwebkit2gtk-4.1-0 libgtk-3-0 libayatana-appindicator3-1 librsvg2-common \
  libsoup-3.0-0 libjavascriptcoregtk-4.1-0 \
  xorg xinit x11-xserver-utils openbox

# --- usuario facturero -------------------------------------------------------

if ! id -u "$FACTURERO_USER" &>/dev/null; then
  log "usuario $FACTURERO_USER"
  # bash (y no nologin) porque también es el usuario del kiosco: agetty hace
  # autologin en tty1 y .bash_profile ejecuta startx (fase 5)
  useradd --system --create-home --home-dir "/home/$FACTURERO_USER" \
    --shell /bin/bash "$FACTURERO_USER"
fi

# --- Node fijado -------------------------------------------------------------

mkdir -p "$RUNTIME"
if [[ ! -x "$NODE_BIN" ]]; then
  log "descargando Node $NODE_VERSION (verificando SHA256)..."
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' RETURN
  curl -fsSL -o "$tmp/$NODE_TARBALL" "$NODE_URL"
  curl -fsSL -o "$tmp/SHASUMS256.txt" "$NODE_SHASUM_URL"
  # SHASUMS256.txt: "<sha256>  <archivo>". La linea EXACTA del tarball se saca con awk: el
  # `grep -F " $NODE_TARBALL$"` anterior no entendia el `$` final, no encontraba nada y
  # sha256sum fallaba con "no properly formatted checksum lines".
  line="$(awk -v f="$NODE_TARBALL" '$2==f' "$tmp/SHASUMS256.txt")"
  [[ -n "$line" ]] || die "SHASUMS256.txt no trae $NODE_TARBALL"
  ( cd "$tmp" && echo "$line" | sha256sum -c - )
  # el tarball trae node-v<ver>-linux-x64/: se aplana en node-<ver> (que es lo que esperan
  # NODE_DIR y las unidades systemd; sin esto "bin/node: No such file or directory")
  rm -rf "$NODE_DIR"; mkdir -p "$NODE_DIR"
  tar -C "$NODE_DIR" --strip-components=1 -xJf "$tmp/$NODE_TARBALL"
  "$NODE_BIN" --version >/dev/null
else
  log "Node ya instalado en $NODE_DIR"
fi

# --- base de datos: SQLite --------------------------------------------------
# Un archivo (/var/lib/facturero/pos.db), sin servidor: la crea "prisma migrate deploy" al instalar la primera
# version y la abre el backend (usuario facturero). No hay contraseña de base de datos ni puerto que proteger.
DB_DIR="/var/lib/facturero"
mkdir -p "$DB_DIR"

# --- secretos y pos.env ------------------------------------------------------

mkdir -p "$ETC"
# root:facturero 750: el actualizador corre como `facturero` y tiene que poder entrar a leer
# updater.json y la clave pública (con 700 fallaba con EACCES). Los secretos siguen protegidos:
# pos.env es 600 root y lo lee systemd (EnvironmentFile), no el proceso.
chown root:"$FACTURERO_USER" "$ETC"
chmod 750 "$ETC"

# no regenerar secretos: el JWT_SECRET vive SOLO en pos.env
if [[ ! -f "$ETC/pos.env" ]]; then
  JWT_SECRET="$(openssl rand -hex 32)"
fi

if [[ ! -f "$ETC/pos.env" ]]; then
  umask 077
  cat > "$ETC/pos.env" <<EOF
NODE_ENV=production
PORT=4000
# connection_limit=1: SQLite admite un escritor a la vez; una sola conexion evita 'database is locked'
DATABASE_URL=file:${DB_DIR}/pos.db?connection_limit=1
JWT_SECRET=${JWT_SECRET}
POS_FRONTEND_DIST=${FACTURERO_APP}/current/frontend/dist
POS_IMAGES_DIR=${DATA}
EOF
  if [[ -n "$ADMIN_API_BASE" ]]; then
    echo "ADMIN_API_BASE_URL=${ADMIN_API_BASE}" >> "$ETC/pos.env"
  fi
  echo "POS_COUNTRY_CODE=${COUNTRY_CODE}" >> "$ETC/pos.env"
  chmod 600 "$ETC/pos.env"
else
  # rellena solo lo que falte; nunca toca DATABASE_URL ni JWT_SECRET
  grep -qx "ADMIN_API_BASE_URL=${ADMIN_API_BASE}" "$ETC/pos.env" || \
    { [[ -n "$ADMIN_API_BASE" ]] && echo "ADMIN_API_BASE_URL=${ADMIN_API_BASE}" >> "$ETC/pos.env"; }
  grep -qx "POS_COUNTRY_CODE=${COUNTRY_CODE}" "$ETC/pos.env" || \
    echo "POS_COUNTRY_CODE=${COUNTRY_CODE}" >> "$ETC/pos.env"
fi

# --- datos y actualizador -----------------------------------------------------

mkdir -p "$DATA" "$FACTURERO_APP/releases"
chown -R "$FACTURERO_USER:$FACTURERO_USER" "$FACTURERO_APP" "$DATA" "$DB_DIR"
chmod 750 "$DB_DIR"

install -d "$UPDATE_CLI"
install -m 0644 "$SRC/updater/updater.mjs" "$SRC/updater/cli.mjs" "$UPDATE_CLI/"
# la pública NO es secreto (regla 2); la privada jamás vive en el equipo
install -m 0644 "$SRC/release/release-public.pem" "$ETC/release-public.pem"

SYSTEMCTL_BIN="$(command -v systemctl)"
# updater.json es plantilla: __SYSTEMCTL__ debe coincidir con la ruta de la
# regla de sudoers (sudo exige el path exacto, no el nombre a secas)
sed "s|__SYSTEMCTL__|${SYSTEMCTL_BIN}|g" "$SRC/provision/updater.json" \
  > /tmp/updater.json.$$
install -m 0640 -o root -g "$FACTURERO_USER" /tmp/updater.json.$$ "$ETC/updater.json"
rm -f /tmp/updater.json.$$

# --- ventana del kiosco (Tauri) ---------------------------------------------------
# Forma parte de la imagen del SO (casi no cambia): la compila os/window/build-window.sh y viaja en la
# ISO dentro de os/window/out/. Sin ella el kiosco arranca X pero la pantalla queda negra.
WINDOW_BIN="$SRC/window/out/facturero-pos-app"
if [[ -f "$WINDOW_BIN" ]]; then
  install -D -m 0755 "$WINDOW_BIN" "$FACTURERO_APP/app/facturero-pos-app"
  log "ventana instalada en $FACTURERO_APP/app/facturero-pos-app"
else
  log "AVISO: no hay binario de la ventana ($WINDOW_BIN); el kiosco no mostrara nada (os/window/build-window.sh)"
fi

# --- unidades systemd ----------------------------------------------------------

log "unidades systemd"
install -m 0644 "$SRC/provision/units/facturero-backend.service" \
                  "$SRC/provision/units/facturero-updater.service" \
                  "$SRC/provision/units/facturero-updater.timer" /etc/systemd/system/
sed -i "s|__NODE_DIR__|${NODE_DIR}|g" \
  /etc/systemd/system/facturero-backend.service \
  /etc/systemd/system/facturero-updater.service

# sudoers mínima: el actualizador (user facturero) reinicia el backend sin clave
printf '%s ALL=(root) NOPASSWD: %s restart facturero-backend, %s start facturero-backend\n' \
  "$FACTURERO_USER" "$SYSTEMCTL_BIN" "$SYSTEMCTL_BIN" > /etc/sudoers.d/facturero-updater
chmod 440 /etc/sudoers.d/facturero-updater

systemctl daemon-reload
systemctl enable facturero-backend.service facturero-updater.timer

# --- primera versión de la capa de aplicación --------------------------------

# OJO: `readlink -f` sobre una ruta que no existe devuelve la propia ruta (no vacío), asi que
# "hay versión activa" se decide con -L (enlace existente), no con la salida de readlink.
CURRENT=""
[[ -L "$FACTURERO_APP/current" ]] && CURRENT="$(readlink -f "$FACTURERO_APP/current")"
if [[ -z "$CURRENT" ]]; then
  log "primera instalación de la capa de aplicación (actualizador)..."
  # se dispara por systemd y no con `su`: el servicio aporta EnvironmentFile=pos.env
  # Sin red todavia (o el servidor de actualizaciones no responde) la primera descarga falla: se reintenta
  # en vez de dejar el equipo sin aplicacion (el cliente no tiene a quien pedirle que lo repita).
  tries=0
  until systemctl start facturero-updater.service; do
    tries=$((tries + 1))
    [[ $tries -ge 40 ]] && die "no se pudo bajar la primera version tras $tries intentos (¿hay red?)"
    log "no se pudo bajar la aplicacion (¿sin red?); reintento en 15 s ($tries/40)"
    sleep 15
  done
  tries=0
  until curl -fsS "$HEALTH_URL" >/dev/null 2>&1; do
    tries=$((tries + 1)); [[ $tries -gt 90 ]] && die "el backend no respondio en 3 min"
    sleep 2
  done
  log "versión activa: $(readlink "$FACTURERO_APP/current")"
else
  log "ya hay una versión activa: $CURRENT (no vuelvo a instalar)"
  systemctl start facturero-backend.service
fi
systemctl start facturero-updater.timer
systemctl enable --now unattended-upgrades

# --- cortafuegos ---------------------------------------------------------------

log "cortafuegos (regla 5: solo salida)"
ufw default deny incoming
ufw default allow outgoing
if [[ -n "$ALLOW_SSH_FROM" ]]; then
  # SSH de administración SOLO desde la red tallerista (nunca desde 0.0.0.0):
  # sin contraseña fija, solo claves. Regla real dedupable por ufw.
  ufw allow from "$ALLOW_SSH_FROM" to any port 22 proto tcp
fi
ufw --force enable

# Si el backend no responde, la instalación NO está lista: fallar aquí evita que firstboot.sh
# se marque como terminado (y desactive) con un equipo sin aplicación.
HEALTH_BODY="$(curl -fsS "$HEALTH_URL")" || die "el backend no responde en $HEALTH_URL"
log "LISTO — panel en http://127.0.0.1:4000 ; /health responde $HEALTH_BODY"