import { Hono } from "hono";
import { z } from "zod";
import { prisma } from "../db.js";
import { pairWithCode, primeTokenCache, clearSessionCache, unlinkRemoteEmissionPoint, AdminApiError } from "../sync/admin-client.js";
import { runSyncCycle } from "../sync/scheduler.js";
import { connectRealtime } from "../sync/realtime.js";
import { getDeviceId } from "../device-identity.js";
import { emitUnlinked } from "../local/socket.js";

// Rutas de "primer arranque": el frontend las consulta ANTES de mostrar el
// login normal de cajero. Mientras `pos_config` esté vacía, el POS no sabe
// a qué organización pertenece y no puede vender de verdad.
export const setupRoutes = new Hono();

setupRoutes.get("/status", async (c) => {
  // "Primer alzada": aunque todavía no haya par, el equipo ya nace con su
  // deviceId estable (se crea aquí la primera vez que se consulta).
  const deviceId = await getDeviceId();
  const config = await prisma.posConfig.findUnique({ where: { id: 1 } });
  return c.json({
    paired: !!config,
    organizationId: config?.organizationId ?? null,
    establishmentId: config?.establishmentId ?? null,
    emissionPointId: config?.emissionPointId ?? null,
    pairedAt: config?.pairedAt ?? null,
    deviceId,
  });
});

const pairSchema = z.object({
  code: z.string().length(6).regex(/^\d{6}$/, "El código debe ser de 6 dígitos"),
});

setupRoutes.post("/pair", async (c) => {
  const existing = await prisma.posConfig.findUnique({ where: { id: 1 } });
  if (existing) {
    return c.json({ error: "Este POS ya está emparejado. Desvincúlalo desde el CRM para reemparejar." }, 400);
  }

  const body = await c.req.json().catch(() => null);
  const parsed = pairSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "Código inválido" }, 400);

  try {
    const deviceId = await getDeviceId();
    const result = await pairWithCode(parsed.data.code, deviceId);

    await prisma.posConfig.create({
      data: {
        id: 1,
        organizationId: result.organizationId,
        establishmentId: result.establishmentId,
        emissionPointId: result.emissionPointId,
        refreshToken: result.refreshToken,
      },
    });

    // Deja el access token ya cacheado para que el primer ciclo de sync
    // no tenga que esperar a hacer su propio refresh.
    primeTokenCache(result.accessToken, result.expiresIn, result.refreshToken);

    // Primer sync inmediato en background: no hay que esperar al cron ni
    // al reinicio. El frontend responde ya; los productos/categorías se
    // descargan solos detrás del pair.
    void runSyncCycle().catch((err) =>
      console.error("[sync] primer ciclo tras emparejar falló:", err instanceof Error ? err.message : err),
    );

    // Conectar ya al hub de tiempo real (el intento del boot habría corrido
    // antes de existir el par, así que saltó hasta el reintento).
    connectRealtime();

    return c.json({
      paired: true,
      organizationId: result.organizationId,
      establishmentId: result.establishmentId,
      emissionPointId: result.emissionPointId,
    });
  } catch (err) {
    const message = err instanceof AdminApiError ? err.message : "Error al emparejar el POS";
    return c.json({ error: message }, 401);
  }
});

// "Olvidar" el emparejamiento: por si se emparejó con un código equivocado (LoginView, "Volver a
// ingresarlo"). Además de borrar el par local, desvincula ESTE MISMO punto en el CRM (autoservicio: el
// token del dispositivo ya tiene permiso, ver unlinkRemoteEmissionPoint) para que quede libre con un
// código nuevo sin depender de que un admin lo haga a mano desde EstablishmentsView.
setupRoutes.post("/forget", async (c) => {
  // Con ventas sin enviar no se puede cambiar el emparejamiento: sin las credenciales de este punto de
  // emision no podrian subirse (y al re-emparejar con OTRO punto se facturarian en el equivocado).
  const pending = await prisma.sale.count({ where: { synced: false, status: "COMPLETED" } });
  if (pending > 0) {
    return c.json(
      { error: `Hay ${pending} venta(s) sin enviar al CRM. Espera a que se sincronicen antes de cambiar el emparejamiento.` },
      409,
    );
  }
  const config = await prisma.posConfig.findUnique({ where: { id: 1 } });
  if (config) {
    try {
      await unlinkRemoteEmissionPoint(config.establishmentId, config.emissionPointId);
    } catch (err) {
      // Sin internet, o el punto ya no existe/ya está desvinculado: no bloquea el olvido local (el
      // cajero necesita volver a la pantalla del código igual), pero puede dejar el punto "fantasma"
      // emparejado en el CRM hasta que un admin lo revise.
      console.error("[setup] no se pudo desvincular en el CRM (se sigue con el olvido local):", err);
    }
  }
  await prisma.posConfig.deleteMany({ where: { id: 1 } });
  clearSessionCache();
  emitUnlinked(await getDeviceId());
  return c.json({ ok: true });
});
