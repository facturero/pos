// Modo de despliegue, de la variable de entorno POS_MODE:
//   "kiosk"   — Linux, ISO, equipo dedicado bajo systemd (el instalado hasta ahora). El POS es el
//               único programa en pantalla, así que controla apagar/reiniciar y muestra la hora.
//   "desktop" — Windows, .exe corriendo como una app más ("igual que Discord": ventana normal,
//               se abre con el usuario logueado). Windows ya da apagar/reiniciar/hora en su propia
//               barra de tareas, así que la barra de estado del POS no los duplica (StatusBar.vue).
// Por defecto "kiosk": es el único modo desplegado hasta ahora (pos.env no trae POS_MODE en los
// equipos ya instalados, y eso debe seguir comportándose exactamente igual que antes).
export type PosMode = "kiosk" | "desktop";

export const posMode: PosMode = process.env.POS_MODE === "desktop" ? "desktop" : "kiosk";
