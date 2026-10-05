import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import router from "./router";
import "./style.css";

// Tras una actualización de la app, la ventana (que no se reinicia sola en las cajas con el
// actualizador viejo) sigue con el index.html de la versión anterior y pide chunks con hash que ya no
// existen: el backend responde 404 y la navegación se queda a medias (visto en la VM el 2026-09-30).
// Vite avisa con este evento cuando falla la carga de un chunk; recargar trae el index.html nuevo.
// El enfriamiento de 30 s evita un bucle de recargas si el fallo no fuera por una actualización.
window.addEventListener("vite:preloadError", () => {
  const key = "pos:preload-reload";
  try {
    if (Date.now() - Number(sessionStorage.getItem(key) ?? 0) < 30_000) return;
    sessionStorage.setItem(key, String(Date.now()));
  } catch {
    return; // sin sessionStorage no podemos garantizar que no sea un bucle
  }
  window.location.reload();
});

const app = createApp(App);
app.use(createPinia());
app.use(router);
app.mount("#app");
