fn main() {
    // Los comandos propios de la app (no de un plugin) necesitan declararse aqui para que Tauri genere su
    // permiso "allow-<comando>"/"deny-<comando>"; sin esto, capabilities/default.json no puede referenciarlo
    // y el comando queda bloqueado en runtime con "not allowed by ACL" aunque compile sin errores.
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(&["open_devtools"])),
    )
    .expect("error generando los permisos de Tauri");
}
