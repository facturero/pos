// Punto de entrada nativo. Deliberadamente delgado: toda la logica de negocio vive en el backend
// Node (127.0.0.1:4000) y la pantalla la sirve ese mismo backend (ver tauri.conf.json -> app.windows.url).
// Este binario solo aloja la webview en pantalla completa: por eso casi nunca cambia y forma parte de la
// imagen del sistema operativo. NO lleva el plugin updater de Tauri: la aplicacion (backend + pantalla) se
// actualiza con os/updater, que si puede actualizar el backend y sus migraciones.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error corriendo la aplicación de Tauri");
}

fn main() {
    run();
}
