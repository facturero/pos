# Reglas del proyecto — POS

Este archivo es contexto obligatorio para cualquier agente (opencode, Claude, u
otro) que trabaje en `pos/`. Léelo antes de tocar código. Si algo en el código
contradice este archivo, el código está mal — no al revés.

## 1. Qué es este proyecto (y qué NO es)

El POS es una **caja registradora física/kiosco**, no un panel de administración.
- **NO** es la fuente de verdad de productos, precios ni catálogo — eso vive en
  `cmr-proyect` (el CRM), específicamente en `product-service`.
- **SÍ** es una caché local (MySQL) que se sincroniza *desde* el CRM, y una cola
  de ventas que se sincroniza *hacia* el CRM cuando hay internet.
- Debe **funcionar sin internet**. Si el CRM está caído o no hay conexión, el
  POS sigue vendiendo con el último catálogo sincronizado, y encola las ventas.

## 2. Arquitectura (no cambiar sin discutirlo primero)

```
┌─────────────────────────────┐
│  Tauri (Vue 3 + Tailwind)     │  ← frontend/
│  Vende, cobra, historial      │
└──────────────┬───────────────┘
               │ HTTP a 127.0.0.1:4000
┌──────────────▼───────────────┐
│  Backend local (Hono+Prisma)  │  ← backend/
│  MySQL local: caché + cola    │
│  Módulo sync/ (pull + push)   │
└──────────────┬───────────────┘
               │ HTTPS al gateway del CRM (con JWT)
┌──────────────▼───────────────┐
│  api-gateway-node (8080)      │  → product-service, organization-service, etc.
└───────────────────────────────┘
```

- El backend del POS **solo escucha en 127.0.0.1** — nunca exponerlo a la red.
- El frontend **nunca le habla directo al CRM** — siempre pasa por el backend
  local, incluso cuando hay internet. Esto es lo que permite que todo siga
  funcionando offline sin lógica condicional en el frontend.
- El backend del POS **nunca hardcodea credenciales de un usuario humano**. Las
  credenciales nacen del emparejamiento (ver sección 4) y se guardan en
  `pos_config` (tabla local), no en `.env`.

## 3. Decisiones ya tomadas — no las reviertas sin preguntar

| Decisión | Por qué | Dónde vive |
|---|---|---|
| Sin control de stock (venta siempre permitida) | `product-service` (CRM) todavía no maneja inventario — es un flag reservado a fase futura | `pos/backend/src/routes/sales.routes.ts` |
| El rol del usuario de servicio del POS es "Administrador" (todos los permisos) | Decisión temporal explícita del dueño del proyecto — falta definir un catálogo de permisos propio para terminales POS | `auth-service/src/application/use-cases/provision-service-account.ts` |
| `push.ts` (subir ventas al CRM) siempre va a fallar por ahora | `billing-service` (donde vivirían las facturas) todavía no existe en el CRM. No es un bug — las ventas se acumulan sin pérdida en `synced: false` | `pos/backend/src/sync/push.ts` |
| Emparejamiento vía TOTP (código de 6 dígitos rotativo), no usuario/contraseña fijo | Más seguro, más fácil para un no-técnico que instale el POS, y define sin ambigüedad a qué organización pertenece cada instalación | `organization-service` + `pos/backend/src/routes/setup.routes.ts` |
| Emparejamiento de un solo uso | Un punto de emisión emparejado no puede volver a emparejarse sin que un admin lo desvincule explícitamente desde el CRM | `organization-service/src/domain/entities.ts` (`EmissionPoint.markPaired`/`unlinkAndRegenerate`) |
| IDs sincronizados desde el CRM son UUID (string), no autoincrement | Así los maneja `product-service`/`organization-service` | `prisma/schema.prisma` → campos `remoteId` |
| MySQL local (no SQLite) para el backend del POS | Más seguro ante manipulación si alguien accede físicamente al equipo, soporta migraciones con Prisma para actualizaciones futuras | decisión explícita del dueño del proyecto |

## 4. El flujo de emparejamiento — no lo reimplementes distinto

1. Admin crea un punto de emisión tipo **POS** en el CRM → se genera un secreto
   TOTP.
2. El admin abre "Ver código" → ve el código de 6 dígitos rotando (como un
   autenticador).
3. El POS, sin configurar, muestra la pantalla `/setup` pidiendo el código.
4. `POST /billing-points/pair` (público, sin JWT — el código ES la
   autenticación) en `organization-service` valida el código contra TODOS los
   puntos tipo POS sin emparejar de CUALQUIER organización (todavía no sabe a
   cuál pertenece).
5. Si coincide: se marca emparejado, y `organization-service` llama
   internamente (secreto compartido `INTERNAL_SERVICE_SECRET`, nunca JWT de
   usuario) a `POST /internal/service-accounts` en `auth-service`, que
   crea/reutiliza un usuario de servicio y devuelve tokens.
6. El POS guarda el `refreshToken` en `pos_config` (fila única) y desde
   entonces solo hace `/auth/refresh` — nunca vuelve a pedir el código a menos
   que un admin lo desvincule.

**Nunca** vuelvas a un modelo de `ADMIN_API_EMAIL`/`ADMIN_API_PASSWORD` fijo en
`.env` — ya se descartó explícitamente por este flujo.

## 5. Convenciones de código

- **Backend POS**: Hono + Prisma + Zod, arquitectura simple por rutas (no hay
  capas de dominio/aplicación separadas como en el CRM — el POS es
  deliberadamente más simple).
- **Frontend POS**: Vue 3 `<script setup>` + Tailwind (sin Vuetify — se
  descartó explícitamente por peso). Pinia para estado. Iconos: `@mdi/js` con
  el wrapper `components/Icon.vue` (nunca agregar FontAwesome ni una librería
  de iconos nueva sin discutirlo).
- **CRM (organization-service, auth-service, etc.)**: Clean Architecture
  (domain / application / infrastructure / interface), Sequelize + MySQL,
  Hono. Sigue el patrón de casos de uso ya existente — no metas lógica de
  negocio en los controllers.
- Comentarios en español, igual que el resto del código ya escrito.
- Nunca reproducir la estructura de "un microservicio nuevo por feature" sin
  preguntar — ya hay bastantes servicios corriendo.

## 6. Seguridad — límites duros

- El backend del POS jamás debe aceptar conexiones fuera de `127.0.0.1`.
- `INTERNAL_SERVICE_SECRET` y `JWT_SECRET` son secretos — nunca deben aparecer
  hardcodeados fuera de `.env`/`.env.example` (con placeholder tipo
  `changeme-...`).
- El endpoint `POST /billing-points/pair` es intencionalmente público (sin
  JWT) — es el único bootstrap posible para un dispositivo nuevo. Su única
  defensa es el código TOTP de 6 dígitos + ventana de tiempo corta. No lo
  "arregles" agregándole auth, porque entonces nada podría emparejarse nunca.
- `POST /internal/service-accounts` (auth-service) **nunca** debe exponerse
  públicamente vía el gateway — solo servicio-a-servicio con
  `X-Internal-Secret`.

## 7. Antes de tocar Docker / infraestructura compartida

`organization-service`, `auth-service` y `api-gateway-node` **no son parte del
proyecto POS** — son del CRM (`cmr-proyect`), y el POS solo los consume. Si
hay que cambiar algo ahí:
1. Revisa `cmr-proyect/API.md` y el `openapi.yaml` del servicio antes de asumir
   la forma de un endpoint.
2. Después de cambiar algo en esos servicios, **hay que reconstruir su imagen
   Docker** (`docker compose build <servicio>`) — no basta con guardar el
   archivo. `npm run dev` local sí hace hot-reload; Docker no.
3. Las migraciones de Sequelize no corren solas al levantar el contenedor —
   hay que correrlas explícitamente (`docker compose run --rm <servicio> npx
   sequelize-cli db:migrate`).

## 8. Antes de que un agente automático (opencode, etc.) toque este repo

1. **Commitear primero.** Ya ha pasado que una sesión de agente borra archivos
   sin avisar (aparente `git clean -fd`). Nunca empieces una sesión de agente
   sin `git add -A && git commit` antes.
2. Dale este archivo y `todo.md` como contexto — no asumas que los va a leer
   solo porque están en el repo.
3. Si el agente propone "arreglar" algo de la sección 3 (control de stock,
   rol del POS, email/password fijo, push de ventas), es casi seguro que está
   deshaciendo una decisión ya tomada, no arreglando un bug real. Verifica con
   el humano antes.
