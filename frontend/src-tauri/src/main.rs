// Punto de entrada nativo. Deliberadamente delgado: toda la logica de negocio vive en el backend Node
// (127.0.0.1:4000) y la pantalla la sirve ese mismo backend. Este binario solo aloja la webview en pantalla
// completa: por eso casi nunca cambia y forma parte de la imagen del sistema operativo. NO lleva el plugin
// updater de Tauri: la aplicacion (backend + pantalla) se actualiza con os/updater, que si puede actualizar el
// backend y sus migraciones.
//
// La ventana se crea aqui (y no en tauri.conf.json) para poder elegir la direccion al arrancar:
//   POS_WINDOW_URL  (por defecto http://127.0.0.1:4000, el POS). Durante el primer arranque el instalador la
//   apunta a su pantalla de progreso (os/installer-ui, http://127.0.0.1:4080).

use tauri::{WebviewUrl, WebviewWindowBuilder};

const DEFAULT_URL: &str = "http://127.0.0.1:4000";

pub fn run() {
    tauri::Builder::default()
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
