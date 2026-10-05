# Sistema operativo del Facturero (POS) — diseño y estado

> **2026-09-26 — MySQL se reemplazó por SQLite** (Prisma 6.19). Donde más abajo diga MySQL, `pos_db`, contraseña de
> base de datos o `bind-address`, léase: la base es el archivo `/var/lib/facturero/pos.db` (sin servidor, sin
> contraseña, sin puerto). Ver `rules.md` (tabla de decisiones) y `CHANGELOG.md`.
>
> **2026-09-27 — todo lo de abajo ya se probó de punta a punta en VirtualBox** (varias instalaciones completas:
> ISO → autoinstall → primer arranque → kiosco → emparejamiento), no solo "escrito". Ver `HANDOFF-pos-os.md`
> (raíz del repo padre) para el estado real fase por fase, qué sigue sin probar (UEFI, hardware real,
> `release.yml`) y dos bugs reales que salieron de esas pruebas (el socket local usaba la URL de desarrollo en
> producción; F12 no abría el inspector por dos causas de ACL de Tauri, no del código de la app).

Objetivo: que un cliente no técnico reciba un equipo (o una ISO), lo enciende, lo empareja con el
código de 6 dígitos del CRM y vende. Sin escritorio, sin terminal, sin actualizar nada a mano.

## Decisión de fondo: dos capas

| Capa | Qué contiene | Cambia | Cómo se actualiza |
|---|---|---|---|
| **Imagen del SO** | Ubuntu Server 24.04 LTS, Openbox en modo kiosco, runtime de Node, la ventana (Tauri), el actualizador, cortafuegos | Casi nunca | Reinstalar la ISO, o `unattended-upgrades` solo para parches de seguridad |
| **Capa de aplicación** | Backend del POS (Node, compilado) + pantalla (Vue compilada) + migraciones de Prisma | Con cada versión del POS | **Actualizador propio** (`os/updater`): paquete firmado → migraciones → cambio de versión → prueba de salud → vuelta atrás si falla |

Por qué un actualizador propio y no el auto-updater de Tauri: el updater de Tauri solo reemplaza el
binario de la ventana. La app real es un backend Node con base de datos y migraciones, que Tauri no
actualiza. Con una sola capa versionada (`/opt/facturero/releases/<versión>`, `current` → la activa)
todo se mueve junto y se puede volver atrás.

## Disposición en disco (equipo instalado)

```
/opt/facturero/
  app/                      binario de la ventana (Tauri) — capa del SO, va en la imagen
  runtime/node-<v>/        Node fijado (no el de apt)
  update-cli/              el actualizador instalado (os/updater copiado por install.sh)
  releases/<versión>/      backend/dist, backend/node_modules (solo producción), backend/prisma,
                           frontend/dist, VERSION
  downloads/               paquetes .tar.gz descargados (los crea el actualizador)
  current -> releases/X    la versión que corre
  state.json               versión previa y versiones que fallaron (no se reintentan)
  updater.lock             candado del actualizador (no correr dos a la vez)
/etc/facturero/
  pos.env                  secretos y configuración del backend (0600, root; lo consume systemd)
  updater.json             URL del manifiesto, comandos de migrar/reiniciar, URL de salud
  release-public.pem       clave PÚBLICA que verifica cada actualización
  kiosk.env                opciones del kiosco (binario, cursor oculto) — service técnico
  install-params.env       parámetros del primer arranque desatendido (se borra al terminar)
/var/lib/facturero/        datos del POS (imágenes descargadas, etc.)
/var/lib/facturero/pos.db  base SQLite (un archivo, diario DELETE — no WAL, ver db.ts; la crea prisma migrate deploy)
```

## Lo que ya está hecho y probado (`os/`)

- **`updater/updater.mjs` + `cli.mjs`**: descarga el manifiesto, verifica la firma Ed25519, baja el
  paquete, comprueba tamaño y sha256, descomprime en `.partial` y lo renombra, corre las migraciones,
  cambia `current`, reinicia y espera `GET /health`; si falla, vuelve a la anterior y marca la
  versión como mala. Bloqueo para no correr dos a la vez. Conserva las últimas N versiones.
- **`release/sign-release.mjs`**: empaqueta una carpeta y genera `latest.json` firmado; también crea
  el par de claves (`--gen-keys`).
- **`updater/updater.test.mjs`**: 10 pruebas de punta a punta (firma ajena, paquete alterado,
  migración que falla, versión que no arranca → rollback, etc.). Corren sin VM:
  `node --test os/updater/updater.test.mjs`.

- **Fase 2 (pantalla servida por el backend, un solo origen)**: `POS_FRONTEND_DIST` en `index.ts` sirve el `frontend/dist` desde `:4000` (incluida la SPA en modo history: solo a peticiones de navegación con `Accept: text/html`), `/health` chequea la BD con `SELECT 1` y reporta la versión del archivo `VERSION` del dist, y el socket local se monta en el mismo server. `tauri.conf.json`/`main.rs` abren la webview en `http://127.0.0.1:4000` (en el primer arranque, en `http://127.0.0.1:4080`, la pantalla de progreso). La ventana **sí se compila**, en Docker (`os/window/build-window.sh`, Ubuntu 24.04 + Rust 1.90 + webkit2gtk-4.1; no hay toolchain de Rust en la máquina de desarrollo, por eso el contenedor). Pruebas en el CHANGELOG.
  - **Bug real encontrado el 2026-09-27** (no cosmético, afectaba a TODOS los POS instalados desde la primera
    versión): `frontend/src/socket/localSocket.ts` comprobaba la variable de desarrollo
    `VITE_LOCAL_SOCKET_URL` **antes** que `import.meta.env.PROD` con el operador `??`. Como Vite carga
    `frontend/.env` también en `vite build` (no hay `.env.production` que lo tape), todo build de producción
    hasta la 0.2.2 quedaba con la URL de desarrollo (`127.0.0.1:4001`) grabada en el bundle: el socket local
    nunca conectaba, así que la desvinculación remota y el estado de sincronización nunca llegaban a la
    pantalla sin recargar. Arreglado en 0.2.3: mismo orden que ya usaba correctamente `api/client.ts` (PROD
    primero). Regla para el futuro: en cualquier `import.meta.env.ALGO ?? (PROD ? ... : ...)`, PROD va afuera.

- **Fase 3 (`os/release/build-release.sh`)**: construye y firma la versión dentro de `node:22-bookworm-slim` (monta el repo solo lectura). Empaqueta: `backend/dist` compilado, `package*.json`, `node_modules` **solo de producción** con la CLI de prisma, `backend/prisma` (schema + migraciones), `frontend/dist`, y `VERSION`. Correr sin `--key` solo arma el stage; `--smoke` arranca el paquete con una base SQLite temporal dentro del propio contenedor (aplica las migraciones y comprueba `/health` + pantalla, sin depender de nada externo). Paquete final ~67 MB (se podó el runtime wasm de `@prisma/client` que no hace falta en Linux). Tres trampas resueltas en el script, documentadas en comentarios: (1) prisma pasó a `dependencies` para que `prisma migrate deploy` exista en `node_modules` de producción; (2) `node:22-*-slim` NO trae `openssl` y Prisma entonces detecta "openssl-1.1.x" y no encuentra el motor 3.0.x — el contenedor de build y el smoke instalan `openssl`; (3) Git Bash no puede pasar stdin a `docker.exe` (el script interno va montado como archivo) y `node` de Windows no entiende rutas POSIX (se pasan con `cygpath -w`).

- **Fase 4 (`os/provision/install.sh` + plantillas)**: aprovisiona el equipo de forma idempotente:
  usuario system `facturero`; Node fijado en `/opt/facturero/runtime/` bajado de nodejs.org
  con **verificación SHA256** contra `SHASUMS256.txt` (no el node de apt); base **SQLite**
  (`/var/lib/facturero/pos.db`, sin servidor — ver la nota de MySQL→SQLite arriba); `pos.env` con
  `DATABASE_URL`, `JWT_SECRET`, `PORT=4000`, rutas de pantalla e imágenes (y `ADMIN_API_BASE_URL`
  solo si se pasó `--admin-api-base`); unidades `facturero-backend.service` (Restart=always) y
  `facturero-updater.service` + `.timer` (cada hora, `OnBootSec` 5 min + `RandomizedDelaySec` 10 min,
  `OnCalendar=hourly` de respaldo, `Persistent`); sudoers mínima (`NOPASSWD:` un único script,
  `restart-app.sh`, instalado root:root 0755 en `$UPDATE_CLI` — `facturero` no puede editarlo, y
  sudo exige la ruta exacta, plantillada en `updater.json` con `__RESTART_SCRIPT__`);
  copia la clave pública a `/etc/facturero/release-public.pem`; ufw con todo lo entrante denegado;
  zona horaria `America/Guayaquil`; espera activa a que haya internet antes de instalar nada (avisa
  cada 30 s en la pantalla en vez de saturarla de errores de `apt`); Wi-Fi y apagar/reiniciar desde la barra de estado del POS (NetworkManager + regla de polkit + sudoers acotada, ver más abajo); tras `netplan apply` (que reinicia la red y hace que NetworkManager pida la IP otra vez) **espera hasta 60 s a resolver `github.com`** antes del paso del actualizador — sin esa espera el actualizador arrancaba con la red a medio levantar y fallaba la primera vez con `fetch failed` (pos-test12, 2026-09-28); se recuperaba solo al reintentar, pero mostraba un error asustador; y la **primera versión de la app
  se baja con el propio actualizador** lanzado por systemd (no `su`: la unidad aporta el
  `EnvironmentFile` que necesita `prisma migrate deploy`). `migrateCmd` corre
  `prisma migrate deploy` desde `$RELEASE_DIR/backend`, **con el backend parado**: `stopCmd`
  (`sudo __RESTART_SCRIPT__ stop`) lo para justo antes, porque con el backend vivo la migración
  falla siempre con `database is locked` si la base está en WAL (causa raíz verificada 2026-10-04; desde
  la 0.3.5 el backend usa journal DELETE y el paquete trae un wrapper de `prisma`, ver CHANGELOG; los
  reintentos `migrateRetries` no lo arreglan, solo cubren fallos de verdad transitorios). Antes de parar nada, `gateCmd` (`backend/update-gate.mjs`, dentro de la release) espera un buen momento para aplicar la versión (caja cerrada / pantalla ociosa / botón "Actualizar ahora" / tope de 3 días): la versión nueva se baja en segundo plano y se activa sin pillar a nadie a media venta; el mismo script lo ejecuta el wrapper de `prisma` para alcanzar a las cajas con actualizador viejo (ver CHANGELOG 2026-10-05). `restartCmd` (`sudo __RESTART_SCRIPT__` → `os/provision/restart-app.sh`)
  reinicia el backend (tolera el primer arranque, `systemctl start` como rama del `||`) **y además
  mata la ventana del kiosco** (`pkill -f facturero-pos-app`; `launch.sh` la relanza sola) — sin
  esto la ventana se quedaba con los nombres de archivo `.js` con hash de la build anterior y
  pedía un asset que ya no existía (404) tras navegar, encontrado 2026-09-30 en una actualización
  real de 0.3.2 a 0.3.3.

- **Fase 5 (`os/kiosk/`)**: autologin del usuario `facturero` en **tty1** vía drop-in de `getty@tty1.service.d` (`agetty --autologin`; el usuario queda con `/bin/bash` para poder iniciar X — ver instalador); `tty2..6`, `ctrl-alt-del.target` y los objetivos de sueño/suspensión enmascarados; `.bash_profile` → `exec startx` (solo si `XDG_VTNR=1`), `.xinitrc` → `openbox-session`, `rc.xml` **sin menú ni binds por defecto** (un solo escritorio); autostart hace `source` de `/etc/facturero/kiosk.env` y lanza `launch.sh`, que **espera `/health` y mantiene la ventana viva** (`/opt/facturero/app/facturero-pos-app`, con reintento a los 2 s si muere), apaga salvapantallas/suspensión (`xset -dpms`) y oculta el cursor si `KIOSK_HIDE_CURSOR=1` (`xsetroot -cursor empty.xbm`). Acceso de servicio técnico: **SSH con clave SOLO desde `--allow-ssh-from CIDR`** en el instalador (ufw: `allow from <cidr> to any port 22`); **nada de contraseñas fijas**. La pantalla del POS lleva además una **barra de estado inferior** (versión, cable/Wi-Fi/sin red, hora — `frontend/src/components/StatusBar.vue` + `backend/src/system/network.ts`) y, con **F12**, abre el inspector de la webview (pestaña Red) sin SSH ni navegador aparte.

- **Fase 6 (`os/iso/`)**: `autoinstall.yaml` (subiquity v1, Server 24.04): disco completo LVM, locale es_ES, teclado es, usuario técnico `taller` sin contraseña de login (`allow-pw: false`, clave SSH del parámetro), y `late-commands` que **solo copian** `pos-os/` y los parámetros al destino y habilitan `facturero-firstboot.service` (no se corre `install.sh` en chroot: `systemctl` no funciona ahí). `firstboot.sh` (unidad `Type=oneshot`, `After=network-online.target`): lee `install-params.env` → `install.sh --admin-api-base … --allow-ssh-from …` → `setup-kiosk.sh` → se desactiva y `systemctl reboot` al kiosco. Pantalla de instalación en modo texto: pasos a la izquierda y detalle de comandos en vivo a la derecha (`os/iso/install-tui.py`, recibe los eventos de subiquity por webhook), y pantalla de marca sin texto de consola durante todo el proceso (`os/iso/brand.sh`, consola virtual 9). El primer arranque tiene su propia pantalla gráfica (`os/installer-ui/`, servida en `:4080` por la misma ventana Tauri). **Marca (2026-09-28):** "POS KIOSKO" con "un producto de noahsolutions" debajo, en las tres pantallas. Identidad visual propia a propósito (verde azulado sobre gris cálido, "POS" en pastilla, cargador de puntos, detalle en tarjeta oscura tipo terminal): un diseño anterior imitaba demasiado al instalador de Hermes (azul eléctrico, serif condensada con cortes tipo stencil, botón con corchetes) y el dueño pidió alejarse para evitar un reclamo público. Los colores viven en las variables CSS de `installer-ui/index.html` y en `PALETTE` de `install-tui.py` (más `NAME_HEX`/`BG_HEX` de `brand.sh`); el menú de GRUB dice "Instalar POS KIOSKO". **Trampas de la consola de Linux** (16 colores, redefinibles con `ESC ] P n rrggbb`): "negrita + color" (`ESC[1;34m`) usa la variante BRILLANTE (azul→12, verde→10, rojo→9), así que hay que redefinir también esos índices o salen los colores de fábrica; y `console-setup` puede volver a poner la paleta de fábrica DESPUÉS de fijarla, por eso las pantallas de texto la reafirman cada 5 s. `build-iso.sh`/`build-iso-docker.sh` (el segundo corre en Docker, sirve también desde Windows): reconstruyen la ISO con `xorriso`, copian `os/` como `pos-os`, sustituyen placeholders y dejan un solo menú de GRUB ("Instalar Facturero POS", sin texto de consola visible). Detalles en `os/iso/REMOSTRADO.md`.

**Probado en VirtualBox (2026-09-27), de punta a punta, varias veces:** arranque de la ISO → autoinstall →
primer arranque completo → reinicio al kiosco → emparejamiento con un código real del CRM. Ver
`HANDOFF-pos-os.md` para el detalle de qué falló en el camino y cómo se arregló.

**Sin probar todavía:** UEFI (todo lo de arriba fue en BIOS), hardware real (pantalla táctil, impresora,
Wi-Fi real — el detector de red distingue cable/Wi-Fi y ya se puede conectar a una, pero nunca con una
tarjeta Wi-Fi real: VirtualBox no simula ninguna), y `.github/workflows/release.yml` (nunca se ejecutó;
todas las releases hasta la 0.2.4 se armaron a mano).

## Reglas que salen de este diseño

1. **Migraciones solo hacia adelante y compatibles hacia atrás.** Si una versión nueva falla y se
   vuelve a la anterior, la base ya migró: la versión vieja debe seguir funcionando con el esquema
   nuevo. En una versión: agregar columnas/tablas; borrar o renombrar en una versión posterior.
2. **La clave privada de firma nunca va al repo ni al equipo del cliente.** Solo la pública viaja en
   la imagen. Perder la privada = no poder actualizar los equipos ya instalados (guardar copia).
3. **Prisma necesita el motor de Linux.** Hecho en la fase 2: `binaryTargets = ["native", "debian-openssl-3.0.x"]` en el `generator` de `schema.prisma`, con el motor de Debian/OpenSSL3 generado junto al de Windows. El paquete se puede seguir construyendo en Windows; el motor de Ubuntu 24.04 va incluido.
4. **Un solo origen para la pantalla:** hecho en la fase 2: el backend sirve la pantalla compilada (`serveStatic` en :4000, activado con `POS_FRONTEND_DIST`) y Tauri solo abre `http://127.0.0.1:4000`. La API del frontend y el socket local usan URLs relativas (mismo origen) en producción; en desarrollo nada cambió (Vite 1420 + socket 4001) — **siempre comprobando `import.meta.env.PROD` primero**, nunca detrás de un `??` con la variable de desarrollo (ver el bug real de la fase 2 arriba). El socket local (socket.io `pos.unlink`, `sync.status`) se monta en el mismo server :4000 cuando el backend sirve la pantalla. 401 de `/sync/status` sin sesión: esperado (la pantalla lo consulta al cargar; ese ciclo se vuelve a disparar tras login).
5. El equipo solo saca tráfico hacia el CRM (gateway), el servidor de actualizaciones y NTP; nada
   entra (cortafuegos `ufw` con todo denegado hacia dentro).
6. **Cualquier comando propio de Tauri (`#[tauri::command]`) necesita DOS cosas, no solo el código**:
   declararlo en `src-tauri/build.rs` (`AppManifest::new().commands(&["..."])`, para que Tauri genere su
   permiso `allow-<comando>`) y, como la ventana carga una URL externa (`http://127.0.0.1:4000`/`:4080`,
   no el protocolo interno de Tauri), agregar ese origen a `"remote": { "urls": [...] }` en
   `capabilities/default.json`. Sin cualquiera de las dos, el comando compila bien pero el runtime lo
   rechaza con "not allowed by ACL". Encontrado con F12 (abre el inspector); documentado para el
   próximo comando que se agregue.

## Fases

| # | Fase | Entrega | Estado |
|---|---|---|---|
| 1 | Actualizador + firma de paquetes | `os/updater`, `os/release`, pruebas | ✅ hecho |
| 2 | Pantalla servida por el backend + `/health` + `binaryTargets` de Prisma | cambios en `pos/backend` y `pos/frontend` | ✅ hecho y probado en modo producción de `:4000` |
| 3 | Script de construcción de la versión (Linux/Docker) | `os/release/build-release.sh`: compila, instala deps de producción, arma la carpeta que consume `sign-release` | ✅ hecho y probado (build + firma + smoke) |
| 3b | CI de publicación en GitHub Releases | `.github/workflows/release.yml`: construye al crear `vX.Y.Z`, firma con `RELEASE_SIGNING_KEY` y sube `latest.json` + `.tar.gz` con `gh release create` | ✅ escrito y validado (YAML); **sin ejecutar** — hasta la 0.2.4 cada release se armó a mano |
| 4 | Aprovisionamiento de Ubuntu (`install.sh`): Node fijado, usuario `facturero`, unidades systemd (backend + timer del actualizador), cortafuegos, SQLite | `os/provision/` | ✅ hecho y **probado en VirtualBox** (varias instalaciones completas) |
| 5 | Modo kiosco: autologin, Openbox arrancando la ventana, sin TTY ni atajos, reinicio automático si la ventana se cierra, barra de estado, F12 | `os/kiosk/` + `frontend/src/components/StatusBar.vue` | ✅ hecho y **probado en VirtualBox** |
| 6 | Instalación desatendida: `autoinstall.yaml`, primer arranque y remasterizado de la ISO, ambos con la pantalla de marca POS KIOSKO | `os/iso/`, `os/installer-ui/` | ✅ hecho y **probado en VirtualBox** (BIOS; UEFI sin probar) |
| 7 | Publicación en **GitHub Releases** de `facturero/pos` (repo público) | releases `v0.2.0` a `v0.2.4` publicadas | ✅ hecho; el CI de publicación automática (fase 3b) sigue sin ejecutarse |
| 8 | Icono, nombre del equipo y marca; prueba en hardware real (incluido Wi-Fi/NetworkManager, escrito pero solo probado con `fetch` simulado) | — | pendiente |

## Publicar una versión (pasos del dueño)

El repo es público y la clave privada de firma **nunca va al repo** (regla 2).

1. **Generar el par de claves una sola vez** (fuera del repo, p. ej. en una USB):
   `node pos/os/release/sign-release.mjs --gen-keys <carpeta fuera del repo>`.
   Guarda `release-private.pem` a salvo: perderlo = no poder actualizar los equipos instalados.
2. **Poner la privada como secreto de GitHub**: `RELEASE_SIGNING_KEY` en
   *Settings → Secrets and variables → Actions* de `facturero/pos`, con el contenido
   del archivo `release-private.pem` (el workflow la escribe en un archivo temporal
   sin imprimirla nunca).
3. **Versionar la pública** en el repo: `os/release/release-public.pem` (no es secreto;
   `install.sh` la copia a `/etc/facturero/release-public.pem`).
4. **Crear la etiqueta** cuando toque publicar: `git tag vX.Y.Z && git push origin vX.Y.Z`.
   El workflow `Release POS` construye en `ubuntu-latest`, firma y sube a la Release
   `latest.json` + `facturero-pos-<X.Y.Z>.tar.gz`. Las URL que consultan los equipos:
   `https://github.com/facturero/pos/releases/latest/download/latest.json`.
5. **NOTA — política de paquetes firmados**: no publicar una versión sin que la firma
   y el `sha256` estén validados contra `os/release/release-public.pem`
   (`node os/updater/updater.test.mjs` cubre verify; `verifyManifest` del actualizador).

## Decisiones abiertas

- ~~Dónde se publican las actualizaciones~~: **GitHub Releases** de `facturero/pos`. Manifiesto: `https://github.com/facturero/pos/releases/latest/download/latest.json`. El repo es público, así que los equipos descargan sin token; el paquete lleva el código compilado, no el fuente privado de nadie más. La clave privada de firma vive solo como secreto de GitHub del dueño.
- ~~Qué pasa sin internet al instalar~~: la app se baja en el primer arranque (necesita red); si no hay,
  el primer arranque **espera activamente** y avisa en pantalla cada 30 s, en vez de fallar.
- **Hardware objetivo:** arquitectura (x86_64 casi seguro), pantalla táctil o no, impresora de tickets —
  sigue sin decidirse, y nada de esto se probó en hardware real todavía.
- ~~**Wi-Fi**~~ (2026-09-27): se puede conectar desde la barra de estado del POS. El instalador agrega
  `network-manager` y le entrega la gestión de red (netplan `renderer: NetworkManager`, sin tocar las
  interfaces que ya configuró cloud-init) más una regla de polkit para que `nmcli` funcione sin sudo
  desde el usuario `facturero` (el kiosco no tiene agente gráfico de polkit para autorizar). Backend:
  `backend/src/system/wifi.ts` (parser de la salida `-t` de nmcli, con pruebas). **Sin probar con una
  tarjeta Wi-Fi real** — VirtualBox no simula ninguna.
- ~~**Apagar/reiniciar desde la barra de estado del POS**~~ (2026-09-27): hecho —
  `backend/src/system/power.ts` + sudoers acotada a `systemctl reboot`/`poweroff` (nada de `ALL`) +
  botón con `confirm()`.
