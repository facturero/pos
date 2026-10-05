import fs from "node:fs";
import path from "node:path";
import { prisma } from "../db.js";
import { version } from "../version.js";

// Lado "servidor" de la compuerta de actualización (os/release/update-gate.mjs). Mismo reparto de
// papeles que Discord: la versión nueva se baja y queda esperando en segundo plano; este backend, que ve
// la caja y la pantalla, le dice a la compuerta cuándo es buen momento, y la pantalla muestra
// "actualización lista" con un botón "Actualizar ahora".
//
// Se comunica por archivos en POS_UPDATE_DIR (los escribe/lee la compuerta, que corre como el mismo
// usuario): update-gate.json (estado de la espera) y update-now (la orden del botón). Sin ese
// directorio (desarrollo, o la app de escritorio que se actualiza con electron-updater) todo queda
// inactivo: no hay actualización pendiente y el botón no hace nada.
const STATE_DIR = process.env.POS_UPDATE_DIR ?? "/var/lib/facturero";
const STATUS_FILE = path.join(STATE_DIR, "update-gate.json");
const NOW_FLAG = path.join(STATE_DIR, "update-now");

// La compuerta escribe el estado cada ~10 s mientras espera; si hace más de esto que no lo toca, el
// actualizador murió o se reinició y ya no hay nada pendiente (no mostrar un aviso eterno).
const STATUS_STALE_MS = 90_000;
// Tiempo sin tocar nada, con el carrito vacío, tras el cual se considera ocioso.
const IDLE_MS = Number(process.env.POS_UPDATE_IDLE_MS ?? 5 * 60_000);
// Un latido de la pantalla más viejo que esto = la pantalla no está conectada.
const BEAT_STALE_MS = 60_000;

export interface PendingUpdate {
  version: string;
  state: "waiting" | "applying";
  reason: string;
}

export function readUpdateStatus(): PendingUpdate | null {
  try {
    const s = JSON.parse(fs.readFileSync(STATUS_FILE, "utf8"));
    if (typeof s.updatedAt !== "number" || Date.now() - s.updatedAt > STATUS_STALE_MS) return null;
    // Ya es la versión que corre: la actualización terminó.
    if (s.version === version) return null;
    return { version: String(s.version), state: s.state === "applying" ? "applying" : "waiting", reason: String(s.reason ?? "") };
  } catch {
    return null;
  }
}

// Botón "Actualizar ahora": solo tiene efecto si de verdad hay una actualización esperando.
export function requestUpdateNow(): boolean {
  const pending = readUpdateStatus();
  if (!pending || pending.state !== "waiting") return false;
  try {
    fs.writeFileSync(NOW_FLAG, "");
    return true;
  } catch {
    return false;
  }
}

interface Beat {
  at: number;
  cartCount: number;
  idleMs: number;
}
let lastBeat: Beat | null = null;

// Latido de la pantalla: cuántas líneas hay en el carrito y hace cuánto no se toca nada. Solo vive en
// memoria: si el backend se reinicia, el siguiente latido llega en segundos.
export function recordActivity(cartCount: number, idleMs: number): void {
  lastBeat = { at: Date.now(), cartCount, idleMs };
}

export interface GateVerdict {
  safe: boolean;
  reason: string;
}

// ¿Es buen momento para reiniciar el POS? Sí si la caja está cerrada (nadie vendiendo), si no hay
// pantalla conectada, o si hay carrito vacío y nadie ha tocado nada en IDLE_MS.
export async function computeGate(): Promise<GateVerdict> {
  const openSessions = await prisma.cashSession.count({ where: { status: "OPEN" } });
  if (openSessions === 0) return { safe: true, reason: "caja cerrada" };
  if (!lastBeat || Date.now() - lastBeat.at > BEAT_STALE_MS) return { safe: true, reason: "sin pantalla conectada" };
  const idleMs = lastBeat.idleMs + (Date.now() - lastBeat.at);
  if (lastBeat.cartCount === 0 && idleMs >= IDLE_MS) return { safe: true, reason: "ocioso con el carrito vacío" };
  return {
    safe: false,
    reason: lastBeat.cartCount > 0 ? "hay una venta en curso" : "hay actividad reciente en la caja",
  };
}
