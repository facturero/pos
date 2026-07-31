import { defineStore } from "pinia";
import { api } from "../api/client";

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
// realmente habla con el admin). El frontend solo consulta /sync/status
// y puede forzar /sync/run — nunca sincroniza directo, para que la lógica
// de reintentos/errores viva en un solo lugar (el backend).
export const useSyncStore = defineStore("sync", {
  state: () => ({
    lastPull: null as SyncLog | null,
    lastPush: null as SyncLog | null,
    pendingSales: 0,
    checking: false,
    pollHandle: null as ReturnType<typeof setInterval> | null,
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
    startPolling(intervalMs = 30_000) {
      this.refresh();
      if (this.pollHandle) clearInterval(this.pollHandle);
      this.pollHandle = setInterval(() => this.refresh(), intervalMs);
    },
    stopPolling() {
      if (this.pollHandle) clearInterval(this.pollHandle);
      this.pollHandle = null;
    },
  },
});
