import { Hono } from "hono";
import { z } from "zod";
import { prisma } from "../db.js";
import { pairWithCode, primeTokenCache, clearSessionCache, AdminApiError } from "../sync/admin-client.js";
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

// "Olvidar" el emparejamiento localmente (por si se necesita reconfigurar
// desde cero en este equipo). NO desvincula del lado del CRM — eso lo hace
// el admin desde EstablishmentsView con "Desvincular y regenerar", que avisa
// a este POS por socket.io (evento pos.unlink) para que se desvincule solo.
setupRoutes.post("/forget", async (c) => {
  await prisma.posConfig.deleteMany({ where: { id: 1 } });
  clearSessionCache();
  emitUnlinked(await getDeviceId());
  return c.json({ ok: true });
});
