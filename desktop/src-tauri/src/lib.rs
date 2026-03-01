#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Force WebView2 transparent background via environment variable.
    // This must be set BEFORE the webview is created.
    // See: https://github.com/MicrosoftEdge/WebView2Feedback/issues/2899
    #[cfg(target_os = "windows")]
    std::env::set_var("WEBVIEW2_DEFAULT_BACKGROUND_COLOR", "0");

    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|_app| {
            // Workaround: WebView2 on Windows doesn't apply transparency until a
            // resize event forces it to repaint. Nudging the window size by 1px
            // and restoring it triggers the repaint without any visible flicker.
            // See: https://github.com/tauri-apps/tauri/issues/8133
            #[cfg(target_os = "windows")]
            {
                use tauri::Manager;
                if let Some(window) = _app.get_webview_window("main") {
                    // Fallback matches tauri.conf.json default (400×600)
                    let size = window.outer_size().unwrap_or(tauri::PhysicalSize {
                        width: 400,
                        height: 600,
                    });
                    if let Err(e) = window.set_size(tauri::Size::Physical(tauri::PhysicalSize {
                        width: size.width + 1,
                        height: size.height + 1,
                    })) {
                        eprintln!("transparency workaround: nudge failed: {e}");
                    }
                    if let Err(e) = window.set_size(tauri::Size::Physical(size)) {
                        eprintln!("transparency workaround: restore failed: {e}");
                    }
                }
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
