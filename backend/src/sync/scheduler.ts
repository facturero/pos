import cron from "node-cron";
import { prisma } from "../db.js";
import { diagnoseDbError } from "../db-guide.js";
import { pullFromAdmin } from "./pull.js";
import { pushToAdmin } from "./push.js";
import { getSyncState } from "./status.js";
import { emitSyncState } from "../local/socket.js";

let isSyncing = false;

// Corre pull + push en secuencia. Si ya hay un ciclo corriendo, se ignora
// el disparo (evita sync solapados si el cron dispara mientras el anterior
// sigue esperando la red, por ejemplo con internet lento).
export async function runSyncCycle(): Promise<void> {
  if (isSyncing) return;
  isSyncing = true;

  try {
    // Sin emparejar, no hay organizationId/refreshToken con qué sincronizar.
    // Salir en silencio (sin loguear error cada 5 min) hasta que se empareje
    // desde la pantalla de "Configurar POS".
    try {
      const config = await prisma.posConfig.findUnique({ where: { id: 1 } });
      if (!config) return;
    } catch (err) {
      const issue = diagnoseDbError(err);
      if (issue.guide) {
        console.error(`[sync] problema con la base de datos local:\n${issue.guide}`);
      } else {
        console.error("[sync] no se pudo leer la config del POS:", err instanceof Error ? err.message : err);
      }
      return;
    }

    try {
      const result = await pullFromAdmin();
      console.log(
        `[sync] pull OK: ${result.categories} categorías, ${result.products} productos, ` +
          `${result.users} usuarios, ${result.customers} clientes`,
      );
    } catch (err) {
      console.error("[sync] pull falló:", err instanceof Error ? err.message : err);
    }

    try {
      const result = await pushToAdmin();
      if (result.pushed || result.failed) {
        console.log(`[sync] push: ${result.pushed} subidas, ${result.failed} fallidas`);
      }
    } catch (err) {
      console.error("[sync] push falló:", err instanceof Error ? err.message : err);
    }
  } finally {
    isSyncing = false;
    // Empuja el estado actualizado al frontend (indicador de sync) en tiempo
    // real, sin que tenga que consultar /sync/status por su cuenta.
    void getSyncState()
      .then((state) => emitSyncState(state))
      .catch((err) =>
        console.error("[sync] no se pudo emitir el estado:", err instanceof Error ? err.message : err),
      );
  }
}

// Programa el ciclo de sync en segundo plano. No bloquea el arranque del
// servidor: la primera corrida se dispara poco después de levantar,
// y luego sigue el cron (por defecto cada 5 min, ver SYNC_CRON en .env).
export function startSyncScheduler(): void {
  const cronExpr = process.env.SYNC_CRON ?? "*/5 * * * *";

  setTimeout(() => {
    runSyncCycle();
  }, 5_000);

  cron.schedule(cronExpr, () => {
    runSyncCycle();
  });

  console.log(`[sync] scheduler activo (${cronExpr})`);
}
