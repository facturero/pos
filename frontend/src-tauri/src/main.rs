// Punto de entrada nativo. Deliberadamente delgado: toda la logica de negocio vive en el backend Node
// (127.0.0.1:4000) y la pantalla la sirve ese mismo backend. Este binario solo aloja la webview en pantalla
// completa: por eso casi nunca cambia y forma parte de la imagen del sistema operativo. NO lleva el plugin
// updater de Tauri: la aplicacion (backend + pantalla) se actualiza con os/updater, que si puede actualizar el
// backend y sus migraciones.
//
// La ventana se crea aqui (y no en tauri.conf.json) para poder elegir la direccion al arrancar:
//   POS_WINDOW_URL  (por defecto http://127.0.0.1:4000, el POS). Durante el primer arranque el instalador la
//   apunta a su pantalla de progreso (os/installer-ui, http://127.0.0.1:4080).
//
// Este binario es SOLO para el kiosco Linux (pantalla completa, un único programa visible). La
// versión de escritorio (Windows, "como Discord": ventana normal, se instala y actualiza sola) es
// un proyecto aparte con Electron en pos/desktop/ — no comparte este binario de Tauri, así que este
// archivo no necesita saber nada de eso.
//
// `open_devtools`: comando invocable desde el frontend (App.vue escucha F12) para abrir el inspector de la
// webview y poder leer la pestaña Red directamente en la pantalla del POS, sin SSH ni un navegador aparte.
// Requiere la feature "devtools" de tauri (ver Cargo.toml).

use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

const DEFAULT_URL: &str = "http://127.0.0.1:4000";

#[tauri::command]
fn open_devtools(app: tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        window.open_devtools();
    }
}

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![open_devtools])
        .setup(|app| {
            let raw = std::env::var("POS_WINDOW_URL").unwrap_or_else(|_| DEFAULT_URL.to_string());
            let url: tauri::Url = raw
                .parse()
                .unwrap_or_else(|_| DEFAULT_URL.parse().expect("URL por defecto valida"));
            WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url))
                .title("POS")
                .fullscreen(true)
                .decorations(false)
                // Sin .resizable(false): con tamano fijo (800x600 por defecto) el gestor de ventanas no puede
                // ponerla a pantalla completa y queda un cuadro pequeno en medio de una pantalla negra.
                .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error corriendo la aplicación de Tauri");
}

fn main() {
    run();
}
