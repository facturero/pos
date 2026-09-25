#!/usr/bin/env bash
# Remasteriza la ISO de Ubuntu Server 24.04 LTS para instalar el Facturero de
# forma desatendida. Corre en una máquina Ubuntu/Linux del dueño (en la de
# desarrollo es Windows y no se ejecuta aquí). Requiere xorriso y la ISO base
# (la descarga la hace el dueño; la autorización la da él en el reporte).
#
#   ./build-iso.sh ubuntu-24.04.X-live-server-amd64.iso [WORK] [OUT]
#
# Parámetros de la instalación (sin valores en el repo):
#   ADMIN_API_BASE_URL   gateway del CRM (sin default; producción es el de api.noahsolution.com)
#   SSH_ALLOW_FROM       CIDR de la red de administración (vacío = sin SSH)
#   SSH_AUTHORIZED_KEY   clave pública del técnico (obligatoria)
#   HOSTNAME_OS          hostname (por defecto facturero-pos)
# Se pueden pasar como variables de entorno o dejarlas en iso/iso-params.example
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

echo "== extrayendo la ISO base =="
rm -rf "$WORK"; mkdir -p "$WORK/iso"
xorriso -osirrox on -indev "$ISO" -extract / "$WORK/iso" >/dev/null

echo "== copiando os/ a la ISO (pos-os) =="
cp -ra "$SRC" "$WORK/iso/pos-os"

echo "== sustituyendo placeholders en autoinstall.yaml e iso-params.env =="
sed -e "s|__HOSTNAME__|${HOSTNAME}|" \
    -e "s|__SSH_PUB_KEY__|${SSH_AUTHORIZED_KEY}|" \
    "$SRC/iso/autoinstall.yaml" > "$WORK/iso/autoinstall.yaml"
sed -e "s|__ADMIN_API_BASE__|${ADMIN_API_BASE_URL}|" \
    -e "s|__SSH_ALLOW_FROM__|${SSH_ALLOW_FROM}|" \
    -e "s|__SSH_AUTHORIZED_KEY__|${SSH_AUTHORIZED_KEY}|" \
    "$SRC/iso/iso-params.example" > "$WORK/iso/iso-params.env"

echo "== inyectando la entrada de grub (también vale para EFI: el grub EFI de
   la ISO hace configfile del mismo grub.cfg) =="
cat >> "$WORK/iso/boot/grub/grub.cfg" <<'EOF'

menuentry "Instalar Facturero (desatendida) — autoinstall" {
    linux /casper/vmlinuz autoinstall ds=nocloud\;s=/cdrom/ quiet ---
    initrd /casper/initrd
}
EOF

echo "== reconstruyendo la ISO ($OUT) =="
xorriso -as mkisofs -o "$OUT" \
  -V "Ubuntu 24.04 LTS FACTURERO" \
  -J -joliet-long -cache-inodes -iso-level 3 \
  -partition_offset 16 \
  -A "Ubuntu 24.04 LTS server autoinstall" \
  -b boot/grub/i386-pc/eltorito.img -c boot.catalog -no-emul-boot \
  -boot-load-size 4 -boot-info-table \
  -eltorito-alt-boot -e boot/grub/efi.img -no-emul-boot \
  -isohybrid-mbr /usr/lib/ISOLINUX/isohdpfx.bin \
  "$WORK/iso"

echo "== lista: $OUT =="
echo "Pruébala primero en VirtualBox: arranque -> instalación desatendida ->"
echo "primer arranque (provisión + kiosco) -> reinicio al kiosco."