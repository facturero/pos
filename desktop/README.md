# POS de escritorio (Windows) — Electron

`.exe` para el cliente que quiere usar el POS como una app normal de Windows ("como Discord": se
instala con un clic, se abre solo al iniciar sesión, se actualiza sola) — **no** para el cliente
con equipo dedicado, que sigue usando el kiosco (`pos/os/`, ISO de Linux).

**Proyecto aparte, a propósito.** `pos/os/` no cambia en nada por esto — ni un archivo tocado. La
única dependencia es reusar el código ya escrito de `pos/backend` (Node/Prisma/SQLite, la misma
API, las mismas migraciones) y `pos/frontend` (el mismo build de Vite: login, POS, historial —
toda la pantalla). Lo único nuevo es la "cáscara": cómo arranca, cómo se empaqueta y cómo se
actualiza en Windows.

## Por qué Electron y no el binario de Tauri del kiosco

El primer intento de esta sesión fue reusar `frontend/src-tauri` (el binario del kiosco) para
Windows, con un supervisor hecho a mano en PowerShell (`watchdog.ps1`) para mantener vivos backend
y ventana, porque Windows no tiene systemd. Se descartó: Electron **ya viene con eso resuelto**.

- **Trae su propio Node.** `src/main.js` levanta `pos/backend/dist/index.js` como proceso hijo con
  un `node.exe` **empaquetado dentro del `.exe`** (`scripts/fetch-node.mjs` lo baja con el mismo
  SHA256 que usa el kiosco). No hace falta instalar Node en el equipo del cliente.
  - No se usa `ELECTRON_RUN_AS_NODE` a propósito: el Node embebido de Electron es la v20.18 y el
    backend importa `argon2`, un addon nativo, que **mata el proceso en silencio** al cargarlo. La
    app relanzaba el backend cada 2 s para siempre (7 intentos en 12 s medidos) sin que nada
    dijera por qué. Con Node 22.14.0 el mismo `argon2` hashea y verifica bien.
- **`electron-updater`** ya sabe actualizar contra GitHub Releases (mismo canal de distribución
  que ya usa el kiosco, `os/updater`, aunque son dos actualizadores independientes — ver más
  abajo). No hay que reimplementar descarga+verificación+reinicio a mano.
- **`electron-builder`** genera el instalador de Windows (NSIS, `oneClick: true` — un clic, sin
  pasos, como el instalador de Discord) y sabe registrar el inicio automático
  (`app.setLoginItemSettings({ openAtLogin: true })`).

El costo real frente a Tauri: el instalado pesa más. Electron empaqueta Chromium (~150-200MB) y el
runtime de Node (92MB), y encima `prisma` arrastra su CLI y los motores (el backend preparado
ocupa 351MB) porque el cliente tiene que poder aplicar migraciones solo. Total esperado del `.exe`,
del orden de **600MB**. Para este caso de uso (una app de escritorio más, no un equipo entero
dedicado) el peso extra es aceptable a cambio de no reinventar instalador + auto-actualizador +
supervisor de procesos.

## Cómo se develops y se empaqueta

```bash
npm install              # Electron + electron-builder
npm run prepare:resources # node.exe (vendor/) + backend de producción (stage/)
npm start                 # abre la app contra ../backend y ../frontend tal cual
npm run build:win         # prepara los recursos y genera el instalador NSIS
```

`prepare:resources` hace dos cosas, y las dos son necesarias:

- `scripts/fetch-node.mjs` baja Node 22.14.0 a `vendor/node/` y verifica el SHA256 contra
  `SHASUMS256.txt` de nodejs.org (mismo patrón que `os/provision/install.sh:104-113`). Detecta la
  plataforma: en Windows baja el `.zip` con `node.exe`, en Linux el `.tar.xz` con `node`, en mac el
  `.tar.gz`. **Esta carpeta se traspasó de Windows a Linux/Mint**, así que nada de esto puede
  tener el nombre de archivo fijo: con `win-x64` fijo, en Linux se bajaba un `node.exe` que no
  arranca.
- `scripts/stage-backend.mjs` compila `pos/backend` y monta `stage/backend/` con
  `npm ci --omit=dev` + `prisma generate`. Sin este stage, `extraResources` se llevaría el
  `node_modules` entero de desarrollo (typescript, tsx, @types) al instalador. También poda los
  motores de Prisma de otras plataformas (~50MB que el cliente no puede ejecutar), **invirtiendo la
  lista según la plataforma actual**: en Linux se conservan el de glibc (`debian`) y el musl
  (`linux`) y se van los de Windows y mac.

`vendor/` y `stage/` están en `.gitignore`: son ~92MB y ~350MB generados, no fuente.

> **Requisito: npm ≥ 11.** `pos/backend/package.json` y este `package.json` usan el campo
> `allowScripts`, que es lo que autoriza a `argon2`, `prisma` y `electron` a ejecutar sus scripts de
> instalación. Con npm 10 o anterior, `npm install` **se los salta en silencio**: `argon2` no compila
> y el backend muere al cargarlo sin decir nada, igual que pasaba antes de empaquetar su propio Node.
> Comprueba con `npm -v` en la máquina destino.

## Qué hace `main.js` (verificado el 2026-09-30 en ejecución)

- `package.json`: `electron`, `electron-builder` y `electron-updater`; scripts `start`,
  `prepare:resources`, `build:win`, `pack`.
- `src/main.js` verificado corriendo de punta a punta:
  1. `requestSingleInstanceLock()` — dos copias no pueden pelearse por el puerto 4000.
  2. Aplica las migraciones (`prisma migrate deploy`) **antes** de arrancar el backend, con
     reintentos. El backend no migra solo: sin esto una instalación nueva se quedaba sin tablas.
  3. Comprueba que el 4000 está libre y, si no, dice **qué proceso lo tiene** y diferencia "otra copia
     de la app" de "otro programa". El comando que da el PID es distinto por sistema: `netstat -ano`
     en Windows, `ss -ltnp` en Linux.
  4. Lanza el backend con el Node empaquetado, espera `/health` **y** que `/system/info` responda
     con `mode` (un 200 de otro servidor no vale), y reintenta con backoff **con tope de 5 intentos**
     — antes era un bucle infinito de 2 s.
  5. Abre una `BrowserWindow` normal (bordes, 1280×800) contra `http://127.0.0.1:4000`, vaciando la
     caché HTTP antes de cargar. La SPA se sirve desde el backend, así que la caché de Electron
     sobrevive a las actualizaciones y puede pedir assets del hash anterior: es el problema que se
     veía en el kiosco, con 404 en cadena tras actualizar.
  6. Al cerrar la ventana mata al hijo (`taskkill /T /F` en Windows, `kill` en Linux) para no dejar
     un backend huérfano ocupando el 4000 (que es lo que rompía la siguiente apertura).
- Todo lo que falla queda en `%APPDATA%\pos-desktop\logs\pos-desktop.log`, con rotación de 2MB y
  dos generaciones. Antes el backend iba a `stdio: "inherit"` y no se escribía en ninguna parte
  consultable, que fue lo que hizo indiagnosticable el fallo de `argon2`.
- `POS_MODE=desktop` (el kiosco usa `POS_MODE=kiosk`): `StatusBar.vue` ya oculta
  hora/apagar/reiniciar con esto, sin cambios en `pos/frontend`.
- Base de datos y secretos propios por instalación, en `%APPDATA%\pos-desktop\` (`app.getPath
  ("userData")` de Electron) — independiente del `/opt/facturero` del kiosco, que ni siquiera
  corre en la misma máquina.

## Estado del `.exe` (2026-10-06): generado, falta publicarlo

`npm run build:win` produce `out/POS-Desktop-Setup-<versión>.exe` (205 MB, NSIS de un clic, por usuario, sin
administrador) junto a `latest.yml` y el `.blockmap`. La versión del `.exe` es la de `package.json` (hoy **0.3.12**, la
misma del kiosco) y `stage-backend.mjs` la escribe en `dist/VERSION` para que el backend la reporte.

1. **Icono:** `build/icon.ico` (chip azul "POS", generado con `npm run icon`, sin dependencias).
2. **Auto-actualización cableada:** `startAutoUpdate()` en `main.js` comprueba al abrir y cada 6 h, baja sola y
   **instala al cerrar** (nunca reinicia en medio de una venta). Solo corre empaquetada. Lee `latest.yml` de los
   Releases de `facturero/pos`; si el Release no lo trae, solo deja una línea en el log.
3. **Prueba de humo:** `node scripts/smoke-unpacked.mjs` arranca el paquete armado (`out/win-unpacked`) con SU
   `node.exe` y una base temporal: migra, comprueba `/health`, `/system/info` (versión + modo desktop), que sirve la
   pantalla y que argon2 carga. No abre ventana.

**Publicación automática:** al crear la etiqueta `vX.Y.Z`, `.github/workflows/desktop-release.yml` construye el `.exe` en un
runner de Windows (frontend, backend, Node propio, `electron-builder --publish never`), pasa la prueba de humo y lo sube
a la Release que crea `release.yml`. Falla si `package.json` no dice `X.Y.Z`. Sin certificado el instalador sale sin
firma. Con un `.pfx`, `CSC_LINK` y `CSC_KEY_PASSWORD` como secretos del repo lo firman; con firma en la nube hace falta
un script `win.sign` propio (ver `COSAS-POR-HACER.md`). También se puede lanzar a mano desde
Actions para reconstruir una versión que ya existe. (El flujo manual de abajo sigue valiendo.)

**Para publicarlo a mano:** sube `POS-Desktop-Setup-X.exe`, `POS-Desktop-Setup-X.exe.blockmap` y `latest.yml` al **mismo**
Release `vX` del kiosco (`latest.yml` es el manifiesto de `electron-updater`; no choca con el `latest.json` firmado
del kiosco). El número del `.exe` debe ser el del Release: sube `version` en `package.json` antes de empaquetar.

**Pendiente de verdad:**
- **Sin firma de código.** Windows SmartScreen avisará de "editor desconocido" al instalar; hace falta un certificado
  (electron-builder firma solo con `CSC_LINK`/`CSC_KEY_PASSWORD`). La actualización automática funciona igual sin firma.
- **La ventana de Electron no se probó empaquetada** en esta máquina (se evitó para no registrar el autoinicio de
  Windows desde una carpeta de pruebas). Lo comprobado es el paquete y el backend, no el `.exe` instalado.
- **El login de punta a punta:** una instalación nueva cae en el emparejamiento con el CRM; hay que emparejar y entrar.

> En Windows sin "modo desarrollador", `electron-builder` falla extrayendo `winCodeSign` ("Cannot create symbolic
> link"): son dos enlaces de macOS que no se usan. Solución: extraer el `.7z` de la caché una vez (`7za x`) y dejar
> la carpeta como `%LOCALAPPDATA%\electron-builder\Cache\winCodeSign\winCodeSign-2.6.0`.

## Layout en disco (una vez instalado)

```
%LOCALAPPDATA%\Programs\POS\        binario de Electron + node/ + backend/ + frontend-dist/ (extraResources)
%APPDATA%\pos-desktop\
  data\pos.db                       SQLite, misma forma que el kiosco (Prisma)
  data\product-images\
  secrets.json                      JWT_SECRET generado una vez, por instalación
  logs\pos-desktop.log              arranque, migraciones y salida del backend (rotación 2MB)
```

## Diferencias con el kiosco (intencionales, no bugs)

| | Kiosco (`pos/os/`) | Desktop (`pos/desktop/`) |
|---|---|---|
| Ventana | pantalla completa, sin bordes | normal, con bordes, redimensionable |
| Apagar/reiniciar/hora | los controla el POS (`StatusBar.vue`) | los da Windows (ocultos, `POS_MODE=desktop`) |
| Arranque | systemd (`facturero-backend.service`) + `launch.sh` | Electron (`app.setLoginItemSettings`) + este `main.js` |
| Node del backend | `/opt/facturero/runtime/node` (lo baja `install.sh`) | `vendor/node` → `resources/node` (lo baja `fetch-node.mjs`) |
| Migraciones | las hace el actualizador antes de reiniciar, backend parado | este `main.js` al arrancar, antes de lanzar el backend |
| Auto-actualización | `os/updater/updater.mjs`, firma Ed25519 propia | `electron-updater`, formato NSIS/`latest.yml` |
| Multiusuario del equipo | no aplica (un solo programa en pantalla) | corre con el usuario de Windows que lo instaló |
