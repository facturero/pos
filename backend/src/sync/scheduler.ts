import cron from "node-cron";
import { pullFromAdmin } from "./pull.js";
import { pushToAdmin } from "./push.js";

let isSyncing = false;

// Corre pull + push en secuencia. Si ya hay un ciclo corriendo, se ignora
// el disparo (evita sync solapados si el cron dispara mientras el anterior
// sigue esperando la red, por ejemplo con internet lento).
export async function runSyncCycle(): Promise<void> {
  if (isSyncing) return;
  isSyncing = true;

  try {
    try {
      const result = await pullFromAdmin();
      console.log(`[sync] pull OK: ${result.categories} categorías, ${result.products} productos`);
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
