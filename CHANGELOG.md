# CHANGELOG — POS

Este archivo es contexto para agentes (opencode, etc.), no solo un historial
para humanos. Cada entrada explica **qué se hizo, por qué, y qué queda como
consecuencia** — para que un agente que lea esto no "corrija" algo que en
realidad fue una decisión deliberada, y sepa exactamente por dónde seguir.

Antes de tocar código, lee también `rules.md` (reglas fijas) y `todo.md`
(lista de tareas). Este archivo es el "por qué llegamos hasta acá".

---

## Estado actual en una frase

El código de **emparejamiento TOTP + POS backend/frontend está completo pero
nunca se compiló ni se probó de punta a punta** — lo primero que debería hacer
cualquier agente que retome esto es typecheck + una prueba real, no escribir
features nuevas.

---

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
