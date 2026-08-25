import { Hono } from "hono";
import { authMiddleware } from "../middleware/auth.js";
import { runSyncCycle } from "../sync/scheduler.js";
import { getSyncState } from "../sync/status.js";

export const syncRoutes = new Hono();

syncRoutes.use("*", authMiddleware);

// Estado de la sincronización: último pull/push exitoso y ventas pendientes.
// El frontend usa esto para el indicador "en línea / pendiente de sincronizar".
// También lo empuja el backend por socket (evento `sync.status`) tras cada
// ciclo de sync y cada venta local; este endpoint queda como arranque/resync.
syncRoutes.get("/status", async (c) => {
  return c.json(await getSyncState());
});

// Botón manual de "Sincronizar ahora" — por si el cron todavía no dispara
// y el cajero acaba de recuperar internet.
syncRoutes.post("/run", async (c) => {
  await runSyncCycle();
  return c.json({ ok: true });
});
