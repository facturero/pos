import { io, Socket } from "socket.io-client";

// Canal de tiempo real con el backend local del POS (puerto LOCAL_SOCKET_PORT
// del backend, por defecto 4001). Reemplaza los polling de /setup/status y
// /sync/status: el backend empuja `unlinked` (desvinculación remota) y
// `sync.status` (estado de la sincronización) y el frontend reacciona al
// instante, sin consultar la API en bucle.

const LOCAL_SOCKET_URL = import.meta.env.VITE_LOCAL_SOCKET_URL ?? "http://127.0.0.1:4001";

let socket: Socket | null = null;

function getSocket(): Socket {
  if (!socket) {
    socket = io(LOCAL_SOCKET_URL, {
      path: "/ws",
      transports: ["websocket"],
      reconnection: true,
      reconnectionDelay: 2_000,
      reconnectionDelayMax: 10_000,
    });
  }
  return socket;
}

// Suscribe a un evento del socket local y devuelve una función para desregistrar.
export function onSocketEvent<T>(event: string, handler: (payload: T) => void): () => void {
  const s = getSocket();
  s.on(event, handler);
  return () => {
    s.off(event, handler);
  };
}

// Suscribe al evento de (re)conexión: útil para resincronizar con un único
// request HTTP si nos perdimos un evento mientras el socket estaba caído.
export function onSocketConnect(handler: () => void): () => void {
  const s = getSocket();
  s.on("connect", handler);
  return () => {
    s.off("connect", handler);
  };
}
