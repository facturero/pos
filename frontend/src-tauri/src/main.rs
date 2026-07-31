// Punto de entrada nativo. Deliberadamente delgado: toda la lógica de
// negocio vive en el backend Node (localhost:4000) y en el frontend Vue.
// Este binario solo es el "shell" que aloja la webview + el auto-updater,
// como el .exe de Discord.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|_app| {
            // Aquí, si hace falta, se podría lanzar/verificar el backend
            // local como "sidecar" (ver tauri.conf.json -> bundle.externalBin)
            // en vez de depender de que el usuario lo arranque a mano.
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error corriendo la aplicación de Tauri");
}

fn main() {
    run();
}
