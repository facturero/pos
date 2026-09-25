# Uso: install.sh [--admin-api-base URL] [--country-code CC]
# Aprovisiona el equipo (capa del SO) y baja la primera versión de la capa de
# aplicación con el actualizador. Idempotente: repetirlo no regenera secretos,
# no vuelve a descargar Node ni re-salta migraciones.
#
#  - usuario system `facturero`
#  - Node fijado en /opt/facturero/runtime/node-<v> (de nodejs.org, con SHA256
#    verificado contra SHASUMS256.txt — no se usa el node de apt, que cambia)
#  - MySQL local solo en 127.0.0.1, base pos_db, usuario facturero con
#    contraseña aleatoria (solo vive en /etc/facturero/pos.env)
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
while [[ $# -gt 0 ]]; do
  case "$1" in
    --admin-api-base) ADMIN_API_BASE="${2:?}"; shift 2 ;;
    --country-code)   COUNTRY_CODE="${2:?}"; shift 2 ;;
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

log "paquetes base (MySQL, firewall, runtime de la ventana, actualizaciones)"
apt-get update -y
apt-get install -y --no-install-recommends \
  mysql-server sudo ufw curl ca-certificates openssl tar xz-utils \
  unattended-upgrades \
  libwebkit2gtk-4.1-0 libgtk-3-0 libayatana-appindicator3-1 librsvg2-common \
  libsoup-3.0-0 libjavascriptcoregtk-4.1-0

# --- usuario facturero -------------------------------------------------------

if ! id -u "$FACTURERO_USER" &>/dev/null; then
  log "usuario $FACTURERO_USER"
  useradd --system --create-home --home-dir "/home/$FACTURERO_USER" \
    --shell /usr/sbin/nologin "$FACTURERO_USER"
fi

# --- Node fijado -------------------------------------------------------------

mkdir -p "$RUNTIME"
if [[ ! -x "$NODE_BIN" ]]; then
  log "descargando Node $NODE_VERSION (verificando SHA256)..."
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' RETURN
  curl -fsSL -o "$tmp/$NODE_TARBALL" "$NODE_URL"
  curl -fsSL -o "$tmp/SHASUMS256.txt" "$NODE_SHASUM_URL"
  # la línea del tarball termina con la ruta exacta del archivo a validar
  ( cd "$tmp" && grep -F " $NODE_TARBALL$" SHASUMS256.txt | sha256sum -c --ignore-missing )
  tar -C "$RUNTIME" -xJf "$tmp/$NODE_TARBALL"
  "$NODE_BIN" --version >/dev/null
else
  log "Node ya instalado en $NODE_DIR"
fi

# --- MySQL (solo 127.0.0.1) --------------------------------------------------

log "MySQL local"
systemctl enable --now mysql.service
mysqladmin ping --silent || die "MySQL no respondio"

# drop-in fija el bind-address de forma idempotente. mysqld.cnf trae por
# defecto 127.0.0.1, pero lo dejamos explícito para que no dependa de ello.
install -d /etc/mysql/mysql.conf.d
if [[ ! -f /etc/mysql/mysql.conf.d/facturero.cnf ]]; then
  cat > /etc/mysql/mysql.conf.d/facturero.cnf <<'EOF'
[mysqld]
bind-address = 127.0.0.1
EOF
  systemctl restart mysql.service
fi

# --- secretos y pos.env ------------------------------------------------------

mkdir -p "$ETC"
chmod 700 "$ETC"

if [[ -f "$ETC/pos.env" ]]; then
  # no regenerar secretos: la contraseña y JWT_SEcret viven SOLO en pos.env
  DB_PASS="$(sed -n 's|^DATABASE_URL=mysql://facturero:\([^@]*\)@127.0.0.1:3306/pos_db$|\1|p' "$ETC/pos.env")"
  [[ -n "$DB_PASS" ]] || die "pos.env existe pero no trae DATABASE_URL; revísalo a mano"
else
  DB_PASS="$(openssl rand -hex 24)"
  JWT_SECRET="$(openssl rand -hex 32)"
fi

DB_EXISTS="$(mysql -N -s -e "SELECT COUNT(*) FROM mysql.user WHERE user='facturero' AND host='127.0.0.1'")"
mysql -e "CREATE DATABASE IF NOT EXISTS pos_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
if [[ "$DB_EXISTS" == "0" ]]; then
  mysql -e "CREATE USER 'facturero'@'127.0.0.1' IDENTIFIED BY '${DB_PASS}'"
else
  # realinea la contraseña por si un arranque anterior quedó a medias
  mysql -e "ALTER USER 'facturero'@'127.0.0.1' IDENTIFIED BY '${DB_PASS}'"
fi
mysql -e "GRANT ALL PRIVILEGES ON pos_db.* TO 'facturero'@'127.0.0.1'"
mysql -e "FLUSH PRIVILEGES"

if [[ ! -f "$ETC/pos.env" ]]; then
  umask 077
  cat > "$ETC/pos.env" <<EOF
NODE_ENV=production
PORT=4000
DATABASE_URL=mysql://facturero:${DB_PASS}@127.0.0.1:3306/pos_db
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
chown -R "$FACTURERO_USER:$FACTURERO_USER" "$FACTURERO_APP" "$DATA"

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
systemctl enable mysql.service facturero-backend.service facturero-updater.timer

# --- primera versión de la capa de aplicación --------------------------------

CURRENT="$(readlink -f "$FACTURERO_APP/current" 2>/dev/null || true)"
if [[ -z "$CURRENT" ]]; then
  log "primera instalación de la capa de aplicación (actualizador)..."
  # se dispara por systemd y no con `su`: el servicio aporta EnvironmentFile=pos.env
  systemctl start facturero-updater.service
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
ufw --force enable

log "LISTO — panel en http://127.0.0.1:4000 ; /health responde $(curl -fsS "$HEALTH_URL")"