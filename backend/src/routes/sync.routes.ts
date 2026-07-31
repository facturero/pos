import { Hono } from "hono";
import { prisma } from "../db.js";
import { authMiddleware } from "../middleware/auth.js";
import { runSyncCycle } from "../sync/scheduler.js";

export const syncRoutes = new Hono();

syncRoutes.use("*", authMiddleware);

// Estado de la sincronización: último pull/push exitoso y ventas pendientes.
// El frontend usa esto para el indicador "en línea / pendiente de sincronizar".
syncRoutes.get("/status", async (c) => {
  const [lastPull, lastPush, pendingSales] = await Promise.all([
    prisma.syncLog.findFirst({ where: { direction: "PULL" }, orderBy: { createdAt: "desc" } }),
    prisma.syncLog.findFirst({ where: { direction: "PUSH" }, orderBy: { createdAt: "desc" } }),
    prisma.sale.count({ where: { synced: false, status: "COMPLETED" } }),
  ]);

  return c.json({ lastPull, lastPush, pendingSales });
});

// Botón manual de "Sincronizar ahora" — por si el cron todavía no dispara
// y el cajero acaba de recuperar internet.
syncRoutes.post("/run", async (c) => {
  await runSyncCycle();
  return c.json({ ok: true });
});
