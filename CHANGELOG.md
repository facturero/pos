# CHANGELOG — POS

Este archivo es contexto para agentes (opencode, etc.), no solo un historial
para humanos. Cada entrada explica **qué se hizo, por qué, y qué queda como
consecuencia** — para que un agente que lea esto no "corrija" algo que en
realidad fue una decisión deliberada, y sepa exactamente por dónde seguir.

Antes de tocar código, lee también `rules.md` (reglas fijas) y `todo.md`
(lista de tareas). Este archivo es el "por qué llegamos hasta acá".

---

## Estado actual en una frase

El sistema operativo del POS está **hecho y probado de punta a punta en VirtualBox**
(2026-09-28): ISO autoinstalable de Ubuntu 24.04.5 (menú "Instalar POS KIOSKO") → primer
arranque → kiosco → emparejamiento con un código real del CRM, con la marca **POS KIOSKO
(un producto de noahsolutions)**, y la app se actualiza sola desde GitHub Releases
(`v0.2.0` a `v0.2.6` publicadas). El kiosco ya tiene apagar/reiniciar y Wi-Fi en la barra
de estado (Wi-Fi sin probar con una tarjeta real). Quedan sin probar: UEFI, hardware real,
y el CI de publicación automática (`release.yml`, cada release hasta ahora se armó a
mano). Ver `HANDOFF-pos-os.md` para el detalle completo. Pendientes no-código: decisión
de IVA en la caja y stock real (siguen abiertas de sesiones anteriores).

---

## 2026-10-05 — Prueba AUTOMÁTICA de usuarios, roles, permisos y desactivación (sin release: solo pruebas)

`npm run test:e2e` (en `pos/backend`; usa Docker) levanta un CRM simulado en localhost con la forma de auth-service (`/users` con `permissions`,
`/roles`, `/permissions`, `/auth/refresh`, `/auth/login`), una base SQLite temporal con las migraciones REALES, y ejecuta el `pullFromAdmin()` y las rutas
de login/sesión reales de la caja. No necesita el CRM ni credenciales. Corre en Linux dentro de Docker (mismo entorno que las releases) porque el binario
nativo de argon2 lo bloquea el control de aplicaciones de algunas máquinas Windows. `npm test` corre las pruebas unitarias de sync.
**16 escenarios:** entra quien tiene `pos:access` (Vendedor, Administrador→rol ADMIN) y no quien no (Solo lectura, Contador → 403); decide el permiso y no el
nombre (rol personalizado); varios roles suman; quitarle el permiso a un rol cierra la sesión abierta (401) y devolverlo la recupera; `/users` sin
`permissions` (auth-service anterior) se calcula con los roles; deshabilitar/habilitar; quitado del establecimiento; lista vacía no desactiva a nadie;
cambio de contraseña (entra la nueva, la vieja no); contraseña incorrecta; usuario sin hash se valida contra el CRM y se vincula; CRM sin `pos:access` en
su catálogo (nadie queda fuera) y luego con él; fallo de roles/catálogo no tumba el sync; sin conexión; usuario local. **Comprobado que detecta fallos:**
rompiendo a propósito el control de `pos:access` y la comprobación de usuario activo, 6 de los 16 fallan.
No cubre (solo se verificó a mano en producción): el camino real RabbitMQ → gateway → socket, que cubre `catalog-routing.test.ts` en el gateway.

---

## 2026-10-05 — Permiso propio del POS: `pos:access` decide quién entra a la caja (0.3.12)

**Decisión del dueño:** "Solo lectura" no debe poder cobrar, y la caja debe decidir por PERMISOS, no por nombre de rol; y mejor un permiso
propio del POS, declarado en este proyecto, que el CRM asigna y manda con cada usuario.

**Cómo funciona**
- **Declaración:** `pos/backend/src/sync/permissions.ts` (`POS_ACCESS_PERMISSION = "pos:access"`). El CRM necesita además la fila en su
  catálogo para poder asignarlo a roles desde su editor: migración de auth-service `20261005200000-add-pos-access-permission.js`
  (descripción "Entrar a la caja POS y cobrar"). Por defecto lo reciben Administrador, Supervisor y Vendedor (los que cobraban);
  NO Contador ni Solo lectura (solo `invoice:read`); los roles personalizados no lo reciben, se les da desde el editor de roles.
- **Viaja con el usuario:** `GET /users` de auth-service devuelve ahora `permissions` (unión de los permisos de sus roles). La caja lo guarda en
  `users.permissions` (JSON; migración `20261005190000_user_permissions`). Si el auth-service es anterior y no lo manda, la caja lo calcula con `GET /roles`.
- **Quién entra:** login y middleware niegan a quien no tenga `pos:access` (login: 403 «Tu usuario no tiene acceso al POS…»; sesión abierta
  que pierde el permiso: 401 al siguiente request). Un usuario sin dato (`null`: creado en la caja, o aún sin sincronizar) entra como siempre.
- **Despliegue en cualquier orden:** si el catálogo del CRM aún NO tiene `pos:access` (caja actualizada antes que auth-service), la caja guarda
  `null` para todos y nadie queda fuera; en cuanto auth-service lo trae, se aplica. Si falla la consulta del catálogo/roles no se toca lo guardado
  y un usuario nuevo queda sin permisos hasta el siguiente sync.
- **Verificado en producción** (auth `2c54a59`, gateway `ae552d5`): el catálogo del CRM trae `pos:access` y lo tienen Administrador, Supervisor y
  Vendedor, no Contador ni Solo lectura; `GET /users` manda `permissions` por usuario; login de `lectura1` (Solo lectura) → 403 con el mensaje claro,
  `vendedor1`, `admin2` y el usuario local entran. Con un rol personalizado asignado a `lectura1`: darle `pos:access` al rol → la caja lo recibe en el
  mismo segundo (`identity.role.updated`) y `lectura1` entra; quitárselo → la sesión que ya tenía abierta recibe 401 y el login vuelve a negar.
  En el modo de compatibilidad (CRM sin `pos:access` aún) todos siguieron entrando. Quedó en el CRM el rol personalizado «Prueba POS (borrar)»
  (no hay endpoint para borrar roles ni para quitarlos de un usuario).
- **Tiempo real:** el gateway ya avisa `identity.role.*` e `identity.user.*` (`catalog.changed`): cambiarle permisos a un rol, o el rol a un usuario,
  llega a las cajas en segundos. Respaldo: cron de 5 min y sync al arrancar.

---

## 2026-10-05 — Usuarios CRM → caja: invitar, rol, deshabilitar, login, sin internet, reinicio (0.3.11)

**Prueba** (6 usuarios `pos.*@prueba.test` invitados por la API del CRM, correos en Mailtrap sandbox, contraseñas puestas a mano por el
dueño en los formularios de "Aceptar invitación"; inicio de sesión en la caja de la VM con esa contraseña de prueba):
| Cambio en el CRM | En la caja | Tiempo |
|---|---|---|
| Invitar usuario | llega (`identity.user.invited`), sin hash | ~4 s |
| Aceptar la invitación (poner contraseña) | llega el hash `argon2id`, login local OK | segundos |
| Asignar establecimiento | llega | ~4 s |
| Dar rol Administrador | pasa a ADMIN | ~1 s |
| Deshabilitar / habilitar | `active` 0/1, y el login se cierra/abre | ~1-2 s |
| Quitar del establecimiento | `active` 0 (lógica 0.3.9) | ~3 s |
Login con hash local OK; **sin internet** (CRM inalcanzable) sigue entrando quien ya tiene hash, y quien no lo tiene recibe
"Sin conexión con el CRM…". Tras **reiniciar la VM** los accesos se conservan. El login es por el CÓDIGO de 7 caracteres, no por correo.

**Fallo corregido (caja):** el middleware de auth solo verificaba la firma del JWT (12 h) y el rol del token. Un usuario deshabilitado
en el CRM **con la sesión ya abierta seguía trabajando** (`/products`, `/customers`, `/cash-sessions` → 200). Ahora cada petición
consulta al usuario en la base: desactivado o borrado → 401 "Tu usuario fue desactivado…", y el rol sale de la base, no del token.

**Contraseña restablecida: tres capas, como productos y clientes.** Medido: tras restablecer la contraseña en el CRM, la caja
seguía aceptando la vieja y rechazando la nueva hasta el ciclo programado (~2 min, máx. 5): el evento `identity.user.password_reset_completed`
no llevaba organización y el gateway no sabía a qué cajas avisar. Ahora (1) **tiempo real:** `auth-service` añade `organizationIds` (las
membresías activas del usuario) a `password_reset_completed` y a `profile_completed`, y el gateway (`catalog-routing.ts`,
`catalogRoutingOrgs`) los reenvía como `catalog.changed` a cada organización; (2) **respaldo:** el cron de la caja cada 5 min;
(3) **arranque:** sync completo a los ~5 s de iniciar el backend. La caja no cambió: no necesita release.
**Verificado en producción** (gateway `8ee0798`, auth `35305a7`): restablecer la contraseña de `pos.admin2` llegó a la caja por
`identity.user.password_reset_completed` → `catalog.changed` en ~3 s (el hash cambió y de las tres contraseñas probadas solo la nueva entró;
antes tardaba hasta el ciclo de 5 min y la vieja seguía valiendo).

**Hallazgos SIN corregir (decisión pendiente):**
- **Resuelto en 0.3.12 con el permiso `pos:access` (ver la entrada de arriba).** Rol "Solo lectura" y "Supervisor" del CRM se mapean a CASHIER en la caja (`pull.ts`: solo `Administrador` → ADMIN). Un usuario de solo
  lectura puede abrir/cerrar caja y, como `POST /sales` solo exige sesión, cobrar. No se hizo una venta real para no generar factura.
- `auth-service`: el controlador de `POST /users/invite` descarta `establishmentIds` (el caso de uso y el validador sí lo soportan): un
  invitado no queda en ningún establecimiento y no aparece en ninguna caja (los Administradores sí, se incluyen siempre).
- `auth-service`: no hay endpoint para QUITAR un rol (solo `POST /users/:id/roles`, que suma), y asignar un rol repetido da 500.

---

## 2026-10-05 — Caja apagada / token de emparejamiento vencido: la pantalla ya no miente ni se queda vieja (0.3.10)

**Prueba:** caja (VM) apagada de verdad, 9 cambios en el CRM (crear/editar/desactivar/borrar de productos, clientes, categoría,
contacto, dirección), encendida a los 60 s: el backend hace un sync completo a los ~5 s de arrancar y a los 172 s del
encendido (arranque de Ubuntu incluido) la base local tenía los 9 cambios. No depende de haber recibido los avisos.
**Días apagada:** el refresh token del emparejamiento dura 30 días (`JWT_REFRESH_TTL=2592000`) y se renueva en cada uso, así
que la ventana corre desde el último sync. Dentro de 30 días no pasa nada; pasados, el CRM responde 401 `INVALID_REFRESH_TOKEN`
y la caja necesita un código nuevo (re-emparejar). No se pudo esperar 30 días reales: se simuló con un token inválido
(respaldado en la VM y restaurado después). Con el token restaurado la caja se recuperó sola en el siguiente ciclo.

**Dos fallos reales que salieron de ahí (corregidos):**
1. Un pull que fallaba en todas las fuentes no dejaba rastro, y la barra de estado sale del ÚLTIMO registro de pull: seguía en
   "Sincronizado" (verde) aunque la caja llevara tiempo sin poder hablar con el CRM. Ahora se registra una fila `ERROR`
   (se reutiliza mientras siga fallando) y, si el CRM rechazó el token (400/401/403, marca `SESSION_EXPIRED`), la barra dice
   "Sesión vencida: vuelve a emparejar la caja"; un corte de red dice "Sin conexión con el admin".
2. La pantalla de venta pedía categorías y productos UNA vez al abrirse. Lo que el sync traía después estaba en la base pero no
   en pantalla (ocho minutos después seguían saliendo productos ya borrados). Ahora cada pull exitoso nuevo (`sync.status` por
   el socket local) recarga categorías y productos; si la categoría elegida desapareció, vuelve a "Todos".
Verificado en pantalla de la VM: producto nuevo del CRM aparece solo, desactivado desaparece solo, token roto muestra el
aviso, token restaurado vuelve a "Sincronizado".

**Sin probar:** usuarios (alta, rol, deshabilitar, contraseña) — necesita una invitación por correo real; una venta con el token
vencido (se queda pendiente y se sube al re-emparejar; no se hizo para no crear una factura en producción).

---

## 2026-10-05 — Prueba completa CRM → caja (clientes, contactos, direcciones, categorías, productos) y lo que reveló (0.3.9)

**Qué se probó** (CRM real vía API con la sesión del usuario, caja `pos-test-nuevo` con 0.3.8 real, base leída
directamente en la VM): crear / editar / desactivar / reactivar / borrar cada tipo y medir cuánto tarda en llegar.

| Cambio en el CRM | Llega a la caja | Latencia medida |
|---|---|---|
| Cliente creado (persona, empresa, sin identificación) | Sí, con tipo, RUC/cédula, email, teléfono | ~4 s |
| Contacto / dirección añadidos o editados | Sí | ~25-30 s (el aviso `customer.contact.*` / `customer.address.*` llega ~25 s tarde; causa sin investigar, el retraso es antes de la caja: el evento ya sale tarde del lado del CRM) |
| Cliente desactivado | Llega como `INACTIVE` | ~4 s |
| Producto creado / editado / precio / IVA / SKU | Sí, con categoría e impuestos | ~4-6 s |
| Producto desactivado y reactivado | Sí (0.3.8) | ~4 s |
| **Categoría renombrada** | Sí, **pero solo en el ciclo de 5 min** (no hay aviso en tiempo real) | 2 m 35 s |
| **Categoría borrada en el CRM** | **No: seguía en la caja para siempre** | nunca |
| **Producto sin categoría en el CRM** | **No: conservaba la anterior** | nunca |
| **Contacto / dirección borrados en el CRM** | **No: seguían en la caja** | nunca |
| **Cliente desactivado** | Llegaba `INACTIVE` pero **la caja lo seguía ofreciendo y se le podía vender** | — |

**Qué se arregló (POS, `pull.ts` / rutas):**
- Categorías borradas en el CRM se quitan de la caja **antes** del upsert (el nombre es único: borrar y recrear una
  categoría con el mismo nombre habría tumbado el sync entero con un choque de unicidad); sus productos quedan sin categoría.
- Un producto sin categoría en el CRM limpia la que tenía en la caja (`null`, no `undefined`, que Prisma ignora).
- Contactos y direcciones que el detalle del cliente ya no trae se borran (solo si el detalle se bajó bien).
- Usuarios quitados del establecimiento (la lista se pide filtrada, así que no llegan como inactivos, solo desaparecen)
  se desactivan en la caja; con lista vacía no se toca a nadie.
- El buscador de clientes de la caja solo ofrece clientes `ACTIVE`, y `POST /sales` rechaza un cliente desactivado con un
  mensaje claro (Consumidor Final id 1 siempre vale).

**Qué se arregló (api-gateway, `catalog-routing.ts`, hay que desplegar):** el hub ahora también avisa `catalog.changed`
para `product.category.*` y `identity.user.*` (deshabilitado, rol, establecimientos). Antes un usuario deshabilitado en el
CRM seguía pudiendo entrar a la caja hasta 5 min. **Verificado en producción** (gateway `47fa6c8` desplegado): crear, renombrar y borrar una categoría llegan a la caja por aviso
(`product.category.created/updated/deleted`) en ~13-25 s en vez de esperar el ciclo de 5 min. No son los ~4 s de los productos:
`update-category.ts` y `create-category.ts` añaden el evento al outbox fuera de la transacción del caso de uso (los de producto
lo hacen dentro del `uow`), así que esperan al sondeo del relay (~25 s). Mejorable en product-service, no en la caja.
**No cubierto a propósito:** `tax.tax_rate.upserted` no lleva
`organizationId` (las tasas son por país), no hay sala a la que avisar; un cambio de tasa sigue entrando por el ciclo de 5 min.

**Sin probar todavía:** alta de usuario (la invitación envía un correo real y el token solo llega por ese correo) y cambio
de contraseña de un usuario; no se tocaron los 5 usuarios reales del CRM.

---

## 2026-10-05 — Sync: un producto desactivado en el CRM ya se quita de la caja (0.3.8)

**Qué pasó:** al desactivar los 5 productos de prueba en el CRM (el servicio de productos no tiene borrado,
solo `POST /products/:id/disable`), la caja `pos-test-nuevo` recibió los 5 avisos `product.product.disabled`
y siguió mostrando y cobrando los 5 como activos. Causa: el POS pide la lista con `?status=active&…`
(`fetchRemoteProducts`), así que un producto desactivado —o quitado del establecimiento de la caja— no llega
como "inactivo": **deja de aparecer**; y `pull.ts` solo hacía `upsert` de lo que llegaba, nunca desactivaba
lo que faltaba. El `active: rp.status === "active"` que ya existía nunca llegaba a ver un producto inactivo.
Efecto en un negocio real: un producto retirado en el CRM seguía vendiéndose en la caja, y facturación lo
recibía igual.

**Arreglo:** tras el `upsert`, `pull.ts` desactiva (no borra: las ventas ya hechas apuntan a esas filas) los
productos locales activos con `remoteId` que el CRM ya no lista. El cálculo está en `stale.ts`
(`staleRemoteIds`, 5 pruebas en `stale.test.ts`). Solo se ejecuta si la descarga salió bien (`request()`
lanza ante cualquier error), no con una respuesta a medias. La venta ya rechazaba productos inactivos y la
pantalla solo lista los activos, así que no hizo falta tocar nada más. Un producto que vuelve a activarse
reaparece en la lista y el `upsert` lo reactiva.

**Comprobado que NO tiene el mismo problema:** usuarios y clientes se piden al CRM sin filtro de estado
(`/users`, `/customers`), así que sus desactivaciones llegan con `status` y se aplican (`active: ru.status ===
"active"`, `status: … "INACTIVE"`). No se evaluó el caso de eliminación definitiva en el CRM (si existiera).

---

## 2026-10-05 — Sync: un aviso del CRM con un ciclo en marcha ya no se pierde (0.3.7)

**Qué pasó:** al crear 5 productos casi a la vez en el CRM (prueba de centavos con decimales), la caja
`pos-test-nuevo` recibió 4 por tiempo real y el quinto ("Queso fresco") no apareció hasta forzar la
sincronización a mano. Causa: `runSyncCycle()` hacía `if (isSyncing) return;`, así que un `catalog.changed`
que llegaba con un ciclo ya corriendo se descartaba; el ciclo ya había leído el catálogo y el cambio no se
veía hasta el ciclo programado (5 min después). Afectaba a productos y a los clientes en tiempo real.

**Arreglo:** `backend/src/sync/coalesce.ts` — `coalesced(run)` no solapa ejecuciones y no pierde avisos: si
la llaman con `run` en marcha, anota que hace falta repetir y corre UNA vez más al terminar (cien avisos
juntos = una repetición). `scheduler.ts` exporta `runSyncCycle = coalesced(syncOnce)`. 7 pruebas en
`coalesce.test.ts` (node:test + tsx); comprobado que 3 de ellas fallan con el comportamiento viejo.

**Verificación de centavos (misma sesión):** venta de 24 líneas con 6 productos (precios con céntimos, IVA
incluido y no, 15% y 0%, cantidades decimales, descuento de $9,37): caja $294,56 = factura producción
`001-002-000000004` = cálculo exacto independiente, línea a línea y por tasa de IVA. Antes, venta de 18
líneas con cantidades de 4 decimales: $358,95 en las tres. Nota: en las líneas con IVA incluido, facturación
guarda `discount_cents` SIN IVA (127 → 110); es la conversión normal, la base coincide al céntimo.

---

## 2026-10-05 — Logo: el chip "POS" más cuadrado y "POS" y "KIOSKO" centrados a la misma altura

Midiendo la captura del kiosco real, el texto "POS" quedaba subido: 3 px de margen arriba y 12 abajo (el
relleno asimétrico de antes, `pt .06em / pb .1em`, estaba calibrado para otra tipografía). El hueco de una
línea de texto se reparte según las métricas de la fuente y las mayúsculas no tienen descendentes, así que
ningún relleno fijo sirve para todas las fuentes del tema. `BrandLogo.vue` ahora mide con canvas dónde cae
la tinta de "POS" en una línea de 1em y la desplaza para centrarla (se vuelve a medir cuando termina de
cargar la fuente). Además el chip es más "caja": esquinas casi rectas (`.08em`, antes `.16em`) y relleno
equilibrado, proporción 1,98:1 (antes 2,24:1). Medido en el kiosco real tras actualizar: 10 px arriba / 8
abajo (antes 3 / 12); validado también con seis tipografías en Chromium. Residual: ≤ 1 px horizontal por el
espacio lateral propio de la "P".

Segundo ajuste el mismo día (el dueño lo vio en la captura): "KIOSKO" quedaba unos píxeles MÁS ARRIBA que
"POS" porque solo se había corregido el texto del chip; la palabra se centraba por su caja de línea, que
tiene el mismo problema de métricas. Ahora las dos palabras se miden y se desplazan con la misma función.
Medido en el kiosco real (`pos-test-nuevo`): la tinta de ambas ocupa exactamente las filas 176–199 (diferencia
de centros: 0 px). Lección: al corregir un efecto óptico, medir TODAS las piezas de la composición.

---

## 2026-10-05 — Actualización "al estilo Discord": se baja sola y se aplica cuando no estorba

**Qué se hizo:** hasta hoy el actualizador aplicaba la versión en cuanto la descargaba (cada hora): paraba
el backend y reiniciaba la ventana aunque hubiera una venta a medias — el cajero podía perder el carrito.
Ahora la versión se baja y se prepara en segundo plano, y se activa en un buen momento. Política
acordada con el dueño: **se aplica al cerrar caja, o con el carrito vacío y 5 min sin tocar nada, o si no
hay pantalla conectada; el usuario puede adelantarla con "Actualizar ahora"; si no llega un buen
momento, se fuerza a los 3 días** (`build-release.sh --urgent` lo baja a 15 min para una versión crítica).

Piezas:
- `os/release/update-gate.mjs` (viaja DENTRO de la release, `backend/update-gate.mjs`): la "compuerta".
  Bloquea hasta que sea buen momento. Pregunta a `GET /system/update-gate` del backend en marcha; deja
  su estado en `update-gate.json` (para que la pantalla lo muestre) y atiende el archivo `update-now`.
  Si el backend que corre es ≤ 0.3.4 (sin ese endpoint) mira la base directamente (caja abierta = espera).
  **Regla de oro: un fallo suyo NUNCA bloquea una actualización** (cualquier error = se aplica).
- La llaman dos caminos, y el segundo sale al instante por una marca de 10 min: el actualizador nuevo
  (`gateCmd` en `updater.mjs`, antes de parar el backend) y el wrapper de `prisma`
  (`prisma-wrapper.sh`, antes de `migrate deploy`). **El segundo es el que alcanza a las cajas ya
  instaladas**: su actualizador viejo no puede cambiar sin ISO, pero ejecuta el `prisma` de la
  versión nueva — que ahora espera la compuerta antes de tocar nada. La versión vieja sigue sirviendo
  mientras tanto. Ojo: el actualizador viejo mantiene su `updater.lock` durante la espera (los avisos
  "otra actualización está en curso" de las corridas siguientes salen con código 3, que la unidad ya
  trata como éxito).
- `backend/src/system/update.ts` + rutas `/system/update-status`, `/update-gate`, `/activity`,
  `/update-now`: el backend ve la caja abierta y el latido de la pantalla (carrito + tiempo ocioso).
- `frontend/src/composables/useUpdates.ts` + `StatusBar.vue`: latido cada 10 s, aviso "Actualización
  vX lista · se aplicará sola al cerrar caja o sin actividad" con botón "Actualizar ahora" (confirma
  que se pierde el carrito), y recarga automática si la versión del backend cambia (así la ventana se
  pone al día aunque el actualizador de la caja no la reinicie).

**Qué queda como consecuencia:**
- El primer salto desde una caja con backend ≤ 0.3.4 solo sabe de "caja abierta/cerrada" (la base no
  guarda el carrito ni la actividad); desde la siguiente versión ya hay carrito y ocio.
- La app de escritorio (Windows) NO usa esto: se actualizará con `electron-updater`; en modo desktop no
  hay directorio de estado y los endpoints devuelven "sin actualización pendiente".
- Si se usa `--urgent`, la caja espera como mucho 15 min a un buen momento.

---

## 2026-10-04/05 — Las cajas no podían actualizarse: causa raíz (WAL) y arreglo que viaja DENTRO de la app

**Qué se hizo:** al probar la actualización 0.3.3 → 0.3.4 en la VM `pos-test-ssh1` falló con `database
is locked`: 6 intentos en ~80 s, todos fallidos, aunque la VM ya tenía los reintentos de 2026-09-29
(que por tanto NO arreglaban nada: el diagnóstico "choque momentáneo" era erróneo).

**Causa raíz (verificada con experimentos sobre copias de la base):** el backend pone la base en modo
**WAL** al arrancar (`db.ts`) y el `schema-engine` de Prisma, con la base en WAL, necesita acceso
exclusivo. Con otra conexión abierta (el backend de la pantalla) falla SIEMPRE, incluso sin
migraciones pendientes:

| Caso | `prisma migrate deploy` |
|---|---|
| base en WAL + otra conexión abierta | `database is locked` |
| base en modo DELETE + otra conexión abierta | migra bien |
| base en WAL sin otra conexión | migra bien |

Python escribe en esa misma base sin problema: no es un bloqueo de SQLite, es del schema-engine.

**Restricción de diseño del dueño:** el producto es multi-organización; no se puede ir caja por caja
con SSH. El arreglo tiene que llegar con la propia actualización de la app. El problema: el
actualizador, su `updater.json` y el sudoers son capa del sistema operativo y NO se actualizan con la
app. Lo único de la release que el actualizador viejo ejecuta es `./node_modules/.bin/prisma migrate
deploy` desde la versión nueva — y ESO sí viaja en el paquete.

**Arreglo integrado en la app (llega a las cajas ya instaladas, sin SSH ni ISO):**
1. `backend/src/db.ts`: journal_mode **DELETE** (no WAL) + `synchronous=FULL` + `busy_timeout` primero.
   Con `connection_limit=1` toda consulta pasa por una sola conexión, así que WAL no aportaba
   concurrencia. Al arrancar convierte solo una base que viniera en WAL. A partir de ahí `migrate
   deploy` funciona con el backend vivo. Costo: `FULL` es algo más lento por escritura (irrelevante
   para un mostrador) y a cambio no hay riesgo de corrupción por corte de luz.
2. `os/release/prisma-wrapper.sh`, instalado por `build-release.sh` como `node_modules/.bin/prisma`
   del paquete. Para el primer salto, desde un backend viejo todavía en WAL: si `migrate deploy`
   falla con `database is locked`, detiene el backend de esa instalación (mismo usuario, sin sudo) y
   un vigilante lo mantiene muerto mientras dura el intento — matarlo una sola vez NO bastaba:
   systemd lo relanza a los 3 s y le ganaba la carrera al schema-engine (probado: 6 intentos, 6
   fallos). Solo mata procesos del mismo usuario, con cwd bajo `/opt/facturero` y `dist/index.js` en
   su línea de comando.
3. `frontend/src/main.ts`: al fallar la carga de un chunk (`vite:preloadError`) la pantalla se
   recarga (con enfriamiento de 30 s). Cubre a las cajas cuyo actualizador viejo no reinicia la
   ventana: sin esto pedía assets con hash viejo → 404 (visto el 2026-09-30).

**Mejoras de capa de SO para ISOs NUEVAS** (no llegan a las ya instaladas; las nuevas no las
necesitan para actualizar gracias a lo de arriba, pero son más limpias): `updater.mjs` acepta
`stopCmd` (para el backend antes de migrar y lo devuelve al aire si la migración falla; si el parado
falla no marca la versión como mala), `restart-app.sh` gana el argumento `stop` y también reinicia la
ventana del kiosco, `updater.json` trae `stopCmd`. 16 tests del actualizador en verde.

**Verificado en la VM** dejándola como la peor caja posible — actualizador viejo, sin `stopCmd`, sin
`restart-app.sh`, sin permiso de sudo para parar el backend, base en WAL — y lanzando el actualizador
real contra una 0.3.5 con estos cambios: 0.3.4 → 0.3.5 en **19 s, `exit=0`**, "migraciones… →
`database is locked` → [prisma] detengo el backend → `No pending migrations` → listo", `/health` en
0.3.5, base en modo `delete`, 0 errores 404 de assets.

**Qué queda como consecuencia:**
- **Ninguna caja ya instalada necesita intervención manual**: reciben esto como cualquier release.
  Si una caja estaba marcada con `0.3.4` mala por este bloqueo, se recupera con la siguiente versión
  (`0.3.5` no está en su lista).
- Las cajas instaladas seguirán sin `stopCmd`/`restart-app.sh` hasta una ISO nueva; no es urgente.
- Los tags `v0.3.1`–`v0.3.3` apuntan a `44d498c`, que no tiene los arreglos con los que se armaron
  esas releases; los paquetes publicados son correctos. `v0.3.4` sí apunta al commit bueno.
- Se evaluó y descartó un parche por SSH (`patch-box.sh`): no escala a un producto multi-organización.

---

## 2026-09-30 — Sesión: `restartCmd` también reinicia la ventana; arranca `pos/desktop/` (Electron) para Windows

**Qué se hizo:** dos cosas independientes. La primera cierra un cabo suelto de la sesión anterior
(el bug de la ventana con caché vieja, encontrado a mano en esa VM). La segunda arranca un
**proyecto nuevo y separado** para distribuir el POS como `.exe` de Windows, sin tocar `os/`
(kiosco/ISO) — pedido explícito del dueño: el `.exe` es solo para el cliente que quiere usar el
POS como una app de escritorio más, no reemplaza el equipo dedicado.

1. **`restartCmd` ahora reinicia backend Y ventana (Linux, kiosco).** La sesión anterior encontró
   (a mano, forzando una actualización real) que tras cambiar `current` y reiniciar solo el
   backend, la ventana Tauri se quedaba con los nombres de archivo `.js` con hash de la build
   vieja (Vite) y pedía un asset que ya no existía (404) al navegar — se arregló a mano esa vez
   matando el proceso para que `launch.sh` la relanzara. Ahora es parte del flujo normal:
   `os/provision/restart-app.sh` (nuevo) hace las dos cosas — `systemctl restart
   facturero-backend` y `pkill -f facturero-pos-app` (`launch.sh` ya la relanza sola) — y es lo
   único que `updater.json`/`restartCmd` invoca. La regla de sudoers pasó de autorizar dos
   comandos `systemctl` sueltos a autorizar este único script (root:root 0755, `facturero` no
   puede editarlo) — más simple de razonar y ya no depende de que el actualizador arme la línea de
   systemctl correcta.
2. **`pos/desktop/` (nuevo, Electron) — el `.exe` de Windows "como Discord".** Primer intento de
   esta sesión fue reusar el binario de Tauri del kiosco con una ventana Windows + un supervisor en
   PowerShell hecho a mano (`watchdog.ps1`) — el dueño lo corrigió: mejor una librería hecha para
   esto, como Electron (que es literalmente lo que usa Discord), y como proyecto aparte para no
   mezclar con `os/`. Se descartó ese primer intento (nada de PowerShell quedó) y se dejó
   `frontend/src-tauri/src/main.rs` exactamente como estaba — el kiosco Linux no cambia en nada.
   `pos/desktop/` reutiliza tal cual `pos/backend` (Node/Prisma/SQLite) y `pos/frontend` (el mismo
   build de Vite): el proceso principal de Electron levanta el backend como hijo usando el Node
   que el propio Electron ya trae adentro (sin depender de un Node del sistema, a diferencia del
   watchdog descartado) y abre una `BrowserWindow` normal apuntando a `http://127.0.0.1:4000` — la
   misma pantalla que ve el kiosco, sin fullscreen ni kiosk-lock. El auto-update queda para
   `electron-updater` contra GitHub Releases (no reimplementa `os/updater/updater.mjs`: ese sigue
   siendo solo del kiosco Linux).
   - Se mantiene `POS_MODE` (`kiosk` por defecto | `desktop`) en `backend/src/system/mode.ts`,
     expuesto en `GET /system/info` — sigue siendo útil aquí: Electron pone `POS_MODE=desktop` al
     levantar el backend, y `StatusBar.vue` ya oculta hora/apagar/reiniciar con eso (pedido
     explícito: "el .exe no debería tener apagar ni reiniciar ni la hora porque Windows ya hace
     eso"). `/system/poweroff` y `/system/reboot` también rechazan explícito (400) en modo desktop.

**Qué queda como consecuencia:**
- `pos/desktop/` trae `package.json` + `src/main.js` + scripts de empaquetado y un `README.md` con
  lo que falta. Primera versión (scaffold mío) NO arrancaba: el backend usa `argon2` (addon nativo)
  y el Node v20 embebido de Electron lo mataba en silencio, relanzado en bucle. Corregido en una
  segunda pasada (opencode, probado en ejecución): el `.exe` lleva su propio `node.exe` 22.14,
  migra antes de arrancar, log a archivo, instancia única, reintentos con tope. **Sigue sin haber
  `.exe` generado** ni icono ni `electron-updater` cableado; el login no se probó de punta a punta
  (una instalación nueva cae en el emparejamiento). Detalle en `pos/desktop/README.md`.
- `restart-app.sh` verificado en la VM `pos-test-ssh1` (2026-10-04): al ejecutarlo como
  `facturero` vía sudo cambian los PID del backend y de la ventana, `/health` responde, y la
  ventana pide los assets nuevos sin ningún 404. No se probó todavía un ciclo completo de
  actualización con una versión nueva publicada.
- El pipeline de release (`os/release/`) sigue siendo solo para Linux — no lo toca nada de esto.
  `pos/desktop/` no depende de `os/updater`; usa `electron-updater`, con su propio ciclo de
  publicación (ver `pos/desktop/README.md`).
- Nada de esto toca el camino de Linux/ISO ya probado: `POS_MODE` por defecto sigue siendo `kiosk`,
  el instalador sigue escribiéndolo explícito en `pos.env`, y `main.rs` quedó igual — un equipo ya
  instalado se comporta exactamente igual que antes.

---

## 2026-09-29/30 — Sesión: dos bugs reales de la 0.3.0 encontrados con una VM real, y arreglados

**Qué se hizo:** se probó la tematización (sesión anterior) de punta a punta contra una caja real
(VM con SSH, `pos-test-ssh1`, contra el CRM de producción) y salieron DOS bugs reales del
actualizador, ninguno relacionado con el tema en sí — el primero bloqueaba CUALQUIER
actualización de la app desde 0.2.6, y llevaba ahí desde antes de esta sesión:

1. **Permiso de ejecución perdido (bloqueaba TODA actualización).** `sign-release.mjs` empaquetaba
   el `.tar.gz` con el `tar` de Windows sobre una carpeta que Docker Desktop había montado desde
   el host. NTFS no tiene bit de ejecución: el motor de Prisma (`schema-engine-debian-openssl-3.0.x`)
   llegaba al equipo sin poder ejecutarse (`EACCES`), la migración fallaba, y el actualizador —con
   buen criterio— marcaba esa versión como mala PARA SIEMPRE (no la reintenta sola). El smoke test
   no lo detectó porque corre DENTRO de Linux, sobre el stage sin empaquetar. **Arreglo:**
   `build-release.sh` ahora arma el `.tar.gz` DENTRO del contenedor Linux (variable `/pkg`, mapeada
   a un directorio nuevo `${STAGE}.pkg`) y `sign-release.mjs` lo usa tal cual si recibe `--tarball`
   (si no, sigue empaquetando él mismo — lo necesita `os/updater/updater.test.mjs`, que arma su
   propio stage de prueba sin pasar por Docker).
2. **"database is locked" al migrar con la pantalla encendida.** `prisma migrate deploy` corre en
   un PROCESO APARTE del backend y no hereda el `PRAGMA busy_timeout=10000` que el backend se pone
   a sí mismo (`db.ts`); si la caja sigue viva (la barra de estado consulta `/system/info` cada
   10 s), puede chocar con SQLite un instante. Antes de este arreglo, ESE choque —puramente
   momentáneo— también dejaba la versión mala para siempre. **Arreglo:** `update()` en
   `updater.mjs` ahora acepta `migrateRetries`/`migrateRetryDelayMs` (opcional, por defecto 0 =
   comportamiento de siempre) y `provision/updater.json` los activa (5 intentos, 3 s). Dos pruebas
   nuevas en `updater.test.mjs` (12 casos en total, todos en verde).
   **CORRECCIÓN 2026-10-04: este arreglo NO resuelve el problema.** El diagnóstico "choque
   momentáneo" era erróneo. Ver la entrada de 2026-10-04 arriba: con el backend encendido el
   bloqueo es permanente (la base está en WAL) y los reintentos no sirven; ver ahí la causa raíz y el arreglo.

**Un tercer hallazgo, de entorno, no de código:** en esa misma VM, `facturero-updater.timer`
(solo `OnBootSec`, sin `OnCalendar`) nunca calculaba su próxima corrida — pero le pasaba
IGUAL a `apport-autoreport.timer`, de Ubuntu, sin que lo hubiéramos tocado. Es una rareza del
reloj virtualizado de esa VM con temporizadores puramente monotónicos, no algo que rompimos.
**Arreglo defensivo:** se añadió `OnCalendar=hourly` junto al `OnBootSec=5min` que ya había en
`provision/units/facturero-updater.timer` — `OnCalendar` sí calculaba bien en esa misma VM, así
que ahora hay dos caminos y systemd dispara con el que llegue primero.

**Por qué importa la distinción (para quien lea esto después):** `os/updater` (el programa que
hace las actualizaciones) vive en la capa de SISTEMA OPERATIVO, no en la de app — por diseño no
se actualiza solo (ver `HANDOFF-pos-os.md`, "qué vive en la ISO"). Los dos arreglos de arriba
YA ESTÁN en el repo y beneficiarán la próxima ISO/reinstalación, pero una caja ya instalada con
una ISO vieja sigue con el `os/updater` de antes — a esa hay que actualizarla a mano una vez, o
reinstalarla, para que tenga los reintentos. La app en sí (`backend/`, `frontend/`) sigue
actualizándose sola sin tocar la ISO, como siempre.

**Releases publicadas para llegar hasta 0.3.3:** 0.3.0 (rota, bug 1), 0.3.1 (arregla bug 1), 0.3.2
(arregla bug 2), 0.3.3 (cambio menor de prueba, `autocomplete` en el login). Todas verificadas:
firma Ed25519, sha256 y tamaño contra lo publicado en GitHub, y el bit `+x` del motor de Prisma
dentro del `.tar.gz` descargado.

---

## 2026-09-28 — Sesión: tematización del POS (CRM + caja)

**Qué se hizo:** el cliente personaliza sus cajas desde el CRM. Un tema (colores, modo oscuro, tipografía,
forma, posición de los elementos, marca) se define UNA vez para toda la organización y, si quiere una caja
distinta, se le asigna otro solo a esa. Plan y decisiones en `IMPLEMENTATION-pos-theming.md` (raíz del proyecto).

- **CRM (`organization-service`, gateway, `frontend`)**: biblioteca de temas por organización (`pos_themes`),
  tema predeterminado, override por punto de emisión (`emission_points.pos_theme_id`), endpoint que resuelve el
  tema de una caja con ETag, evento `organization.pos_theme.changed` → el gateway avisa `pos.theme.changed`.
  Editor con vista previa en vivo, 4 puntos de partida (Clásico, Oscuro, Alto contraste, Cálido), aviso de
  contraste (el servidor rechaza < 3:1) e imágenes de marca.
- **Backend del POS (`src/theme/`, `routes/theme.routes.ts`)**: tabla `pos_theme` (migración
  `20260928164203_pos_theme`), `syncTheme()` (pide el tema con `If-None-Match`; 404 = CRM anterior a los
  temas, se ignora), `contract.ts` que SANEA campo a campo (un tema corrupto nunca deja la caja inservible;
  ignora campos desconocidos; valida los `fileId` con la regla de las imágenes de producto), descarga de
  imágenes de marca a `data/theme-assets/`, `GET /theme` y `GET /theme/assets/:id` (sin autenticación a
  propósito: el login también lleva la marca). Se sincroniza en cada ciclo, al recibir `pos.theme.changed`, y
  se BORRA al desvincular (una caja reasignada no hereda la marca anterior). El tema nunca cuenta como fuente
  de datos del pull: si falla, la venta sigue.
- **Frontend del POS**: los colores dejaron de estar escritos en las clases. Tailwind usa tokens semánticos
  (`bg-surface`, `text-ink`, `bg-primary`...) que apuntan a variables CSS (`--c-*`) que `stores/theme.ts`
  rellena; radios, sombras, ancho de borde y densidad (solo relleno/separación) también son variables. Modo
  claro/oscuro/por horario + botón local del cajero (si el tema lo permite). Distribución: carrito
  izquierda/derecha y ancho, categorías arriba/lateral/ocultas, columnas, 4 tarjetas de producto, barra de
  estado arriba/abajo (nunca oculta). Fuentes EMPAQUETADAS (`@fontsource*`, solo subconjunto latino, carga
  perezosa por familia con la API FontFace). Componente `BrandLogo`: imagen de la empresa o, sin ella, el
  logotipo POS KIOSKO. Sin destello: `index.html` pinta las variables guardadas antes de montar Vue.
- **Pruebas**: 52 del backend del POS (incluye una de integración de punta a punta contra un CRM simulado con
  SQLite y las migraciones reales), 80 de organization-service, 13 del gateway, 78 del CRM. Verificado con
  capturas en navegador (Clásico ≈ aspecto anterior; temas oscuro/compacto con logotipo, cart a la izquierda,
  etc.).

**Por qué así (no "corregir"):**
- Las variantes (hover, tono suave, color del texto sobre el primario) las DERIVA el cliente; el tema solo
  guarda 10 colores por modo.
- El contrato se COPIA en tres sitios (organization-service, `pos/backend/src/theme/contract.ts`,
  `pos/frontend/src/theme/theme.ts` y `frontend/src/types/posTheme.ts`): son repos separados. Se comprobó que
  el tema "Clásico" es idéntico en todos; si se toca uno hay que tocar los demás.
- La densidad solo escala `padding`/`gap`/`space`, nunca anchos ni altos, y en "compacto" los botones no bajan
  de 40 px (regla en `style.css`; la barra de estado está exenta con `data-compact-exempt`).
- Un SVG de marca se dibuja SIEMPRE con `<img>` (no ejecuta scripts) y se sirve con CSP `sandbox`.
- Los temas NO son de pago (decisión del dueño).

**Qué queda como consecuencia:**
- Vive en la capa de APP: sale por release (0.3.0) y NO requiere regenerar la ISO.
- Orden de despliegue del CRM: `organization-service` → `api-gateway-node` → `frontend`. Un POS 0.3.0 con un CRM
  todavía sin temas funciona igual (el 404 se ignora).
- Sin probar: subida real de imágenes a document-service; `organization-service` no comprueba que un `logoFileId`
  exista ni sea de la misma organización (la caja lo valida al bajarlo).

---

## 2026-09-28 — Sesión: marca POS KIOSKO, error de red con NetworkManager, colores de la consola

**Qué se hizo:**
- **Marca**: en las tres pantallas de instalación (Ubuntu en texto, primer arranque en texto y gráfico) y
  en el menú de GRUB ahora dice **POS KIOSKO** con "un producto de noahsolutions" debajo (antes:
  "noahsolutions.com").
- **Identidad visual propia, a propósito**: el diseño anterior imitaba demasiado al instalador de Hermes
  (azul eléctrico, serif condensada con cortes tipo stencil, botón con corchetes `[ INSTALANDO… ]`) y el
  dueño pidió alejarse para no exponerse a un reclamo público. Ahora: verde azulado sobre gris cálido,
  marca en sans pesada con "POS" en pastilla, cargador de puntos, detalle de comandos en una tarjeta
  oscura tipo terminal con su propio scroll. La estructura (pasos a un lado, detalle al otro) se mantuvo:
  es un patrón genérico de instaladores, lo que se cambió es lo distintivo.
- **Bug real, introducido por mí el mismo día (Wi-Fi)**: `install.sh` hace `netplan apply` para entregarle
  la red a NetworkManager; eso reinicia la red y NetworkManager vuelve a pedir la IP por DHCP. El paso
  siguiente (el actualizador) arrancaba ~10 s después con la red a medio levantar y fallaba la primera vez
  con `fetch failed` (journal de pos-test12: 08:12:00 falla, 08:12:15 reintento OK). Se recuperaba solo por
  el bucle de reintentos, pero la pantalla de instalación mostraba un error asustador. Ahora `install.sh`
  espera hasta 60 s a resolver `github.com` antes de seguir. Verificado: dos instalaciones seguidas
  (pos-test13, pos-test14) con cero errores del actualizador y cero reintentos.
- **Colores de las pantallas de texto**: en la consola de Linux, "negrita + color" (`ESC[1;34m`) usa la
  variante BRILLANTE (azul→12, verde→10, rojo→9), no el mismo índice; sin redefinirlos la barra y el nombre
  salían en el azul de fábrica aunque el 4 estuviera bien. Además, en la pantalla de texto del primer
  arranque la paleta no se aplicaba (fondo gris, barra morada): `console-setup` la vuelve a poner de fábrica
  después de fijarla, así que `install-tui.py` y `firstboot-tui.py` la reafirman cada 5 s.
- **Modal propio para apagar/reiniciar** (en vez del `confirm()` nativo, que salía como un diálogo crudo
  "JavaScript - http://127.0.0.1:4000/setup"): icono y botón rojos para apagar, azules para reiniciar.
- Releases `v0.2.5` (apagar/reiniciar/Wi-Fi) y `v0.2.6` (modal) publicadas y verificadas.

**Qué queda como consecuencia:**
- **Qué vive dónde (para saber cuándo hay que reinstalar)**: la app (backend + pantalla) se actualiza sola
  desde GitHub Releases; TODO lo demás (scripts de `os/`, pantallas de instalación, marca de esas pantallas,
  menú de GRUB, sudoers, NetworkManager, polkit, binario de la ventana Tauri) viaja en la ISO y **no lo
  toca el actualizador**. Un equipo instalado con una ISO anterior a este día recibe los botones de
  apagar/reiniciar/Wi-Fi por actualización de la app, pero **no funcionan** ahí (falta la regla de sudoers
  y NetworkManager): hay que reinstalar con la ISO nueva. Hoy solo existen equipos de prueba.
- Cualquier paso de `install.sh` que reinicie o reconfigure la red debe esperar a que vuelva antes de un
  paso que necesite internet.
- Los colores de la marca están en tres sitios (variables CSS de `installer-ui/index.html`, `PALETTE` de
  `install-tui.py`, `NAME_HEX`/`BG_HEX`/`STATUS_HEX` de `brand.sh`): si se cambian, cambiar los tres.

**Sin probar:** Wi-Fi con una tarjeta real (VirtualBox no simula ninguna) y el menú de GRUB nuevo (dura 5 s
y no salió en ninguna captura).

---

## 2026-09-27 — Sesión: ISO probada en VirtualBox, dos bugs reales, autoservicio de desvinculación

**Qué se hizo:** se retomó el instalador/OS (parado desde el 2026-08, ver "Antes de esto" más abajo) y
se probó de punta a punta en VirtualBox, varias veces, hasta que una instalación completa (ISO →
autoinstall → primer arranque → kiosco → emparejamiento) funcionó sin intervención manual:
- Pantalla de instalación de Ubuntu en modo texto y primer arranque en modo gráfico (pasos a un lado,
  comandos en vivo al otro; el 2026-09-28 se rediseñó con identidad propia, ver arriba) —
  `os/iso/install-tui.py`, `os/installer-ui/`. Sin texto de consola visible en ningún momento (`os/iso/brand.sh`).
- El primer arranque espera activamente a que haya internet (antes llenaba la pantalla de errores de
  `apt` si no había red) y deja el equipo en zona horaria `America/Guayaquil`.
- **Barra de estado inferior** en toda la pantalla del POS: versión, cable/Wi-Fi/sin red (el backend lo
  lee de `/proc/net/route` + `/sys/class/net/*/wireless`, solo Linux), hora.
- **F12 abre el inspector de la webview** (pestaña Red) directamente en el POS.
- Ventana de Tauri (`os/window/`) reconstruida varias veces en Docker sin problema (el toolchain de Rust
  vive solo en el contenedor).
- Releases `v0.2.0` a `v0.2.4` publicadas en GitHub, cada una verificada (hash + firma) contra lo que
  sirve `releases/latest/download/latest.json` antes de darla por buena.

**Por qué así (dos bugs reales, no cosméticos, que costó encontrar):**
1. **El socket local de la pantalla nunca conectaba en producción, en NINGÚN POS instalado desde la
   primera versión.** `frontend/src/socket/localSocket.ts` comprobaba `import.meta.env.VITE_LOCAL_SOCKET_URL`
   (variable de *desarrollo*, en `frontend/.env`) **antes** que `import.meta.env.PROD` con el operador
   `??`. Como Vite carga `.env` también en `vite build` (no hay `.env.production` que lo tape), todo
   build de producción hasta la 0.2.2 quedaba con la URL de desarrollo (`127.0.0.1:4001`) grabada en el
   bundle. Efecto real: la desvinculación remota y el estado de sincronización nunca llegaban a la
   pantalla sin recargar. Se encontró porque F12 (ver abajo) finalmente dejó ver la consola. Arreglado en
   la 0.2.3: mismo orden que ya usaba bien `api/client.ts` (PROD primero, la variable de desarrollo solo
   dentro de la rama que NO es producción).
2. **F12 no abría nada, por dos causas de Tauri 2, no del código de la app:** faltaba declarar el
   comando `open_devtools` en `src-tauri/build.rs` (`AppManifest.commands`, para que Tauri generara su
   permiso), y faltaba agregar `http://127.0.0.1:4000`/`:4080` a `"remote"` en `capabilities/default.json`
   (Tauri trata una URL externa como remota, no como contenido local de la app, y sin eso el ACL bloquea
   cualquier comando aunque el permiso exista). Diagnosticarlo se complicó porque el síntoma inicial
   ("el teclado de VirtualBox no llega") era real pero era OTRO problema: la inyección de bajo nivel
   `keyboardputscancode` no dispara `keydown` de verdad; con teclado físico dentro de la ventana de
   VirtualBox sí llega.
3. **"Volver a ingresarlo" (login del POS) solo olvidaba el emparejamiento local**, a propósito según el
   comentario original: el punto de emisión quedaba emparejado en el CRM para siempre hasta que un admin
   lo desvinculara a mano. Decisión del dueño: que sea autoservicio. El POS ahora llama a la MISMA ruta
   que usa el admin desde `EstablishmentsView`, con su propio token (ya tiene los permisos del rol
   Administrador, ver `issueDeviceSession` en `auth-service`) y el `establishmentId`/`emissionPointId` de
   su propio `PosConfig` — nunca puede tocar el punto de otro equipo. Si el CRM no responde, sigue con el
   olvido local para no dejar al cajero atascado.

**Qué queda como consecuencia:**
- Cualquier `import.meta.env.ALGO ?? (PROD ? ... : ...)` nuevo debe comprobar PROD primero — es fácil
  repetir el bug 1 sin darse cuenta, porque compila y el string queda ahí, solo se nota si algo intenta
  usar esa conexión.
- Cualquier comando nuevo de Tauri (`#[tauri::command]`) necesita las DOS cosas del bug 2: declararse en
  `build.rs` Y el origen en `capabilities/*.json` bajo `"remote"`. Si un comando nuevo falla con "not
  allowed by ACL" aunque compile bien, es casi seguro esto.
- El binario de la ventana (Tauri) **no lo toca el actualizador** — solo la app (backend+frontend). Si se
  cambia algo de `frontend/src-tauri/`, hace falta una ISO nueva para que llegue a instalaciones nuevas;
  a un equipo YA instalado hay que copiarle el binario a mano (o esperar a que alguien lo reinstale).
- El flujo completo del autoservicio de desvinculación (punto 3) se verificó por lectura de código y por
  el smoke test del release, pero no de punta a punta con un emparejamiento real: hace falta iniciar
  sesión en el CRM para generar un código, y quien probó esto (Claude) no escribe contraseñas en
  formularios de login. Falta que el dueño lo confirme.
- `HANDOFF-pos-os.md` y `os/DISENO.md` quedaron reescritos con el estado real (ya no dicen "sin probar"
  donde ya se probó). `rules.md` y `todo.md` también se revisaron esta sesión.

**Siguiente paso:** UEFI, hardware real, ejecutar `release.yml` al menos una vez, y las dos decisiones
pendientes del dueño (Wi-Fi configurable, apagar/reiniciar desde la barra de estado).

---

## 2026-09-25 — Sesión: Fases 5 y 6 del OS — kiosco e instalación desatendida

**Fase 5 (`os/kiosk/`)**:
- `launch.sh`: **espera `/health`** (3 min) y mantiene la ventana viva (`while :; do APP; sleep 2; done`); apaga salvapantallas/suspensión (`xset -dpms s off`); cursor invisible si `KIOSK_HIDE_CURSOR=1` (`xsetroot -cursor empty.xbm`); todo configurable por env en `/etc/facturero/kiosk.env` (`KIOSK_APP_BIN` por defecto `/opt/facturero/app/facturero-pos-app`, `KIOSK_OS_DIR` por defecto `/opt/facturero/os-src`, `KIOSK_LOG`).
- `setup-kiosk.sh` (idempotente, root): autologin en tty1 vía drop-in `getty@tty1.service.d` con `agetty --autologin facturero`; enmascara `getty@tty{2..6}`, `ctrl-alt-del.target`, `sleep/suspend/hibernate/hybrid-sleep`; `set-default multi-user.target`; `.bash_profile` (`[[ $XDG_VTNR == 1 ]] && exec startx`), `.xinitrc` (`exec openbox-session`), `rc.xml` **sin menú ni binds por defecto** (1 escritorio, solo Alt+F4 y mover ventana), autostart que hace `source` de `kiosk.env` y lanza `launch.sh` en fondo.
- Efecto colateral en el instalador (fase 4): `facturero` pasó de nologin a `/bin/bash` (autologin lo necesita) y se agregaron `xorg` y `openbox` a los paquetes (los pedía el HANDOFF de la fase 4).
- Servicio técnico: SSH **con clave** SOLO desde `--allow-ssh-from CIDR` (se agregó la opción a `install.sh`; ufw `allow from CIDR to any port 22 proto tcp`). **Nada de contraseñas fijas.**

**Fase 6 (`os/iso/`)**:
- `autoinstall.yaml` (subiquity v1, Ubuntu Server 24.04): disco completo LVM, locale es_ES, teclado es, usuario técnico `taller` **sin contraseña de login** (`allow-pw: false`) con clave SSH por parametrización, y `late-commands` que **solo copian** `os/`→`/opt/facturero/os-src` y los parámetros, y habilitan `facturero-firstboot.service` (no se corre `install.sh` en chroot: `systemctl`/MySQL no funcionan allí).
- `firstboot.sh` + `facturero-firstboot.service` (`Type=oneshot`, `After=network-online.target`, `TimeoutStartSec=1800`): lee `install-params.env` → `install.sh --admin-api-base … --allow-ssh-from …` → `setup-kiosk.sh` → escribe `OS-FIRSTBOOT-DONE` → `systemctl disable --now` → `systemctl reboot` al kiosco.
- `build-iso.sh` (para Ubuntu del dueño, **NO se ejecuta en Windows**: explicado): extrae la ISO con `xorriso -osirrox`, copia `os/` como `pos-os`, sustituye placeholders (`__HOSTNAME__`, `__SSH_PUB_KEY__`, `__ADMIN_API_BASE__`, `__SSH_ALLOW_FROM__`), añade la entrada de grub `linux /casper/vmlinuz autoinstall ds=nocloud\;/s=/cdrom/ quiet ---` (el grub EFI carga el MISMO `boot/grub/grub.cfg`, una edición vale para BIOS y UEFI) y reconstruye con `xorriso -as mkisofs` (isohybrid MBR + El Torito + EFI).
- `iso-params.example` como plantilla de parámetros sin valores de producción; `REMOSTRADO.md` con pasos y de qué depende el dueño.

**Por qué:** un cliente no técnico solo recibe la ISO/se enciende; el primer arranque provisiona y deja el kiosco; las actualizaciones ya van por el actualizador de la fase 1 (el SO no se toca más). SSH solo de administración = regla 5 del diseño (nada entra).

**Verificación:** `bash -n` OK en los 5 scripts (Git Bash); `autoinstall.yaml` y `updater.json` validados con Ruby/Psych en contenedor (estructura, 7 `late-commands`, placeholders); `rc.xml` validado con REXML. Sustitución de plantillas (`__NODE_DIR__`, `__SYSTEMCTL__`) simulada y revisada.
**NO se pudo probar (requiere Linux real / ISO / VM):** apt del sistema, MySQL socket-root, `systemd-analyze verify`, sudoers/visudo reales, ufw, arranque X con Openbox, autologin por agetty, flujo completa: autoinstall → primer arranque → provision → kiosco → actualización por timer. VirtualBox está listo (82 GB libres, 32 GB RAM) y el dueño ya fue avisado para **autorizar la descarga de la ISO y la prueba en VM** (regla 2 del HANDOFF).

**Notas de diseño que se embebieron:** el reintento de `systemctl start` como rama del `||` del `restartCmd` cubre el primer arranque; la primera instalación exige red (baja Node + app); `ADMIN_API_BASE_URL` y el CIDR de SSH **no tienen valores por defecto** en el repo (producción del gateway no se fija sin confirmar el dueño).

**Siguiente paso:** tras el reporte al dueño → autorización → ISO + VM (fases probadas en real). `*` pendientes no-código: icono/marca (fase 8), decisión de IVA y stock (negocio).

---

## 2026-09-25 — Sesión: Fase 4 del OS — aprovisionamiento de Ubuntu

**Qué se hizo:** `os/provision/` completo:
- `install.sh` **idempotente** (`sudo bash os/provision/install.sh [--admin-api-base URL] [--country-code CC]`; argumentos desconocidos → error): usuario system `facturero`; Node **22.14.0 fijado** en `/opt/facturero/runtime/` descargado de nodejs.org y **verificado por SHA256** contra `SHASUMS256.txt`; MySQL con drop-in `bind-address = 127.0.0.1`, base `pos_db` utf8mb4 y usuario `facturero`@`127.0.0.1` con contraseña aleatoria que **solo** existe en `/etc/facturero/pos.env` (0600) (si `pos.env` ya existe, no la regenera); `pos.env` con `NODE_ENV/PORT/DATABASE_URL/JWT_SECRET/POS_FRONTEND_DIST/POS_IMAGES_DIR/POS_COUNTRY_CODE` y `ADMIN_API_BASE_URL` **solo si se pasa `--admin-api-base`** (sin default escrito); `updater.json` 0640 root:facturero con la ruta de systemctl plantillada (`__SYSTEMCTL__`, la misma que la regla de sudoers — sudo exige path exacto); copia de la actualizador (`update-cli/`) y de la clave pública; unidades `facturero-backend.service`, `facturero-updater.service` (oneshot, `SuccessExitStatus=0 2 3` → rollback/bloqueo no son fallos) y `facturero-updater.timer` (`OnBootSec` 5 min + `RandomizedDelaySec` 10 min + `Persistent`); sudoers mínima `NOPASSWD` restart/start del backend; ufw denegando todo lo entrante; y **primera instalación vía `systemctl start facturero-updater.service`** (la unidad da el `EnvironmentFile` que requiere `prisma migrate deploy`; con `su` no habría `DATABASE_URL`).
- `units/*` como plantillas con `__NODE_DIR__` que `install.sh` sustituye.
- `updater.json`: `manifestUrl` = `releases/latest/download/latest.json`, `migrateCmd` = `cd "$RELEASE_DIR/backend" && ./node_modules/.bin/prisma migrate deploy`, `restartCmd` con rama `|| systemctl start` para el primer arranque (la unidad aún no está levantada), `healthTimeoutMs 90000`.

**Por qué:** el SO lleva Node fijado (el de apt cambia de versión y puede romper el runtime); solo la salida de red (regla 5); el actualizador debe poder reiniciar el backend sin pedir contraseña (desatendido); la primera versión la mete el **mismo** mecanismo de actualización para que el camino sea único.

**Verificación:** `bash -n` OK (Git Bash); JSON validado con `node -e require(...)`; sustitución de `__NODE_DIR__`/`__SYSTEMCTL__` simulada y revisada (unidades y `updater.json` finales correctos). **NO se pudo probar** (requiere Linux real / VM autorizada por el dueño): apt, arranque de MySQL con socket root, `systemctl` real y `systemd-analyze verify`, `sudoers`/`visudo -c -f`, `ufw`, migración contra el MySQL del sistema, primer arranque del backend como `facturero`, y el flujo completo update→restart→health/rollback en systemd.

**Notable:** `current` no existe hasta que el actualizador corre la primera vez; el `IF` del script distingue "primera instalación" de "ya hay versión activa". `migrateCmd` asume cwd=RELEASE_DIR y `DATABASE_URL` en el entorno de la unidad.

**Siguiente paso:** fase 5 (kiosco: autologin, Openbox, ventana Tauri, bloqueo de atajos/TTY, auto-reinicio) — escribir `os/kiosk/` y validar estáticamente; prueba real en la VM.

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

## 2026-09-26 — Sesión: SQLite, ventana Tauri, ISO instalable

**SQLite en lugar de MySQL (Prisma 6.19).** Decisión del dueño: un POS es un solo equipo con un solo proceso, no
necesita servidor de BD. Cambia `rules.md` (fila de decisiones) y **anula** lo que este archivo diga de MySQL
más abajo. La base es un archivo (`/var/lib/facturero/pos.db` en el equipo; `backend/data/pos.db` en desarrollo),
con WAL + `busy_timeout` (`src/db.ts`) y `connection_limit=1`. Las migraciones de MySQL se descartaron (no había
equipos instalados) y hay una migración base nueva. Consecuencias a recordar: búsquedas con `contains` no ignoran
acentos como MySQL (`cafe` ≠ `café`); los decimales de dinero se guardan como flotantes, pero todo el cálculo va en
centavos redondeados (paridad 40/40 con billing).

**Volver a ingresar el código de emparejamiento** desde el login (`POST /setup/forget`, rechazado con 409 si hay
ventas sin enviar). No desvincula del lado del CRM.

**Ventana Tauri del kiosco** compilada en Docker (`os/window/`, 3,5 MB, sin plugin updater de Tauri: la app se
actualiza con `os/updater`). **ISO instalable** (`os/iso/`, `build-iso-docker.sh`) probada en VirtualBox: instala
Ubuntu 24.04.5 sola, aprovisiona, entra al kiosco y muestra el emparejamiento. Faltan: publicar la release en
GitHub, logo real, arranque sin textos de consola.

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
