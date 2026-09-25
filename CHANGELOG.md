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
Del OS (capas 2–6 del HANDOFF) están hechas la 2 (pantalla servida por el backend,
un solo origen) y la 3 (empaquetado + firma en Docker con `build-release.sh`);
falta la CI de publicación (3b) y las fases 4–6 (provisión, kiosco, ISO).
Pendientes no-código: decisión de IVA en la caja y stock real.

---

## 2026-09-25 — Sesión: Fase 3b del OS — CI de publicación en GitHub Releases

**Qué se hizo:** `pos/.github/workflows/release.yml`. Al empujar una etiqueta
`v*.*.*`, se construye en `ubuntu-latest` con el MISMO `build-release.sh` (docker),
se firma con el secreto `RELEASE_SIGNING_KEY` (la clave privada se escribe a un
archivo temporal `chmod 600` y jamás se imprime) y `gh release create` sube
`latest.json` + `facturero-pos-<v>.tar.gz` con el `GITHUB_TOKEN` del workflow
(`permissions: contents: write`). `releases/latest` resuelve a la última release
no-borrador: es la URL fija que consultan los equipos.

**Por qué:** la fase 7 del diseño decidió GitHub Releases como repositorio de
actualizaciones; esto automatiza la publicación para que el dueño solo cree la
etiqueta. Como `facturero/pos` es público, los equipos descargan sin token.

**Qué se decidió:**
- La clave **pública** se versiona en `os/release/release-public.pem` (paso del
  dueño: copiarla al repo); `install.sh` la copiará a `/etc/facturero/` (fase 4).
- El CI **no** usa `--smoke` (no hay MySQL local en el runner); el smoke queda
  para la máquina de desarrollo. El build+firma es idéntico al de la fase 3.
- Los pasos del dueño quedaron en `os/DISENO.md` (generar claves, crear el
  secreto, copiar la pública, crear la etiqueta).

**Verificación:** YAML validado con Ruby/Psych en contenedor (estructura: `on`,
`permissions`, `runs-on`, steps; ojo: YAML 1.1 convierte `on:` en booleano — el
parseo de GitHub no lo hace). **NO se pudo ejecutar**: no hay token del workflow
ni etiqueta real; requiere además la clave privada del dueño. Cuando exista una
`v0.1.0` real, el workflow la firmará con la clave buena.

**Siguiente paso:** fases 4–6 (provisión Ubuntu, kiosco, ISO) — se escriben y
validan sin VM (reglas del HANDOFF).

---

## 2026-09-25 — Sesión: Fase 3 del OS — empaquetado y firma de versiones

**Qué se hizo:** `os/release/build-release.sh` construye una versión dentro de un
contenedor `node:22-bookworm-slim` (el repo se monta SOLO lectura; nada de
`node_modules` de desarrollo se toca) y firma el paquete con `sign-release.mjs`.
El stage queda con: `backend/dist`, `backend/package*.json`, `backend/node_modules`
**solo de producción**, `backend/prisma` (schema + migraciones), `frontend/dist` y
`VERSION` (en la raíz y en `backend/dist`). `--smoke` arranca el paquete ya firmado
contra el MySQL del compose local (vía `host.docker.internal`) y comprueba `/health`
y que la pantalla se sirve. Correr sin `--key` solo arma el stage.

**Por qué:** la regla 3 de `os/DISENO.md` — el paquete debe llevar los motores de
Linux (argon2 + query engine de Prisma/OpenSSL3). Construir en un contenedor
garantiza el entorno correcto y reproducible, y separa el empaquetado del
`node_modules` del equipo de desarrollo.

**Decisiones (todas con su porqué en los comentarios del script):**
- **`prisma` pasó de `devDependencies` a `dependencies`** (backend): el actualizador
  corre `prisma migrate deploy` desde el `node_modules` de producción; con
  `--omit=dev` la CLI desaparecía y cada actualización habría fallado en migrar.
  `package-lock.json` regenerado (diff mínimo: solo cambia de sección).
- **`node:22-*-slim` NO trae `openssl`**: sin `libssl`, Prisma detecta
  "openssl-1.1.x" y no encuentra el motor `debian-openssl-3.0.x` que llevamos. El
  contenedor de build y el de smoke instalan `openssl`. En los equipos objetivo
  (Ubuntu 24.04) OpenSSL3 viene por defecto.
- **Git Bash (MSYS) no puede pasar stdin a `docker.exe`**: el script interno del
  contenedor va montado como archivo (`/inner/inner.sh`).
- **`node` de Windows no entiende rutas POSIX de Git Bash** (`/c/…` → `C:\c\…`, y
  `pwd` normaliza el TEMP a `/tmp/…` → `C:\tmp\…`): al firmar, el stage y el out se
  pasan con `cygpath -w`.
- **`VERSION` se escribe dos veces**: en la raíz del stage (lo hace `sign-release`,
  es el que ve el layout del actualizador) y en `backend/dist/VERSION` (donde lo
  lee `/health`, relativo al `dist`).

**Verificación (todo corrido, no solo escrito):**
- Build completo en el contenedor: `tsc` + `prisma generate` + `npm ci --omit=dev`
  con chequeo de que `node_modules/.bin/prisma` existe, y frontend con
  `vue-tsc --noEmit && vite build`. Stage: 104 MB.
- Firma: `facturero-pos-0.1.0.tar.gz` = 40,824,414 bytes (~39 MB) + `latest.json`.
- Smoke con clave de prueba contra el MySQL local: `/health` →
  `{"status":"ok","version":"0.1.0"}` y `GET /` sirve el HTML.
- Cadena de integridad cerrada: `verifyManifest` (del propio actualizador) acepta
  el `latest.json` con la clave pública de prueba y el `size` coincide.
- `updater.test.mjs`: 10/10 en verde (sigue igual tras los cambios).
- Contenido del paquete revisado (`tar -tzf`): `backend/`, `frontend/`, `VERSION`
  (x2) y `node_modules/.bin/prisma`.

**No probado**, por no tener Linux real: la instalación en el equipo destino
(MySQL del sistema, systemd, sudoers). El smoke cubre el arranque del paquete
COMPILADO en Linux con una BD MySQL real, que es lo que el actualizador va a
hacer tras descomprimir.

**Siguiente paso:** fase 3b — `pos/.github/workflows/release.yml` (CI que construye
en `ubuntu-latest`, firma con el secreto `RELEASE_SIGNING_KEY` y sube a GitHub
Releases); y después las fases 4–6 (provisión, kiosco, ISO).

---

## 2026-09-25 — Sesión: Fase 2 del OS — la pantalla la sirve el propio backend

**Qué se hizo:** con un solo origen quedó listo el "kiosco": el backend compilado
sirve el `frontend/dist` desde `127.0.0.1:4000` (`POS_FRONTEND_DIST`), `/health`
ahora verifica la base con `SELECT 1` y reporta la versión de un archivo `VERSION`
que va junto al dist, Prisma lleva el motor de Ubuntu 24.04
(`binaryTargets = ["native", "debian-openssl-3.0.x"]`), el frontend usa URLs
relativas en producción (`client.ts` y `localSocket.ts` con `import.meta.env.PROD`),
el socket local (socket.io de `pos.unlink`/`sync.status`) se monta sobre el MISMO
server :4000, y `tauri.conf.json` abre la webview en `http://127.0.0.1:4000`.

**Por qué:** la regla 4 de `os/DISENO.md` — el kiosco debe arrancar y operar sin
la nube y sin servidor de desarrollo; que el backend sirva la pantalla y que Tauri
solo apunte a una URL hace que la pantalla se actualice con el resto del paquete.

**Qué se decidió (consecuencias de diseño):**
- **Dos puertos de socket según modo:** en producción el socket local vive en el
  mismo :4000; en desarrollo se mantiene en `LOCAL_SOCKET_PORT` (4001) aparte, como
  estaba. `startLocalSocket` acepta un server para montarse encima.
- **SPA en modo history solo para navegadores:** las rutas inexistentes responden
  `index.html` únicamente a GET con `Accept: text/html`; una API inexistente
  responde 404 JSON.
- **`VERSION` es artefacto del release:** en desarrollo no existe el archivo y
  `/health` responde sin `version`. Lo genera el empaquetado (fase 3).
- **Imágenes de producto sin token**: se sirven desde el mismo origen, solo
  `127.0.0.1`; un `<img>` no puede mandar cabecera de autorización.
- **Tauri no se pudo compilar** en la máquina de desarrollo (sin toolchain Rust);
  solo se ajustó la configuración. El 401 de `/sync/status` sin sesión es esperado
  (la pantalla lo consulta al cargar) y no es fallo de esta fase.

**Verificación (modo producción real, hecha por el dueño en :4000):** 200 en
`/health` con versión y chequeo de BD; `GET /` sirve la pantalla con sus assets;
`/history` y `/setup` sirven `index.html` solo con `Accept: text/html`; API
inexistente → 404 JSON; `/products` y `/sales/…` → 401 sin token (las rutas de API
van antes que la pantalla); socket.io `/ws` conecta por websocket en el mismo
puerto; la pantalla carga y redirige a `/login` sin peticiones cruzadas.
`tsc --noEmit`, `vue-tsc --noEmit` y `npm run build` de ambos pasan.

**Siguiente paso:** fase 3 — `os/release/build-release.sh` empaqueta el dist del
backend + frontend + motor de Prisma Linux y genera `VERSION`; luego las fases 4–6
(provisión Ubuntu, kiosco, ISO).

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

## 2026-09-25 — Sesión: imágenes de producto, historial por días

**Imágenes:** `product-service` ya devuelve `imageFileId` (imagen principal) en `GET /products`. El POS
lo guarda en `products.imageFileId` durante el pull y `src/sync/images.ts` descarga los bytes a disco
(`data/product-images/<fileId>`, configurable con `POS_IMAGES_DIR`): pide el enlace firmado a
`GET /files/:id/url` (document-service, con el token del POS) y baja el archivo. Se hace **en segundo
plano** tras el pull, sin retrasar el envío de ventas; una imagen que falla se reintenta en el ciclo
siguiente y el producto se ve sin foto mientras tanto. Como el CRM le pone otro id a una imagen
cambiada, "ya está en disco" = "está al día"; las que ya nadie usa se borran. Se sirven por
`GET /product-images/:fileId` **sin token** a propósito (un `<img>` no puede mandarlo; el backend solo
escucha en 127.0.0.1). El botón de imagen junto al buscador de la caja las muestra u oculta (preferencia
de esa caja, en `localStorage`; activado por defecto). Prueba sin document-service:
`npx tsx scripts/prueba-imagenes.mjs`. **No verificado contra document-service/MinIO reales** (no corren
en el Docker local): falta comprobar que el enlace firmado sea alcanzable desde el equipo del POS.

**Historial:** ya no hay botón "Sincronizar ahora" (el usuario no controla la sync); muestra solo los
últimos 3 días, con separador por día y numeración de ventas que reinicia cada día (solo visual; el id
real sigue siendo el que se usa para anular y sincronizar).

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
