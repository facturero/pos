import { defineStore } from "pinia";
import { api, ApiError } from "../api/client";
import { onSocketEvent, onSocketConnect } from "../socket/localSocket";

interface SetupStatusResponse {
  paired: boolean;
  organizationId: string | null;
  establishmentId: string | null;
  emissionPointId: string | null;
}

interface PairResponse {
  paired: boolean;
  organizationId: string;
  establishmentId: string;
  emissionPointId: string;
}

// El POS no puede hacer nada útil (ni mostrar login) hasta que el backend
// local confirme que ya está emparejado con un punto de emisión del CRM.
// El router consulta este store ANTES de decidir a qué pantalla mandar.
export const useSetupStore = defineStore("setup", {
  state: () => ({
    paired: false,
    checked: false, // evita volver a pedir /setup/status en cada navegación
    reachable: false, // si el backend local respondió la última vez
    organizationId: null as string | null,
    loading: false,
    error: null as string | null,
    unlinkListener: null as (() => void) | null,
  }),
  actions: {
    async checkStatus(): Promise<void> {
      try {
        const res = await api.get<SetupStatusResponse>("/setup/status");
        this.paired = res.paired;
        this.organizationId = res.organizationId;
        this.reachable = true;
      } catch {
        // Si ni el backend local responde, mejor mandar a /setup que dejar
        // a alguien atascado en una pantalla en blanco. `reachable` queda en
        // false para no confundir "sin backend" con "desvinculado de verdad".
        this.paired = false;
        this.reachable = false;
      } finally {
        this.checked = true;
      }
    },
    async pair(code: string): Promise<void> {
      this.loading = true;
      this.error = null;
      try {
        const res = await api.post<PairResponse>("/setup/pair", { code });
        this.paired = true;
        this.organizationId = res.organizationId;
      } catch (err) {
        this.error = err instanceof ApiError ? err.message : "No se pudo emparejar el POS";
        throw err;
      } finally {
        this.loading = false;
      }
    },
    // Tiempo real para detectar la desvinculación remota: cuando el admin
    // presiona "Desvincular y regenerar", el backend local limpia su pos_config
    // (por el evento pos.unlink del gateway) y emite `unlinked` por este socket.
    // El frontend vuelve a la pantalla de emparejamiento al instante, sin
    // consultar /setup/status en bucle. Al (re)conectar resincroniza una vez.
    startUnlinkListener() {
      if (this.unlinkListener) return;
      const offUnlinked = onSocketEvent<{ deviceId: string | null }>("unlinked", () => {
        this.paired = false;
        this.reachable = true;
        this.checked = true;
      });
      const offConnected = onSocketConnect(() => {
        void this.checkStatus();
      });
      this.unlinkListener = () => {
        offUnlinked();
        offConnected();
      };
    },
    stopUnlinkListener() {
      this.unlinkListener?.();
      this.unlinkListener = null;
    },
  },
});
