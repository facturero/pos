# CHANGELOG — POS

Este archivo es contexto para agentes (opencode, etc.), no solo un historial
para humanos. Cada entrada explica **qué se hizo, por qué, y qué queda como
consecuencia** — para que un agente que lea esto no "corrija" algo que en
realidad fue una decisión deliberada, y sepa exactamente por dónde seguir.

Antes de tocar código, lee también `rules.md` (reglas fijas) y `todo.md`
(lista de tareas). Este archivo es el "por qué llegamos hasta acá".

---

## Estado actual en una frase

El POS está **emparejado y validado de punta a punta contra un CRM en Docker**
(2026-09-25): catálogo ↓, venta local, push → factura `issued` numerada en el
CRM, idempotencia, offline sin pérdida, y desvinculación remota por socket.io.
Quedan pendientes no-código: decisión de IVA en la caja, inventario/stock real,
SRI, y el instalador/OS original.

---

## 2026-09-25 — Sesión: validación E2E POS ↔ CRM (Docker local)

**Qué se hizo:** Se levantó `pos/backend` + `pos/frontend` en local sobre la BD
`pos_db` (6 migraciones Prisma aplicadas, seed `admin`), se lo emparejó con el
CRM mínimo en Docker mediante el código TOTP de 6 dígitos, y se probó de punta
a punta. Detalle completo y evidencia en `VALIDACION-E2E.md`. El `todo.md` quedó
marcado solo en lo validado.

**Por qué:** era el pendiente número uno del traspaso — el código de
emparejamiento y del POS estaba escrito pero **nunca compilado ni corrido**; no
se sabía si el flujo funcionaba. Resultado: funciona.

**Qué se encontró y qué se arregló (cambios pequeños, SIN commitear, para
revisión del dueño):**
- **A. `backend/src/sync/admin-client.ts` → `fetchRemoteProducts`**: `product-service`
  pagina `GET /products` (`{ items, total, page, pageSize }`) pero el pull esperaba
  array plano → el 1er pull bajaba **0 productos en silencio**. Fix: desempaquetar
  `res.items`. `/categories`, `/users`, `/customers` sí son arrays planos.
- **B. `frontend/src/components/CartPanel.vue`**: `vue-tsc --noEmit` no compilaba —
  `@blur="setTimeout(...)"` en el template resuelve `setTimeout` contra la instancia
  del componente. Fix: función `hideDropdownLater()` en `<script setup>`.

**Qué queda como consecuencia (decisiones pendientes del dueño):**
- **La caja no cobra IVA**: venta local 8.75 → factura 10.06 (+15% que aplica
  billing). No es error de wiring: billing registra la diferencia en
  `posTotalsDiffCents`. Decidir si la caja debe mandar `tax` e incluir IVA para que
  `posTotalCents` coincida con el total de la factura.
- **Stock no probado**: `inventory-service` no corre en el stack local; la validación
  de stock en `sales.routes.ts` sigue deliberadamente deshabilitada (ver `todo.md`).
- **SRI no probado**: `fiscal-ecuador` no corre; la factura queda en `issued`, nunca
  se envía ni autoriza.
- **El POINT_TYPE y el ruteo del hub**: la desvinculación remota funciona de verdad a
  través de RabbitMQ (outbox-relay de org → exchange → consumidor del gateway → sala
  `device:<deviceId>` del POS). Requiere `RABBITMQ_URL` seteado y RabbitMQ arriba.

**Siguiente paso obligatorio:** revisión del dueño de los diffs A y B (no se
commitearon), y luego decidir C (IVA en caja). Después se puede retomar el
instalador/OS (parado en el TODO).

---

## 2026-09-25 — Sesión: IVA por producto en la caja

**Qué se hizo:** la caja ahora calcula el IVA de cada línea con la tasa **de ese producto**
y cobra lo mismo que dirá la factura del CRM. Antes el impuesto era un campo manual (por
defecto 0) y una venta de 8,75 salía facturada por 10,06.

**Por qué así (para que nadie lo "simplifique"):**
1. **El IVA es individual por producto** (IVA 15%, IVA 0%, no objeto de IVA; con o sin IVA
   incluido en el precio). No existe una tasa general. `product-service` devuelve `taxes`
   en `GET /products` (una consulta por página) y el `pull` baja las tasas del país
   (`GET /countries/:cc/tax-rates`, país = claim `country_code` del JWT del terminal) y guarda
   en cada producto sus tasas ya resueltas: `products.taxes = [{ taxRateId, kind, percentage }]`
   y `products.priceIncludesTax`. Así funciona sin conexión.
2. **Un producto con `taxes = null` NO se vende** (venta rechazada con mensaje): asumir "sin
   IVA" haría que la caja cobre menos de lo que facture el CRM. Se arregla sincronizando.
3. **El cálculo replica a billing-service operación por operación** (`src/tax/sale-totals.ts`
   vs `addLineInTransaction`): mismo `Math.round`, mismo orden. Si billing cambia su regla de
   redondeo o de precio con IVA incluido, hay que cambiar el POS igual. Lo vigila
   `scripts/paridad-iva.mjs` (crea productos con tasas distintas en un CRM de DESARROLLO, hace
   ventas aleatorias y compara cada factura real con lo que calculó la caja) y los 20 tests de
   `src/tax/sale-totals.test.ts` (`npx tsx --test src/tax/sale-totals.test.ts`).
4. **El descuento de la venta se reparte por línea** (billing solo admite descuento por línea),
   proporcional y sumando exacto (`allocateDiscount`), y se manda como `discountCents`.
5. **`sale.subtotal` ahora es la base imponible** (sin IVA, ya descontada), igual que la factura;
   `sale_items.subtotal` es la base de la línea, `taxAmount` su IVA y `taxes` el desglose.
   Las 3 ventas de prueba anteriores a este cambio conservan la semántica vieja.
6. **El carrito no duplica el cálculo:** el frontend pide `POST /sales/preview` (el mismo código
   que guarda la venta). El campo "Impuesto" manual desapareció; `tax` en `POST /sales` se ignora.
7. El `pull` ahora recorre todas las páginas del catálogo (antes solo los primeros 50 productos).

**Verificado:** 117 ventas aleatorias contra el billing real (Docker local), 7 productos de tasas
distintas, cantidades decimales y descuentos de hasta 30%: subtotal, IVA y total idénticos en todas.
La verificación visual de la pantalla del carrito la hace el dueño.

**Queda abierto / advertencias:**
- Si el CRM tiene una `product-service` anterior (sin `taxes` en el listado), los productos quedan
  con `taxes = null` y no se pueden vender: desplegar primero `product-service`.
- billing responde "El perfil fiscal de la organización no está completo" cuando en realidad no
  pudo contactar a organization-service (timeout): el mensaje engaña. Es un fallo de billing, no del POS.
- El `/sync/run` manual se descarta en silencio si ya hay un ciclo en curso.
- Los tipos de retención (`withholding_*`) no se modelan en la caja (un producto de venta solo lleva IVA).

## 2026-08 — Sesión: flujo de emparejamiento TOTP

**Qué se hizo:** Se diseñó e implementó un flujo de emparejamiento tipo
Google Authenticator entre el POS y el CRM (`cmr-proyect`), tocando 4 repos:
`organization-service`, `auth-service`, `api-gateway-node`, y `pos/` (backend
+ frontend).

**Por qué (en orden de cómo se llegó a esta decisión):**
1. El dueño del proyecto preguntó "a quién le pertenece este POS" — no había
   forma de saber a qué organización/punto de emisión pertenecía una
   instalación del POS.
2. Se descartó un modelo de usuario/contraseña fijo en `.env` porque (a) no
   escala a "instalar y listo" para alguien no técnico, y (b) filtrar
   credenciales de admin en un archivo de config en un kiosco físico es un
   riesgo de seguridad real.
3. Se eligió TOTP porque: es el mismo patrón que ya conoce cualquiera que use
   un autenticador, no requiere que el POS tenga conectividad *antes* de
   configurarse (el código se lee, no se descarga), y el punto de emisión
   queda determinado sin ambigüedad por cuál código se usó.

**Qué queda como consecuencia:**
- El backend del POS **ya no usa `ADMIN_API_EMAIL`/`ADMIN_API_PASSWORD`** —
  si ves referencias a eso en código viejo o en la memoria de una sesión
  anterior, están obsoletas. La fuente de credenciales ahora es
  `pos_config.refreshToken`, sembrado por `POST /setup/pair`.
- `organization-service` y `auth-service` tienen código nuevo que **nunca se
  compiló** (ver `todo.md` → 🧪 Validación pendiente). No asumas que
  funciona solo porque está escrito.
- El endpoint `POST /billing-points/pair` es **intencionalmente público**
  (sin JWT). No es un descuido de seguridad — es el único bootstrap posible.

**Siguiente paso obligatorio:** correr `docker compose build` en los 3
servicios de infraestructura tocados (`organization-service`, `auth-service`,
`api-gateway-node`) y las migraciones — Docker no hace hot-reload de código
fuente. Ver `todo.md` → 🔴 Bloqueante.

---

## 2026-08 — Sesión: pivote de "backend con MySQL propio" a "caché + cola de sync"

**Qué se hizo:** Se reescribió el backend del POS dos veces.

**Por qué:**
1. Primera versión: se construyó un backend Node/Prisma/MySQL asumiendo que
   el POS sería dueño de sus propios datos (productos, ventas, usuarios,
   todo local, sin conexión a nada externo).
2. El dueño del proyecto aclaró que ya existe un admin (`cmr-proyect`) con
   todo el catálogo — el POS solo necesita **descargar** datos para poder
   funcionar offline, no ser una fuente de verdad paralela.
3. Se pivotó a: SQLite/MySQL local como **caché**, con un módulo de sync
   (`pull.ts`/`push.ts`) contra la API real del CRM. Se eligió MySQL (no
   SQLite) por decisión explícita del dueño: "más seguro, no pesa tanto,
   permite migraciones".
4. Al revisar `product-service/openapi.yaml` real, se descubrió que:
   - Los IDs son UUID, no autoincrement → se cambiaron todos los `remoteId`
     de `Int?` a `String?`.
   - `product-service` **no maneja stock todavía** (`trackStock` es un flag
     reservado a una fase futura) → se decidió explícitamente **quitar** la
     validación de stock del POS ("venta siempre permitida"), no simularla.
   - `billing-service` (donde vivirían las facturas) **no existe** → el
     `push` de ventas queda apuntando a un endpoint placeholder
     (`/invoices/from-pos`) que fallará siempre hasta que ese servicio
     exista. Esto es esperado, no un bug — las ventas se acumulan en la cola
     local sin pérdida.

**Qué queda como consecuencia:**
- Si un agente ve que `sales.routes.ts` no valida stock, o que `push.ts`
  siempre tira error, **no es un bug a arreglar** — es el estado esperado
  hasta que existan `inventory-service`/`billing-service` en el CRM.
- Hay una carpeta vieja `_zz_no_usar_backend_viejo` (o similar, revisar si
  sigue existiendo) del primer intento — se puede borrar, no se usa.

---

## Antes de esto: el objetivo original

La conversación empezó planificando un **instalador/OS completo** (ISO de
Ubuntu autoinstalable, modo kiosco, auto-updater tipo Discord) para distribuir
el POS a clientes no técnicos. Esa parte **no se empezó a programar todavía**
— se pausó para construir primero el POS en sí (backend + frontend +
emparejamiento). Sigue en el TODO como pendiente de decisión: ¿retomarlo
ahora, o seguir consolidando/probando lo que ya existe?

---

## Cómo agregar una entrada nueva

Cuando termines una sesión de trabajo real (no cambios triviales), agrega una
entrada arriba con: **qué se hizo**, **por qué** (la decisión, no solo el
cambio técnico), y **qué queda como consecuencia** (qué código nuevo depende
de esto, qué quedó obsoleto, qué es lo siguiente obligatorio). El objetivo es
que alguien —humano o agente— que no estuvo en la conversación original pueda
entender la trayectoria sin tener que adivinar el "por qué".
