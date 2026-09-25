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

## 🟡 Falta programar — trabajo real, no solo config

- [ ] **El instalador/OS** (el objetivo original de toda esta conversación,
      antes de desviarnos a construir el POS en sí):
  - [ ] ISO de Ubuntu con `autoinstall.yaml`
  - [ ] Modo kiosco (Openbox, autologin, sin escritorio)
  - [ ] Lockdown (deshabilitar TTYs, atajos de teclado, firewall)
  - [ ] Script/servicio systemd que instale MySQL + backend + frontend +
        launcher con auto-updater al primer arranque
  - [ ] Separación en dos partes: imagen de OS (cambia poco) + capa de app
        que se auto-actualiza sola (tipo Discord), ya decidido en la
        conversación inicial
- [ ] **Auto-updater de Tauri**: generar el par de claves
      (`npx tauri signer generate`), reemplazar el `pubkey` placeholder en
      `tauri.conf.json`, y armar el servidor de `latest.json`
- [ ] **Iconos de la app** (`src-tauri/icons/`) — vacío, generar con
      `npx tauri icon <logo.png>`
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
- ¿El instalador/OS sigue siendo prioridad, o el foco ahora es terminar de
  validar/probar el POS + CRM tal como están?
- ¿Un solo POS por punto de emisión, o eventualmente varios dispositivos
  compartiendo el mismo punto de emisión? (hoy el diseño asume 1:1)
