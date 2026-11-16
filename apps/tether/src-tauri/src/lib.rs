#[cfg(target_os = "android")]
mod web_assets;

use std::path::Path;

#[tauri::command]
fn is_flatpak() -> bool {
    Path::new("/.flatpak-info").exists() || std::env::var_os("FLATPAK_ID").is_some()
}

#[tauri::command]
fn app_info() -> serde_json::Value {
    serde_json::json!({
        "name": "opencode-tether",
        "version": env!("CARGO_PKG_VERSION"),
        "identifier": "ai.opencode.tether",
        "flatpak": is_flatpak(),
        "os": std::env::consts::OS,
        "arch": std::env::consts::ARCH,
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[allow(unused_mut)]
    let mut context = tauri::generate_context!();
    #[cfg(target_os = "android")]
    context.set_assets(Box::new(web_assets::WebAssets));
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![is_flatpak, app_info])
        .run(context)
        .expect("error while running opencode-tether");
}
