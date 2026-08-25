import { io, Socket } from "socket.io-client";
import { prisma } from "../db.js";
import { diagnoseDbError } from "../db-guide.js";
import { getDeviceId } from "../device-identity.js";
import { getAccessToken, clearSessionCache, NotPairedError, AdminApiError } from "./admin-client.js";
import { runSyncCycle } from "./scheduler.js";
import { emitUnlinked } from "../local/socket.js";

// Cliente socket.io hacia el hub del gateway (/ws). Sustituye la espera del
// cron por un aviso inmediato: cuando el admin cambia el catálogo
// (product.product.*), el gateway emite `catalog.changed` a la sala de la
// organización y aquí disparamos un pull autenticado. El cron queda como
// red de seguridad (reconciliación), no como mecanismo principal.
//
// También escucha `pos.unlink` (routing key organization.billing_point.unlinked
// que el hub reenvía a la sala device:<deviceId>): cuando el admin desvincula
// el punto de emisión desde el CRM, este POS se desvincula SOLO (limpia su par
// local, la caché de tokens y cierra el socket) sin depender de un forget manual.

const GATEWAY_URL = process.env.ADMIN_API_BASE_URL ?? "";
const RETRY_MS = 30_000;

let socket: Socket | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let started = false;

export function startRealtime(): void {
  if (started) return;
  started = true;
  void connect();
}

// Se llama tras un emparejamiento exitoso para conectar ya (sin esperar el
// reintento del boot, que habría corrido antes de existir el par).
export function connectRealtime(): void {
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
  void connect();
}

async function connect(): Promise<void> {
  disconnect();

  try {
    if (!GATEWAY_URL) {
      scheduleRetry("ADMIN_API_BASE_URL no configurado");
      return;
    }

    // Hace refresh si el token caducó; lanza NotPairedError si no hay par.
    const token = await getAccessToken();

    socket = io(GATEWAY_URL, {
      path: "/ws",
      auth: { token },
      transports: ["websocket"],
      reconnection: false, // reconexión manual para renovar el token antes de reconectar
      timeout: 15_000,
    });

    socket.on("connect", () => {
      console.log("[realtime] conectado al gateway");
    });

    socket.on("catalog.changed", (payload) => {
      const event = (payload as { event?: string } | undefined)?.event;
      console.log(`[realtime] cambio de catálogo recibido (${event ?? "desconocido"}): sincronizando`);
      void runSyncCycle().catch((err) =>
        console.error("[realtime] sync tras evento falló:", err instanceof Error ? err.message : err),
      );
    });

    socket.on("pos.unlink", (payload) => {
      const deviceId = (payload as { deviceId?: string } | undefined)?.deviceId;
      void handleRemoteUnlink(deviceId);
    });

    socket.on("disconnect", (reason) => {
      console.log(`[realtime] desconectado (${reason})`);
    });

    socket.on("connect_error", (err) => {
      // Si el token expiró o fue revocado, el próximo intento renueva.
      console.error(`[realtime] error de conexión: ${err.message}`);
      scheduleRetry(err.message);
    });
  } catch (err) {
    if (err instanceof NotPairedError) {
      scheduleRetry("POS sin emparejar");
    } else if (err instanceof AdminApiError) {
      scheduleRetry(err.message);
    } else {
      const issue = diagnoseDbError(err);
      if (issue.guide) {
        console.error(`[realtime] problema con la base de datos local:\n${issue.guide}`);
        scheduleRetry("base de datos local no disponible");
      } else {
        console.error("[realtime] no se pudo obtener token:", err);
        scheduleRetry("error inesperado");
      }
    }
  }
}

function disconnect(): void {
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  }
}

// Desvinculación automática: el admin presionó "Desvincular y regenerar" en
// el CRM y el hub nos lo reenvió. Comprobamos que el deviceId del evento sea
// el de ESTE equipo y, si lo es, limpiamos el emparejamiento local completo
// (pos_config + caché de tokens) y cerramos la conexión. El frontend detecta
// el cambio consultando /setup/status y vuelve a la pantalla de emparejamiento.
async function handleRemoteUnlink(deviceId: string | undefined): Promise<void> {
  if (!deviceId) return;

  let myDeviceId: string;
  try {
    myDeviceId = await getDeviceId();
  } catch (err) {
    console.error("[realtime] no se pudo leer el deviceId local:", err);
    return;
  }

  if (myDeviceId !== deviceId) {
    console.log(`[realtime] evento de desvinculación ignorado (evento para ${deviceId}, este equipo es ${myDeviceId})`);
    return;
  }

  console.log("[realtime] desvinculado remotamente por el admin; limpiando emparejamiento local");
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
  started = false;
  disconnect();
  clearSessionCache();
  await prisma.posConfig.deleteMany({ where: { id: 1 } });
  emitUnlinked(deviceId);
}

function scheduleRetry(reason: string): void {
  if (retryTimer) return;
  console.log(`[realtime] reintentando en ${RETRY_MS / 1000}s (${reason})`);
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void connect();
  }, RETRY_MS);
}
