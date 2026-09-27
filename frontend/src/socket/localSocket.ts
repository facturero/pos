import { io, Socket } from "socket.io-client";

// Canal de tiempo real con el backend local del POS. En desarrollo el socket
// vive en LOCAL_SOCKET_PORT (4001), aparte del puerto 4000; en producción el
// backend lo monta sobre su propio server, así que el frontend se conecta al
// MISMO origen (URL vacía) y solo hace falta el path /ws.
// Reemplaza los polling de /setup/status y /sync/status: el backend empuja
// `unlinked` (desvinculación remota) y `sync.status` (estado de la
// sincronización) y el frontend reacciona al instante, sin consultar la API
// en bucle.

// BUG real encontrado el 2026-09-27: con el orden anterior (VITE_LOCAL_SOCKET_URL ?? (PROD ? "" : "...")),
// como frontend/.env define VITE_LOCAL_SOCKET_URL para desarrollo y Vite carga ese .env también en
// `vite build` (no hay .env.production que lo tape), el "??" ganaba SIEMPRE y el build de producción
// terminaba con la URL de desarrollo (:4001) grabada tal cual en el bundle — el socket local nunca conectaba
// en ningún POS instalado, así que "desvinculación remota" y "sync.status" nunca llegaban a la pantalla sin
// recargar. PROD se comprueba PRIMERO (mismo orden que api/client.ts) para que no dependa de qué haya en .env.
const LOCAL_SOCKET_URL = import.meta.env.PROD
  ? ""
  : (import.meta.env.VITE_LOCAL_SOCKET_URL ?? "http://127.0.0.1:4001");

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
