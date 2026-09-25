# VALIDACION-E2E.md

Prueba de punta a punta POS ↔ CRM (Docker local, 2026-09-25, opencode, fase 2 del traspaso).
Contexto obligatorio: `rules.md`, `todo.md`, `CHANGELOG.md` y `HANDOFF-pos-docker-local.md`.

## Resultado en una frase

**El flujo completo funciona de punta a punta**: emparejamiento TOTP → catálogo ↓ → venta local → push →
factura numerada en el CRM → idempotencia → offline sin pérdida → desvinculación remota por socket.io.
Un solo bug real obligó a tocar código (product-service pagina la lista de productos), ver "Arreglos" abajo.

## Entorno

- CRM mínimo en Docker (`docker compose`): mysql, rabbitmq, auth, organization, plugin-catalog, product,
  customer, tax, billing, gateway (`127.0.0.1:8080`). Sin document/fiscal/inventory/minio/frontend CRM.
- POS local: `pos/backend` (4000) + `pos/frontend` (dev en 1420). BD `pos_db` en el mismo mysql del compose.
- Org de prueba: `82ab1153-...` · Establecimiento Matriz `802eb517-...` · Punto POS `b5c37aa2-...` (cód. 002).

## Qué se validó (evidencia)

### 1. Emparejamiento (TOTP, código de 6 dígitos)
- `GET /establishments/:est/billing-points/:point/pairing-code` con admin → código de 6 dígitos rotativo.
- `POST http://127.0.0.1:4000/setup/pair { code, deviceId }` → `{ paired: true, organizationId, establishmentId, emissionPointId }`.
- El POS guarda `refreshToken` en `pos_config` (fila id=1) y el JWT del terminal queda con `sub = deviceId`.
- El primer sync corre solo tras el pair (`[sync] pull OK: 0 categorías, 3 productos, 1 usuarios, 1 clientes`).
- `[realtime] conectado al gateway` (socket.io `/ws` con el token del terminal).

### 2. Catálogo ↓ (pull)
- Productos: 3 bajados y espejados en `pos_db.products` por `remoteId` (uuid) con precio/estado.
- Usuario del CRM sincronizado: `AYGMFU5` (admin@admin.com), rol ADMIN, con `passwordHash` (argon2) para login offline.
- Cliente CONSUMIDOR FINAL espejado.
- `GET /categories` → array plano `[]` (no hay categorías creadas) — el pull lo maneja igual.

### 3. Login de cajero
- `POST /auth/login { username: "AYGMFU5", password: "<contraseña de desarrollo>" }` → 200, valida el hash argon2 **localmente** (offline).

### 4. Venta local → factura en el CRM
- Abrir caja (`POST /cash-sessions/open`) y vender 2 productos:
  - Venta local **id=1**, total **8.75** (2×Aceite 3.50 + 1×Arroz 1.75), `synced: false`, `status: COMPLETED`.
- `POST /sync/run` → `[sync] push: 1 subidas, 0 fallidas`.
- **CRM: factura `001-002-000000001`, total 10.06, status `issued`**, con `remoteId` igual al `invoice.id` en la venta local.

### 5. Idempotencia ((terminalId, posSaleId))
- Forzar reintento: `UPDATE sales SET synced=0` y volver a `POST /sync/run` → **misma factura** (`4b207ae4-...`),
  el CRM responde 200 con la existente, sin duplicados (de nuevo 1 sola factura).

### 6. Offline
- `docker compose stop billing-service` → vender (venta **id=2**, total 2.32) → push falla:
  `Admin API 502: DOWNSTREAM_ERROR` guardado en `syncError`, venta **sigue `synced: false`** (cola intacta),
  `syncLog` PUSH ERROR.
- `docker compose start billing-service` → `POST /sync/run` → venta **id=2 subida sola** → **factura `001-002-000000002`** (total 2.67). Cero pérdidas.

### 7. "Desvincular y regenerar" desde el CRM
- `POST /establishments/:est/billing-points/:point/unlink` con admin → 200, punto vuelve a `paired: false`,
  `totpSecret` regenerado (el mismo punto genera un código de emparejamiento nuevo).
- El POS se desvincula **solo por socket.io**: log `[realtime] desvinculado remotamente por el admin; limpiando emparejamiento local`, `pos_config` vacío, `/setup/status` → `paired: false`.
- Con el punto desvinculado, una venta nueva (**id=3**) ya **no se sube** (`synced: false`, sin factura).
- **Re-emparejar funciona**: mismo `deviceId` (identidad del equipo persistida en `pos_identity`) + nuevo código
  → vuelve a emparejar, sale id=3 se sube → **factura `001-002-000000003`**.

## Qué NO llegó a probarse (o quedó fuera a propósito)

- **SRI/fiscal-ecuador** no está corriendo localmente: la factura queda en `issued`, nunca se envía ni se marca `authorized`.
- **Inventario/stock**: inventory-service no está levantado; billing descuenta stock solo si el evento lo consume (ver AGENTS.md).
- **`catalog.changed` en tiempo real**: el pull funciona y el hub conecta, pero no se forzó un cambio de catálogo con el socket abierto.
- **Frontend en el navegador**: el backend se probó por API; la UI responde 200 en 1420 pero el flujo visual (pantallas /setup, caja)
  se probó solo por contrato HTTP, no con click automatizado (Playwright no se usó en esta fase).
- **Push con días de cola** (lote `take: 50`): solo se probaron colas cortas.

## Hallazgos

1. **`product-service` pagina la lista de productos** (`{ items, total, page, pageSize }`), pero el POS esperaba un array plano.
   Por eso el 1er pull trajo **0 productos** en silencio. Fix aplicado (ver Arreglos A). `/categories`, `/users` y `/customers` sí son arrays planos.
2. **La caja no cobra IVA y la factura sí lo calcula**: venta local 8.75 → factura 10.06 (= +15%). billing no falla ni rechaza:
   registra la diferencia en `posTotalsDiffCents`. Es una decisión de producto (¿la caja debe incluir IVA y mandar `tax`/totales iguales?),
   no un bug de wiring.
3. El login local del cajero usa el `username` de 7 caracteres del CRM (`AYGMFU5`), no el email; el hash argon2 baja en `GET /users`
   **solo** cuando el caller es un terminal POS de esa misma org (la cuenta humana nunca recibe hashes ajenos).
4. `vue-tsc --noEmit` del frontend no compila: `@blur="setTimeout(...)"` en un template resuelve `setTimeout` contra la instancia
   del componente y tipa error. Fix aplicado (Arreglos B).

## Arreglos propuestos (cada uno como cambio pequeño, YA aplicados localmente, sin commit)

**A. `pos/backend/src/sync/admin-client.ts` — `fetchRemoteProducts`**
Desempaquetar `{ items }` de la respuesta paginada de product-service:
```ts
const res = await request<{ items: RemoteProduct[] }>(`/products${params}`);
return res.items;
```
(antes devolvía el objeto `{ items, total, page, pageSize }` como si fuera `RemoteProduct[]`).

**B. `pos/frontend/src/components/CartPanel.vue`**
Mover el `setTimeout` del `@blur` a una función `hideDropdownLater()` en `<script setup>` (el template no puede llamar
`setTimeout` global: vue-tsc lo resuelve contra la instancia). Comportamiento idéntico.

**C. (decisión del dueño, no es un fix de código)** definir si la caja cobra IVA (para que `posTotalCents` coincida con el
total de la factura y el diff sea 0) o si aceptamos que factura > caja mientras `posTotalsDiffCents` quede anotado.

## Cómo reproducir (comandos raíz)

```powershell
# 1) CRM mínimo (ver LEVANTAR-LOCAL-DOCKER.md): stack + seed de datos base
docker compose up -d --build mysql rabbitmq auth-service organization-service plugin-catalog-service product-service customer-service tax-service billing-service gateway
# (bloque de seed por API del LEVANTAR-LOCAL-DOCKER.md: registro, plugins, perfil, punto POS, productos)

# 2) POS local
mysql create db pos_db (o: docker compose exec mysql mysql -uroot -proot123 -e "CREATE DATABASE pos_db ...")
cd pos/backend && npm install && npx prisma migrate deploy && npm run prisma:seed && npm run dev   # 127.0.0.1:4000
cd pos/frontend && npm install && npm run dev                                                      # 127.0.0.1:1420

# 3) emparejar (código TOTP del punto POS desde el CRM + deviceId del POS) → POST /setup/pair

# 4) comprobar que el catálogo bajó
docker compose exec mysql mysql -uroot -proot123 -e "SELECT COUNT(*), name FROM pos_db.products GROUP BY name"

# 5) abrir caja y vender
curl -X POST 127.0.0.1:4000/cash-sessions/open -H "Authorization: Bearer <pos-token>"
curl -X POST 127.0.0.1:4000/sales      -H "Authorization: Bearer <pos-token>" -d '{"cashSessionId":1,"items":[{"productId":2,"quantity":2}]}'

# 6) subir y validar
curl -X POST 127.0.0.1:4000/sync/run -H "Authorization: Bearer <pos-token>"
# estado local
docker compose exec mysql mysql -uroot -proot123 -e "SELECT id,total,synced,remoteId FROM pos_db.sales"
# facturas CRM
curl -H "Authorization: Bearer <crm-token>" http://127.0.0.1:8080/invoices
```

## Estado de los cambios en el repo POS

- `pos/backend/src/sync/admin-client.ts` (fix A): trabajado sobre el archivo **con trabajo sin commitear ajeno** — solo se tocó
  `fetchRemoteProducts`. Pendiente de revisión del dueño para commitear.
- `pos/frontend/src/components/CartPanel.vue` (fix B): cambio mínimo y aislado.
- `todo.md` y `CHANGELOG.md` actualizados siguiendo la política del repo (solo marcar lo validado).
- **Nada commiteado ni pusheado.**