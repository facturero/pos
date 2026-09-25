import { defineStore } from "pinia";

// Preferencias de esta caja (no del CRM): viven en el navegador del propio equipo.
const SHOW_IMAGES_KEY = "pos_show_images";

function readShowImages(): boolean {
  try {
    return localStorage.getItem(SHOW_IMAGES_KEY) !== "0";
  } catch {
    return true;
  }
}

export const usePreferencesStore = defineStore("preferences", {
  state: () => ({
    // Ver el catálogo con foto de cada producto. Activado por defecto.
    showImages: readShowImages(),
  }),
  actions: {
    setShowImages(value: boolean) {
      this.showImages = value;
      try {
        localStorage.setItem(SHOW_IMAGES_KEY, value ? "1" : "0");
      } catch {
        // sin almacenamiento: la preferencia dura hasta cerrar la caja
      }
    },
  },
});
