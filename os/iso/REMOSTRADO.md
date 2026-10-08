# Remasterizado de la ISO de Ubuntu Server 24.04 (fase 6)

Para probar y distribuir el equipo se remasteriza la ISO oficial con
`autoinstall.yaml` (cloud-init de subiquity) embebido. **Estos pasos se ejecutan
en una máquina Ubuntu, no en el Windows de desarrollo.** Nada de esto corrió
hasta que el dueño autorice descargar la ISO y probar en VirtualBox.

## Qué necesita el dueño

1. **Descargar** `ubuntu-24.04.<X>-live-server-amd64.iso` (~2,7 GB; es la "Live Server", no la de escritorio).
2. Tener `xorriso` (y `curl`/`tar`) en esa máquina de trabajo.
3. Definir los **parámetros** sin commitarlos al repo:
   - `SSH_AUTHORIZED_KEY`: clave pública del técnico (login del usuario `taller` sin contraseña). **Opcional**: sin ella la ISO sale en **modo público** (ver el final de este archivo).
   - `SSH_ALLOW_FROM`: CIDR de la red de administración (vacío = ufw niega todo lo entrante, sin SSH).
   - `ADMIN_API_BASE_URL`: gateway del CRM. **Sin valor por defecto** (producción es `https://api.noahsolution.com`; no fijarlo sin confirmar con el dueño).
4. Ejecutar `os/iso/build-iso.sh`.

## Cómo lo hace build-iso.sh

1. `xorriso -osirrox on` extrae la ISO a un dir de trabajo.
2. Copia `os/` del repo a `iso/pos-os` (lleva instalador, actualizador, kiosco y su clave pública).
3. Sustituye los placeholders `__HOSTNAME__` / `__SSH_PUB_KEY__` de `autoinstall.yaml` y los de `iso-params.env`.
4. Añade una entrada de grub:
   `linux /casper/vmlinuz autoinstall ds=nocloud\;/s=/cdrom/ quiet ---`
   (el grub **EFI** de la ISO carga el MISMO `boot/grub/grub.cfg`, así que una sola edición cubre BIOS y UEFI).
5. Regenera la ISO con `xorriso -as mkisofs` (MBR híbrido isohybrid + El Torito BIOS `eltorito.img` + EFI `efi.img`), lista para grabar/arrancar.

## Qué hace autoinstall.yaml en la máquina objetivo

- `/` completo con LVM, teclado es, locale es_ES, red por DHCP (sin sección de red → el router asigna).
- Usuario **`taller`** sin contraseña de login; SSH server con `allow-pw=false` y la clave pública del parámetro. (El técnico entra con su clave desde la red de administración.)
- `late-commands`: copia `/cdrom/pos-os` → `/target/opt/facturero/os-src`, deja `iso-params.env` → `/etc/facturero/install-params.env` y habilita `facturero-firstboot.service`. **No** ejecuta `install.sh` dentro del chroot: `systemctl`/MySQL no corren bien allí.
- Primer arranque: `firstboot.sh` → `install.sh` (provisión + primera actualización) → `setup-kiosk.sh` (kiosco) → `systemctl reboot` → autologin en el kiosco.

## Limitaciones/notas

- La primera instalación exige red (baja Node y la capa de aplicación). Para
  sin-red habría que embeder ambas en la ISO (decisión abierta del diseño).
- `autoinstall.yaml` solo vale para Server 24.04 LTS (esquema subiquity 1).
- El reinicio "seco" al final del primer arranque es intencional (entra a X limpio).
- El equipo de prueba en VirtualBox debería usar bios/EFI según lo que venda el cliente; validar ambos.

## ISO pública (para clientes): sin acceso técnico

Si se construye **sin** `SSH_AUTHORIZED_KEY` (`build-iso-docker.sh` sin `--ssh-key`), la ISO sale en modo público: no instala servidor SSH, no crea el sudo sin contraseña de `taller` y no lleva ninguna clave nuestra; `SSH_ALLOW_FROM` se ignora. Se logra con los bloques `# @TECNICO-INICIO` / `# @TECNICO-FIN` de `autoinstall.yaml`, que `build-iso.sh` borra enteros en ese modo; además aborta si queda rastro (mira solo las líneas que no son comentario). La cuenta `taller` existe (subiquity exige una) pero con la contraseña bloqueada y sin forma de entrar.

Una ISO **con** clave sigue siendo la de siempre para instalaciones propias. La que se publica es la pública. La de pruebas lleva `SSH_ALLOW_FROM=10.0.2.0/24` (la red de VirtualBox) y la clave del técnico, y NO debe publicarse.

## Revisión de la marca de Ubuntu (2026-10-08)

La ISO es una versión **modificada** de Ubuntu Server 24.04 LTS. Canonical permite redistribuirla, pero no que se presente como Ubuntu ni como respaldada por ellos. Lo que ya cumple y lo que se cambió:

- **Pantallas que ve la persona:** el menú de arranque (`grub.cfg` propio, una sola entrada «Instalar POS KIOSKO»), la pantalla de instalación y la del primer arranque dicen «POS KIOSKO · un producto de noahsolutions». No sale el nombre ni el logo de Ubuntu (se sustituyó todo el menú de Ubuntu).
- **Cambiado:** la etiqueta del volumen de la ISO (lo que muestra el sistema al montarla) ahora es `POS_KIOSKO`; antes heredaba la de Canonical («Ubuntu-Server 24.04…»). Está en `build-iso.sh` (`-volid`). **No se ha vuelto a arrancar una ISO con este cambio**: antes de publicar la próxima, reconstruirla y probarla en la VM como siempre.
- **Atribución:** la página de descargas (`presentacion/`, `isoLegal` en `src/data/pos.ts`) dice que está basada en Ubuntu Server, que Ubuntu es marca de Canonical, que no es un producto suyo ni cuenta con su respaldo, y dónde está el código fuente (archive.ubuntu.com/ubuntu, launchpad.net).
- **No tocado a propósito:** el sistema instalado sigue siendo Ubuntu (paquetes del archivo oficial, `/etc/os-release` y `/etc/issue` dicen Ubuntu). Eso es lo correcto para un derivado y solo se ve con acceso a consola, que la ISO pública no da (sin SSH ni cuenta con sudo).
- **Pendiente de una persona:** esto es una revisión técnica, no asesoría legal. Si el producto se vende de forma masiva, conviene que alguien lea la política de propiedad intelectual de Canonical (ubuntu.com/legal/intellectual-property-policy) y confirme que la remasterización encaja.
