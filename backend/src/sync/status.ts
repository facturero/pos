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

export interface SyncSummary extends SyncState {
  counts: { products: number; categories: number; customers: number; users: number };
  theme: { name: string | null; source: string } | null;
}

// Para el panel de la barra de estado (icono de sincronización). Los conteos
// se calculan de las tablas locales, no del último log: así siempre reflejan
// lo que HAY ahora mismo, no lo que se bajó en la última corrida (que puede
// ser distinto si el pull de una fuente falló a medio camino).
export async function getSyncSummary(): Promise<SyncSummary> {
  const [state, products, categories, customers, users, theme] = await Promise.all([
    getSyncState(),
    prisma.product.count(),
    prisma.category.count(),
    prisma.customer.count(),
    prisma.user.count(),
    prisma.posTheme.findUnique({ where: { id: 1 }, select: { name: true, source: true } }),
  ]);

  return { ...state, counts: { products, categories, customers, users }, theme };
}
