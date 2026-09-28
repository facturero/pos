# TODO — POS

Última actualización: reflejar el estado real de la conversación de diseño.
Marca con [x] cuando esté hecho Y validado (no solo escrito).

## 🔴 Bloqueante — hacer esto antes que nada más

- [ ] `git add -A && git commit -m "checkpoint"` en `cmr-proyect` (incluye
      `pos/`) — por seguridad ante agentes automáticos. Ver `rules.md` §8.
- [x] Reconstruir y migrar `organization-service` en Docker (hecho en Docker local, fase 1):
  ```
  docker compose build organization-service
  docker compose run --rm organization-service npx sequelize-cli db:migrate
  docker compose up -d organization-service
  ```
- [x] Reconstruir `auth-service` en Docker (endpoint interno nuevo): hecho en Docker local (fase 1)
- [x] Reconstruir `api-gateway-node` (ruta pública nueva de pairing): hecho en Docker local (fase 1)
- [x] Confirmar que crear un punto de emisión tipo POS ahora sí devuelve
      `type: "pos"` y `paired: false` en la respuesta (validado vía respuestas de
      `GET /billing-points?...` y del `unlink` en la prueba E2E)

## 🧪 Validación pendiente (código escrito, nunca compilado/probado)

- [ ] `npm run typecheck` (o `tsc --noEmit`) real en `organization-service`
- [ ] `npm run typecheck` real en `auth-service`
- [ ] `vue-tsc --noEmit` real en el CRM frontend (`cmr-proyect/frontend`)
- [x] Migración de `pos/backend` (`npx prisma migrate dev`) — corrida contra `pos_db`
      real (2026-09-25): 6 migraciones aplicadas, 13 tablas; login + sync OK
- [x] **Prueba end-to-end completa del emparejamiento** (2026-09-25, ver
      `VALIDACION-E2E.md`; validado por API; el frontend se probó por contrato HTTP):
  1. Crear punto de emisión tipo POS en el CRM
  2. Ver el código de 6 dígitos
  3. Levantar `pos/backend` + `pos/frontend` (`npm run dev` en ambos)
  4. `/setup` pide el código
  5. Ingresar el código → empareja y pasa al login de cajero
  6. El catálogo (productos/categorías) se descarga solo
  7. Una venta queda en `sales` con `synced: false` y luego sube con `POST /sync/run`
     (billing-service ya existe: la venta se convierte en factura `issued`, ver facturas
     `001-002-000000001..003` creadas en la prueba)
- [x] Probar "Desvincular y regenerar" desde el CRM, y que el POS ya
      desvinculado no pueda seguir sincronizando (desvincula solo vía socket.io;
      con `pos_config` vacío no sube ventas; re-empareja con código nuevo)
- [ ] **Autoservicio de desvinculación** (2026-09-27): "Volver a ingresarlo" en
      el login ahora también desvincula el punto en el CRM (no solo local),
      llamando a la misma ruta que usa el admin. Verificado por lectura de
      código y por el smoke test del release; **falta la prueba de punta a
      punta con un emparejamiento real** (emparejar → volver a ingresar → ver
      que el punto quedó libre en el CRM) — el dueño puede hacerla, tiene
      acceso al CRM.

## 🟡 Falta programar — trabajo real, no solo config

- [x] **El instalador/OS** — hecho y probado en VirtualBox el 2026-09-27 (ver
      `HANDOFF-pos-os.md` y `os/DISENO.md`, ambos reescritos esa sesión):
  - [x] ISO de Ubuntu con `autoinstall.yaml`, marca POS KIOSKO (un producto de
        noahsolutions, identidad visual propia) durante la
        instalación y el primer arranque
  - [x] Modo kiosco (Openbox, autologin, sin escritorio), barra de estado y
        F12 (inspector de la webview) en la pantalla del POS
  - [x] Lockdown (TTYs deshabilitados, ufw todo entrante denegado; atajos de
        teclado: no hace falta, Openbox no trae menú por defecto)
  - [x] `os/provision/install.sh` + unidades systemd: backend (SQLite) +
        frontend + `os/updater` corriendo cada hora
  - [x] Dos capas — imagen de OS (casi no cambia) + capa de app versionada
        que se auto-actualiza sola —, decidido y hecho: **actualizador
        propio** (`os/updater`), no el de Tauri (ver ítem de abajo)
  - [x] **Apagar/reiniciar y conectar Wi-Fi desde la barra de estado del POS**
        (2026-09-27): `backend/src/system/{power,wifi}.ts` +
        `frontend/src/components/WifiPanel.vue`. Wi-Fi usa NetworkManager
        (`nmcli`), que el instalador ahora instala y deja gestionando la red
        (con una regla de polkit para que funcione sin sudo). Verificado con
        `fetch` simulado en el navegador y 8 pruebas del parser de `nmcli`;
        **falta probarlo con una tarjeta Wi-Fi real** (VirtualBox no simula
        ninguna) — es el ítem más importante de la lista de abajo.
  - [ ] **Sin probar todavía**: UEFI (todo fue BIOS), hardware real (pantalla
        táctil, impresora, Wi-Fi real — ver arriba), y
        `.github/workflows/release.yml` (nunca se ejecutó — cada release
        hasta la 0.2.4 se armó a mano)
- [x] ~~**Auto-updater de Tauri**~~ — decisión tomada en contra: se construyó un
      **actualizador propio** (`os/updater/`, firmado con Ed25519, con
      rollback) en vez del plugin updater de Tauri, porque este último solo
      reemplaza el binario de la ventana y la app real es un backend Node con
      migraciones que Tauri no toca. `main.rs` **no** lleva el plugin.
- [ ] **Logo real** (`src-tauri/icons/`) — sigue con un placeholder generado
      automáticamente en el build (`os/window/build-window.sh`/Dockerfile,
      `make-icons.py`) para poder compilar sin bloquear todo lo demás.
- [x] **billing-service** existe y está desplegado desde el 2026-09-04.
      `POST /invoices/from-pos` ya es un endpoint real (2026-09-15): convierte
      la venta en factura EMITIDA, es idempotente por (terminalId, posSaleId) y
      recalcula los totales desde el catálogo. `admin-client.ts` y `push.ts` ya
      mandan el contrato real (deviceId como terminal, punto de emisión del
      emparejamiento, cliente del CRM o CONSUMIDOR FINAL).
  - [x] **Probado de verdad** (2026-09-25): venta de punta a punta contra el
        CRM con la factura numerada en el CRM (`001-002-000000001..003`) y la
        venta marcada `synced`. **Stock descontado en inventario: NO probado**
        (inventory-service no corre en el stack local). Idempotencia y offline
        validados — ver `VALIDACION-E2E.md`.
- [ ] **Catálogo de permisos para terminales POS** — hoy usa el rol
      "Administrador" completo a propósito ("por ahora todos pueden entrar").
      Cuando se defina qué permisos necesita realmente un POS
      (`product:read`, `invoice:create` cuando exista billing, etc.), hay que:
  - [ ] Crear el rol específico en `auth-service`
  - [ ] Cambiar `provision-service-account.ts` para asignar ese rol en vez de
        "Administrador"
- [ ] **Inventario real** — `inventory-service` ya está desplegado
      (2026-09-15) y descuenta stock al emitirse la factura. Falta reintroducir
      la validación de stock en `pos/backend/src/routes/sales.routes.ts` (hoy
      deliberadamente deshabilitada), decidiendo antes qué hace la caja cuando
      está offline y no puede consultar el stock del CRM.

## 🟢 Hecho (escrito, revisar contra la validación pendiente arriba)

- [x] Backend POS: auth JWT local, productos/categorías (solo lectura),
      sesiones de caja, ventas con transacción atómica
- [x] Módulo de sync: `pull.ts`, `push.ts`, `scheduler.ts` (cron cada 5 min,
      configurable)
- [x] Frontend POS: login, venta (catálogo + carrito + cobro), historial,
      indicador de sincronización, iconos MDI
- [x] Scaffold de Tauri (`src-tauri/`) — Cargo.toml, tauri.conf.json, main.rs
- [x] `organization-service`: tipo `web`/`pos`, TOTP, emparejar, desvincular
- [x] `auth-service`: aprovisionamiento interno de cuenta de servicio
- [x] `api-gateway-node`: ruta pública de pairing
- [x] `docker-compose.yml`: secretos internos configurados
- [x] POS backend: tabla `pos_config`, endpoints `/setup/status`,
      `/setup/pair`, `/setup/forget`
- [x] POS frontend: pantalla `/setup`, guard de router que la prioriza
- [x] CRM frontend: selector Web/POS, diálogo de código rotativo, desvincular
- [x] `rules.md` (este contexto) y este `todo.md`

## Preguntas abiertas (no técnicas, decisión del dueño del proyecto)

- ¿La caja puede vender sin stock suficiente? Hoy vende siempre; inventario ya
  avisa de existencias en negativo, pero nadie bloquea la venta.
- ¿Un solo POS por punto de emisión, o eventualmente varios dispositivos
  compartiendo el mismo punto de emisión? (hoy el diseño asume 1:1)
- ~~¿El instalador/OS sigue siendo prioridad?~~ — resuelto: se retomó y se
  probó de punta a punta en VirtualBox (2026-09-27). Las preguntas que quedan
  de esa parte (probar Wi-Fi/apagar-reiniciar en hardware real, prioridad de
  probar en hardware vs. seguir con el POS/CRM) están en la sección de arriba.
