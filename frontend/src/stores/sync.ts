import { defineStore } from "pinia";
import { api } from "../api/client";
import { onSocketEvent, onSocketConnect } from "../socket/localSocket";

interface SyncLog {
  id: number;
  status: "SUCCESS" | "ERROR";
  message: string | null;
  createdAt: string;
}

interface SyncStatusResponse {
  lastPull: SyncLog | null;
  lastPush: SyncLog | null;
  pendingSales: number;
}

// Refleja el estado de sincronización del backend local (que es quien
// realmente habla con el admin). El backend empuja `sync.status` por el socket
// local tras cada ciclo de sync y cada venta; aquí solo se consulta /sync/status
// al arrancar o al (re)conectar, nunca en bucle.
export const useSyncStore = defineStore("sync", {
  state: () => ({
    lastPull: null as SyncLog | null,
    lastPush: null as SyncLog | null,
    pendingSales: 0,
    checking: false,
    syncListener: null as (() => void) | null,
  }),
  getters: {
    isOnline: (state) => state.lastPull?.status === "SUCCESS",
  },
  actions: {
    async refresh() {
      this.checking = true;
      try {
        const res = await api.get<SyncStatusResponse>("/sync/status");
        this.lastPull = res.lastPull;
        this.lastPush = res.lastPush;
        this.pendingSales = res.pendingSales;
      } catch {
        // Si ni siquiera el backend local responde, no tocamos el estado
        // anterior — mejor mostrar "última vez visto" que borrar el dato.
      } finally {
        this.checking = false;
      }
    },
    async forceSyncNow() {
      await api.post("/sync/run");
      await this.refresh();
    },
    // Escucha los push `sync.status` del backend (tiempo real, sin polling).
    // Al (re)conectar hace un único /sync/status para resincronizar.
    startSyncListener() {
      if (this.syncListener) return;
      const offStatus = onSocketEvent<SyncStatusResponse>("sync.status", (res) => {
        this.lastPull = res.lastPull;
        this.lastPush = res.lastPush;
        this.pendingSales = res.pendingSales;
      });
      const offConnected = onSocketConnect(() => {
        void this.refresh();
      });
      void this.refresh();
      this.syncListener = () => {
        offStatus();
        offConnected();
      };
    },
    stopSyncListener() {
      this.syncListener?.();
      this.syncListener = null;
    },
  },
});
