use mouse_position::mouse_position::Mouse;
use device_query::{DeviceQuery, DeviceState, MouseState};
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    AppHandle, Manager,
};

#[tauri::command]
fn get_cursor_position() -> Option<(i32, i32)> {
    match Mouse::get_mouse_position() {
        Mouse::Position { x, y } => Some((x, y)),
        Mouse::Error => None,
    }
}

/// Returns true if any mouse button is currently pressed.
#[tauri::command]
fn is_mouse_button_pressed() -> bool {
    let device_state = DeviceState::new();
    let mouse: MouseState = device_state.get_mouse();
    mouse.button_pressed.iter().skip(1).any(|&b| b)
}

/// Combines cursor position + button state in a single IPC call.
#[tauri::command]
fn get_cursor_state() -> Option<(i32, i32, bool)> {
    match Mouse::get_mouse_position() {
        Mouse::Position { x, y } => {
            let device_state = DeviceState::new();
            let mouse: MouseState = device_state.get_mouse();
            let pressed = mouse.button_pressed.iter().skip(1).any(|&b| b);
            Some((x, y, pressed))
        }
        Mouse::Error => None,
    }
}

#[tauri::command]
fn set_ignore_cursor_events(window: tauri::Window, ignore: bool) -> Result<(), String> {
    window
        .set_ignore_cursor_events(ignore)
        .map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(target_os = "windows")]
    std::env::set_var("WEBVIEW2_DEFAULT_BACKGROUND_COLOR", "0");

    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, None))
        .invoke_handler(tauri::generate_handler![
            get_cursor_position,
            set_ignore_cursor_events,
            is_mouse_button_pressed,
            get_cursor_state,
        ])
        .setup(|app| {
            // ── System tray ──────────────────────────────────────────────
            let settings_item = MenuItem::with_id(app, "settings", "Settings", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&settings_item, &quit_item])?;

            TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("Project Avatar")
                .menu(&menu)
                .on_menu_event(|app_handle: &AppHandle, event| {
                    match event.id.as_ref() {
                        "settings" => {
                            if let Some(window) = app_handle.get_webview_window("main") {
                                let _ = window.eval("window.__trayOpenSettings?.()");
                            }
                        }
                        "quit" => {
                            app_handle.exit(0);
                        }
                        _ => {}
                    }
                })
                .build(app)?;

            // ── Expand window to full primary monitor ────────────────────
            if let Some(window) = app.get_webview_window("main") {
                if let Ok(Some(monitor)) = window.primary_monitor() {
                    let size = monitor.size();
                    let pos = monitor.position();
                    let _ = window.set_position(tauri::Position::Physical(
                        tauri::PhysicalPosition { x: pos.x, y: pos.y },
                    ));
                    let _ = window.set_size(tauri::Size::Physical(tauri::PhysicalSize {
                        width: size.width,
                        height: size.height,
                    }));
                }

                // Show window after positioning (avoids flash at default size)
                let _ = window.show();

                // Windows transparency workaround
                #[cfg(target_os = "windows")]
                {
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
