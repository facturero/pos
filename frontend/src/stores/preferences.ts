import { defineStore } from "pinia";
import { useThemeStore } from "./theme";

// Preferencias de esta caja (no del CRM): viven en el navegador del propio equipo.
const SHOW_IMAGES_KEY = "pos_show_images";

// null = el cajero nunca lo tocó: manda el valor por defecto del tema (layout.showProductImages).
function readShowImages(): boolean | null {
  try {
    const v = localStorage.getItem(SHOW_IMAGES_KEY);
    return v === null ? null : v !== "0";
  } catch {
    return null;
  }
}

export const usePreferencesStore = defineStore("preferences", {
  state: () => ({
    override: readShowImages() as boolean | null,
  }),
  getters: {
    // Ver el catálogo con foto de cada producto. Lo que eligió el cajero gana; si no eligió, el tema.
    showImages(state): boolean {
      return state.override ?? useThemeStore().layout.showProductImages;
    },
  },
  actions: {
    setShowImages(value: boolean) {
      this.override = value;
      try {
        localStorage.setItem(SHOW_IMAGES_KEY, value ? "1" : "0");
      } catch {
        // sin almacenamiento: la preferencia dura hasta cerrar la caja
      }
    },
  },
});
