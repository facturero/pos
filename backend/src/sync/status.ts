import type { SyncLog } from "@prisma/client";
import { prisma } from "../db.js";

// Estado de sincronización compartido entre el endpoint HTTP /sync/status y
// el push por socket (evento `sync.status`). Así el frontend muestra el mismo
// dato sin tener que consultar el backend cada 30 segundos.

export interface SyncState {
  lastPull: SyncLog | null;
  lastPush: SyncLog | null;
  pendingSales: number;
}

export async function getSyncState(): Promise<SyncState> {
  const [lastPull, lastPush, pendingSales] = await Promise.all([
    prisma.syncLog.findFirst({ where: { direction: "PULL" }, orderBy: { createdAt: "desc" } }),
    prisma.syncLog.findFirst({ where: { direction: "PUSH" }, orderBy: { createdAt: "desc" } }),
    prisma.sale.count({ where: { synced: false, status: "COMPLETED" } }),
  ]);

  return { lastPull, lastPush, pendingSales };
}
