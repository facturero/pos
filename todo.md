# TODO — POS

Última actualización: reflejar el estado real de la conversación de diseño.
Marca con [x] cuando esté hecho Y validado (no solo escrito).

## 🔴 Bloqueante — hacer esto antes que nada más

- [ ] `git add -A && git commit -m "checkpoint"` en `cmr-proyect` (incluye
      `pos/`) — por seguridad ante agentes automáticos. Ver `rules.md` §8.
- [ ] Reconstruir y migrar `organization-service` en Docker:
  ```
  docker compose build organization-service
  docker compose run --rm organization-service npx sequelize-cli db:migrate
  docker compose up -d organization-service
  ```
- [ ] Reconstruir `auth-service` en Docker (tiene el endpoint interno nuevo):
  ```
  docker compose build auth-service
  docker compose up -d auth-service
  ```
- [ ] Reconstruir `api-gateway-node` (tiene la ruta pública nueva de pairing):
  ```
  docker compose build api-gateway-node
  docker compose up -d api-gateway-node
  ```
- [ ] Confirmar que crear un punto de emisión tipo POS ahora sí devuelve
      `type: "pos"` y `paired: false` en la respuesta.

## 🧪 Validación pendiente (código escrito, nunca compilado/probado)

- [ ] `npm run typecheck` (o `tsc --noEmit`) real en `organization-service`
- [ ] `npm run typecheck` real en `auth-service`
- [ ] `vue-tsc --noEmit` real en el CRM frontend (`cmr-proyect/frontend`)
- [ ] Migración de `pos/backend` (`npx prisma migrate dev`) — nunca corrida
      contra una BD real
- [ ] **Prueba end-to-end completa del emparejamiento**:
  1. Crear punto de emisión tipo POS en el CRM
  2. Ver el código de 6 dígitos
  3. Levantar `pos/backend` + `pos/frontend` (`npm run dev` en ambos, o
     `npm run tauri dev`)
  4. Debería mostrar `/setup` pidiendo el código
  5. Ingresar el código → debería emparejar y pasar al login de cajero
  6. Confirmar que el catálogo (productos/categorías) se descarga solo
  7. Hacer una venta, confirmar que queda en `sales` con `synced: false`
     (esperado, porque billing-service no existe todavía)
- [ ] Probar "Desvincular y regenerar" desde el CRM, y que el POS ya
      desvinculado no pueda seguir sincronizando

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
- [ ] **billing-service** (en `cmr-proyect`, no en `pos/`) — hasta que no
      exista, `push.ts` seguirá sin poder subir ventas de verdad. Cuando se
      construya, hay que:
  - [ ] Definir el endpoint real de ingesta (hoy `pos/backend` apunta a un
        placeholder: `POST /invoices/from-pos`)
  - [ ] Actualizar `pos/backend/src/sync/admin-client.ts` con la forma real
        del payload que espere ese endpoint
- [ ] **Catálogo de permisos para terminales POS** — hoy usa el rol
      "Administrador" completo a propósito ("por ahora todos pueden entrar").
      Cuando se defina qué permisos necesita realmente un POS
      (`product:read`, `invoice:create` cuando exista billing, etc.), hay que:
  - [ ] Crear el rol específico en `auth-service`
  - [ ] Cambiar `provision-service-account.ts` para asignar ese rol en vez de
        "Administrador"
- [ ] **Inventario real** — cuando exista `inventory-service` (o se agregue
      stock a `product-service`), reintroducir la validación de stock en
      `pos/backend/src/routes/sales.routes.ts` (hoy deliberadamente
      deshabilitada)

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

- ¿Cuándo se construye `billing-service`? Bloquea la sincronización real de
  ventas.
- ¿El instalador/OS sigue siendo prioridad, o el foco ahora es terminar de
  validar/probar el POS + CRM tal como están?
- ¿Un solo POS por punto de emisión, o eventualmente varios dispositivos
  compartiendo el mismo punto de emisión? (hoy el diseño asume 1:1)
