#!/usr/bin/env bash
# Remasteriza la ISO de Ubuntu Server 24.04 LTS para instalar el Facturero de
# forma desatendida. Corre en una máquina Ubuntu/Linux (en la de desarrollo es
# Windows y no se ejecuta aquí; se prueba por contenedor).
# Requiere xorriso (en Ubuntu: sudo apt-get install -y xorriso).
#
#   ./build-iso.sh ubuntu-24.04.X-live-server-amd64.iso [WORK] [OUT]
#
# Parámetros de la instalación (sin valores en el repo):
#   ADMIN_API_BASE_URL   gateway del CRM (sin default; producción es el de api.noahsolution.com)
#   SSH_ALLOW_FROM       CIDR de la red de administración (vacío = sin SSH)
#   SSH_AUTHORIZED_KEY   clave pública del técnico (obligatoria)
#   HOSTNAME_OS          hostname (por defecto facturero-pos)
#   MANIFEST_URL         dónde consulta actualizaciones (por defecto GitHub Releases de facturero/pos)
#   RELEASE_PUBLIC_KEY   clave pública de firma (por defecto la de os/release/)
set -euo pipefail

die() { echo "ERROR: $*" >&2; exit 1; }
command -v xorriso >/dev/null || die "falta xorriso (sudo apt-get install -y xorriso)"

ISO=${1:?uso: build-iso.sh <ubuntu-24.04.X-live-server-amd64.iso> [WORK] [OUT]}
WORK=${2:-/tmp/facturero-iso}
OUT=${3:-facturero-pos-autoinstall.iso}
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

[[ -f "$ISO" ]] || die "no existe: $ISO"

HOSTNAME=${HOSTNAME_OS:-facturero-pos}
ADMIN_API_BASE_URL=${ADMIN_API_BASE_URL:-}
SSH_ALLOW_FROM=${SSH_ALLOW_FROM:-}
SSH_AUTHORIZED_KEY=${SSH_AUTHORIZED_KEY:-}
[[ -n "$SSH_AUTHORIZED_KEY" ]] || die "falta SSH_AUTHORIZED_KEY (clave pública del técnico)"
# Repositorio de actualizaciones que llevará la ISO. Para pruebas sin publicar
# nada, apuntar a un servidor local (p. ej. MANIFEST_URL=http://host:PORT/latest.json)
# con un paquete firmado por la misma clave pública que se inyecta abajo.
DEFAULT_MANIFEST_URL=https://github.com/facturero/pos/releases/latest/download/latest.json
MANIFEST_URL=${MANIFEST_URL:-$DEFAULT_MANIFEST_URL}
# Clave PÚBLICA a incorporar al equipo (si se omite, la del repo os/release/).
RELEASE_PUBLIC_KEY=${RELEASE_PUBLIC_KEY:-}

echo "== preparando lo que se añade a la ISO =="
rm -rf "$WORK/iso"; mkdir -p "$WORK/iso/boot/grub"
# El árbol pos-os viaja en la ISO (instalador, actualizador, kiosco, clave pública).
cp -ra "$SRC" "$WORK/iso/pos-os"

echo "== sustituyendo placeholders en autoinstall.yaml e iso-params.env =="
sed -e "s|__HOSTNAME__|${HOSTNAME}|" \
    -e "s|__SSH_PUB_KEY__|${SSH_AUTHORIZED_KEY}|" \
    "$SRC/iso/autoinstall.yaml" > "$WORK/iso/autoinstall.yaml"
sed -e "s|__ADMIN_API_BASE__|${ADMIN_API_BASE_URL}|" \
    -e "s|__SSH_ALLOW_FROM__|${SSH_ALLOW_FROM}|" \
    -e "s|__SSH_AUTHORIZED_KEY__|${SSH_AUTHORIZED_KEY}|" \
    "$SRC/iso/iso-params.example" > "$WORK/iso/iso-params.env"

echo "== parametrizando MANIFEST_URL y la clave pública del equipo =="
if [[ "$MANIFEST_URL" != "$DEFAULT_MANIFEST_URL" ]]; then
  sed -i "s|${DEFAULT_MANIFEST_URL}|${MANIFEST_URL}|" "$WORK/iso/pos-os/provision/updater.json"
fi
if [[ -n "$RELEASE_PUBLIC_KEY" ]]; then
  [[ -f "$RELEASE_PUBLIC_KEY" ]] || die "no existe la clave pública: $RELEASE_PUBLIC_KEY"
  cp -f "$RELEASE_PUBLIC_KEY" "$WORK/iso/pos-os/release/release-public.pem"
fi
[[ -f "$WORK/iso/pos-os/release/release-public.pem" ]] || die "falta la clave pública (RELEASE_PUBLIC_KEY o os/release/release-public.pem)"

echo "== inyectando la entrada de grub (BIOS y EFI usan el mismo grub.cfg) =="
xorriso -osirrox on -indev "$ISO" -extract /boot/grub/grub.cfg "$WORK/iso/boot/grub/grub.cfg" >/dev/null 2>&1
chmod u+rw "$WORK/iso/boot/grub/grub.cfg"
cat >> "$WORK/iso/boot/grub/grub.cfg" <<'EOF'

menuentry "Instalar Facturero (desatendida) — autoinstall" --id facturero-auto {
    linux /casper/vmlinuz autoinstall ds=nocloud\;s=/cdrom/ quiet ---
    initrd /casper/initrd
}
EOF
# La entrada por defecto se elige por ID, NO por índice: parte de las entradas del grub.cfg original
# están dentro de `if` (EFI o BIOS) y el índice cambia según la plataforma; un índice fuera de rango
# cae en la entrada 0 (instalación normal, que pide confirmación). La instalación arranca sola a los 5 s.
cat >> "$WORK/iso/boot/grub/grub.cfg" <<EOF

set default=facturero-auto
set timeout=5
EOF

# Se reescribe la ISO base con "-boot_image any replay": xorriso conserva EXACTAMENTE el arranque
# original (MBR de grub, El Torito BIOS y la partición EFI añadida al final). En las ISOs de
# 24.04.x el EFI ya no es un archivo boot/grub/efi.img como antes, así que reconstruir con
# "mkisofs -e boot/grub/efi.img" falla ("Cannot find path").
echo "== escribiendo la ISO ($OUT) =="
rm -f "$OUT"
xorriso -indev "$ISO" -outdev "$OUT" -boot_image any replay \
  -map "$WORK/iso/pos-os" /pos-os \
  -map "$WORK/iso/autoinstall.yaml" /autoinstall.yaml \
  -map "$WORK/iso/iso-params.env" /iso-params.env \
  -map "$WORK/iso/boot/grub/grub.cfg" /boot/grub/grub.cfg \
  -commit

echo "== lista: $OUT =="
echo "Pruébala primero en VirtualBox: arranque -> instalación desatendida ->"
echo "primer arranque (provisión + kiosco) -> reinicio al kiosco."
