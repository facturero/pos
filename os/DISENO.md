# Sistema operativo del Facturero (POS) — diseño y estado

Objetivo: que un cliente no técnico reciba un equipo (o una ISO), lo enciende, lo empareja con el
código de 6 dígitos del CRM y vende. Sin escritorio, sin terminal, sin actualizar nada a mano.

## Decisión de fondo: dos capas

| Capa | Qué contiene | Cambia | Cómo se actualiza |
|---|---|---|---|
| **Imagen del SO** | Ubuntu Server 24.04 LTS, Openbox en modo kiosco, MySQL, runtime de Node, la ventana (Tauri), el actualizador, cortafuegos | Casi nunca | Reinstalar la ISO, o `unattended-upgrades` solo para parches de seguridad |
| **Capa de aplicación** | Backend del POS (Node, compilado) + pantalla (Vue compilada) + migraciones de Prisma | Con cada versión del POS | **Actualizador propio** (`os/updater`): paquete firmado → migraciones → cambio de versión → prueba de salud → vuelta atrás si falla |

Por qué un actualizador propio y no el auto-updater de Tauri: el updater de Tauri solo reemplaza el
binario de la ventana. La app real es un backend Node con base de datos y migraciones, que Tauri no
actualiza. Con una sola capa versionada (`/opt/facturero/releases/<versión>`, `current` → la activa)
todo se mueve junto y se puede volver atrás.

## Disposición en disco (equipo instalado)

```
/opt/facturero/
  runtime/node-<v>/        Node fijado (no el de apt)
  releases/<versión>/      backend/dist, backend/node_modules (solo producción), backend/prisma,
                           frontend/dist, VERSION
  current -> releases/X    la versión que corre
  state.json               versión previa y versiones que fallaron (no se reintentan)
/etc/facturero/
  updater.json             URL del manifiesto, comandos de migrar/reiniciar, URL de salud
  release-public.pem       clave PÚBLICA que verifica cada actualización
/var/lib/facturero/        datos del POS (imágenes descargadas, etc.)
MySQL local                base pos_db (solo escucha en 127.0.0.1)
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

- **Fase 2 (pantalla servida por el backend, un solo origen)**: `POS_FRONTEND_DIST` en `index.ts` sirve el `frontend/dist` desde `:4000` (incluida la SPA en modo history: solo a peticiones de navegación con `Accept: text/html`), `/health` chequea la BD con `SELECT 1` y reporta la versión del archivo `VERSION` del dist, y el socket local se monta en el mismo server. `tauri.conf.json` abre la webview en `http://127.0.0.1:4000` (Tauri no se compiló: sin toolchain de Rust en la máquina de desarrollo). Pruebas en el CHANGELOG.

- **Fase 3 (`os/release/build-release.sh`)**: construye y firma la versión dentro de `node:22-bookworm-slim` (monta el repo solo lectura). Empaqueta: `backend/dist` compilado, `package*.json`, `node_modules` **solo de producción** con la CLI de prisma, `backend/prisma` (schema + migraciones), `frontend/dist`, y `VERSION`. Correr sin `--key` solo arma el stage; `--smoke` arranca el paquete contra el MySQL del compose local (por `host.docker.internal`) y comprueba `/health` + pantalla. Paquete ~39 MB gzip. Tres trampas resueltas en el script, documentadas en comentarios: (1) prisma pasó a `dependencies` para que `prisma migrate deploy` exista en `node_modules` de producción; (2) `node:22-*-slim` NO trae `openssl` y Prisma entonces detecta "openssl-1.1.x" y no encuentra el motor 3.0.x — el contenedor de build y el smoke instalan `openssl`; (3) Git Bash no puede pasar stdin a `docker.exe` (el script interno va montado como archivo) y `node` de Windows no entiende rutas POSIX (se pasan con `cygpath -w`).

**No probado todavía:** nada de lo que necesita Linux real (systemd, Openbox, autoinstall, MySQL del
sistema). Las pruebas del actualizador usan carpetas temporales y comandos de mentira.

## Reglas que salen de este diseño

1. **Migraciones solo hacia adelante y compatibles hacia atrás.** Si una versión nueva falla y se
   vuelve a la anterior, la base ya migró: la versión vieja debe seguir funcionando con el esquema
   nuevo. En una versión: agregar columnas/tablas; borrar o renombrar en una versión posterior.
2. **La clave privada de firma nunca va al repo ni al equipo del cliente.** Solo la pública viaja en
   la imagen. Perder la privada = no poder actualizar los equipos ya instalados (guardar copia).
3. **Prisma necesita el motor de Linux.** Hecho en la fase 2: `binaryTargets = ["native", "debian-openssl-3.0.x"]` en el `generator` de `schema.prisma`, con el motor de Debian/OpenSSL3 generado junto al de Windows. El paquete se puede seguir construyendo en Windows; el motor de Ubuntu 24.04 va incluido.
4. **Un solo origen para la pantalla:** hecho en la fase 2: el backend sirve la pantalla compilada (`serveStatic` en :4000, activado con `POS_FRONTEND_DIST`) y Tauri solo abre `http://127.0.0.1:4000`. La API del frontend y el socket local usan URLs relativas (mismo origen) en producción; en desarrollo nada cambió (Vite 1420 + socket 4001). El socket local (socket.io `pos.unlink`, `sync.status`) se monta en el mismo server :4000 cuando el backend sirve la pantalla. 401 de `/sync/status` sin sesión: esperado (la pantalla lo consulta al cargar; ese ciclo se vuelve a disparar tras login).
5. El equipo solo saca tráfico hacia el CRM (gateway), el servidor de actualizaciones y NTP; nada
   entra (cortafuegos `ufw` con todo denegado hacia dentro).

## Fases

| # | Fase | Entrega | Estado |
|---|---|---|---|
| 1 | Actualizador + firma de paquetes | `os/updater`, `os/release`, pruebas | ✅ hecho |
| 2 | Pantalla servida por el backend + `/health` + `binaryTargets` de Prisma | cambios en `pos/backend` y `pos/frontend` | ✅ hecho y probado en modo producción de `:4000` |
| 3 | Script de construcción de la versión (Linux/Docker) | `os/release/build-release.sh`: compila, instala deps de producción, arma la carpeta que consume `sign-release` | ✅ hecho y probado (build + firma + smoke) |
| 4 | Aprovisionamiento de Ubuntu (`install.sh`): MySQL, Node fijado, usuario `facturero`, unidades systemd (backend + timer del actualizador), cortafuegos | `os/provision/` | pendiente — **se prueba en VirtualBox** |
| 5 | Modo kiosco: autologin, Openbox arrancando la ventana, sin TTY ni atajos, reinicio automático si la ventana se cierra | `os/kiosk/` | pendiente — VM |
| 6 | Instalación desatendida: `autoinstall.yaml` (cloud-init) y remasterizado de la ISO | `os/iso/` | pendiente — necesita la ISO de Ubuntu Server 24.04 |
| 7 | Publicación en **GitHub Releases** de `facturero/pos` (repo público) + CI que firma y publica al crear una etiqueta `vX.Y.Z` | `.github/workflows/release.yml` | decidido; pendiente de escribir (ver HANDOFF-pos-os.md) |
| 8 | Icono, nombre del equipo y marca; prueba en hardware real | — | pendiente |

## Decisiones abiertas

- ~~Dónde se publican las actualizaciones~~: **GitHub Releases** de `facturero/pos`. Manifiesto: `https://github.com/facturero/pos/releases/latest/download/latest.json`. El repo es público, así que los equipos descargan sin token; el paquete lleva el código compilado, no el fuente privado de nadie más. La clave privada de firma vive solo como secreto de GitHub del dueño.
- **Hardware objetivo:** arquitectura (x86_64 casi seguro), pantalla táctil o no, impresora de tickets.
- **Qué pasa sin internet al instalar:** la ISO puede llevar todo embebido (más pesada) o bajar la capa de
  aplicación en el primer arranque (necesita red la primera vez).
