import { createServer } from "node:http";
import type { Server as HttpServer } from "node:http";
import type { ServerType } from "@hono/node-server";
import { Server } from "socket.io";
import type { SyncState } from "../sync/status.js";

// Canal de tiempo real LOCAL entre el frontend y este backend del POS.
// En desarrollo vive en un puerto propio (LOCAL_SOCKET_PORT, por defecto 4001)
// y en un http server aparte para no chocar con el request-handler de Hono del
// puerto 4000. En producción, cuando el backend sirve la pantalla
// (POS_FRONTEND_DIST definido), se monta sobre el MISMO server (index.ts le
// pasa el objeto) para que webview y socket compartan origen.
//
// Sustituye los polling del frontend:
//  - `unlinked`   -> cuando el admin desvincula el punto de emisión (el hub
//    del gateway nos avisa por `pos.unlink`) o cuando se hace un forget. El
//    frontend vuelve a la pantalla de emparejamiento al instante.
//  - `sync.status`-> después de cada ciclo de sync y de cada venta local, el
//    backend empuja el estado (último pull/push, ventas pendientes) para el
//    indicador "en línea / pendiente de sincronizar", sin consultar /sync/status.

const PORT = Number(process.env.LOCAL_SOCKET_PORT ?? 4001);

let io: Server | null = null;

export function startLocalSocket(options?: { server?: ServerType }): void {
  if (io) return;

  if (options?.server) {
    // En este despliegue el server es siempre plain http (localhost sin TLS);
    // http2 nunca se usa, así que el cast es solo para contentar a socket.io.
    io = new Server(options.server as HttpServer, {
      path: "/ws",
      cors: { origin: "*" },
    });
    io.on("connection", () => {
      console.log("[local-socket] frontend conectado");
    });
    return;
  }

  const httpServer: HttpServer = createServer();
  io = new Server(httpServer, {
    path: "/ws",
    cors: { origin: "*" },
  });

  io.on("connection", () => {
    console.log("[local-socket] frontend conectado");
  });

  httpServer.listen(PORT, "127.0.0.1", () => {
    console.log(`[local-socket] tiempo real del frontend en http://127.0.0.1:${PORT}/ws`);
  });
}

export function emitUnlinked(deviceId: string | null | undefined): void {
  io?.emit("unlinked", { deviceId: deviceId ?? null });
}

export function emitSyncState(state: SyncState): void {
  io?.emit("sync.status", state);
}
