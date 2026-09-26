import { existsSync, readFileSync } from "node:fs";

// Tipo de conexión del equipo para la barra inferior de la pantalla: cable, Wi-Fi o sin red.
// La interfaz de salida es la de la ruta por defecto (/proc/net/route: destino 00000000); es Wi-Fi si tiene
// /sys/class/net/<if>/wireless y está activa si su operstate es "up". No prueba que haya internet de verdad
// (eso ya lo dice el estado de la sincronización); solo dice POR DÓNDE sale el equipo.
// Solo Linux (el equipo instalado): en cualquier otro sistema (desarrollo en Windows) devuelve "unknown".

export type NetworkType = "ethernet" | "wifi" | "none" | "unknown";
export interface NetworkInfo {
  type: NetworkType;
  iface: string | null;
}

interface Sys {
  read(path: string): string | null;
  exists(path: string): boolean;
}

const realSys: Sys = {
  read: (path) => {
    try {
      return readFileSync(path, "utf8");
    } catch {
      return null;
    }
  },
  exists: (path) => existsSync(path),
};

/** Interfaces con ruta por defecto, de mayor a menor prioridad (métrica menor primero). */
export function defaultRouteInterfaces(routeTable: string): string[] {
  return routeTable
    .split("\n")
    .slice(1)
    .map((line) => line.trim().split(/\s+/))
    .filter((cols) => cols.length >= 7 && cols[1] === "00000000")
    .sort((a, b) => Number(a[6]) - Number(b[6]))
    .map((cols) => cols[0]);
}

export function readNetwork(sys: Sys = realSys, platform: string = process.platform): NetworkInfo {
  if (platform !== "linux") return { type: "unknown", iface: null };
  const table = sys.read("/proc/net/route");
  if (table === null) return { type: "unknown", iface: null };

  for (const iface of defaultRouteInterfaces(table)) {
    const state = sys.read(`/sys/class/net/${iface}/operstate`)?.trim();
    // un adaptador Wi-Fi/Ethernet sin cable a veces informa "unknown": se acepta salvo "down"
    if (state === "down") continue;
    return { type: sys.exists(`/sys/class/net/${iface}/wireless`) ? "wifi" : "ethernet", iface };
  }
  return { type: "none", iface: null };
}
