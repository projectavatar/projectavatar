use mouse_position::mouse_position::Mouse;
use device_query::{DeviceQuery, DeviceState, MouseState};
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Emitter, AppHandle, Manager,
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

/// Called by the frontend when it's ready (transparent, rendered).
/// Expands 1×1 window to fullscreen, hides from taskbar, enables click-through.
#[tauri::command]
fn frontend_ready(window: tauri::Window) -> Result<(), String> {
    // Expand to primary monitor, fallback to 1920×1080 at (0,0)
    let (width, height, x, y) = match window.primary_monitor() {
        Ok(Some(monitor)) => {
            let size = monitor.size();
            let pos = monitor.position();
            (size.width, size.height, pos.x, pos.y)
        }
        _ => (1920, 1080, 0, 0),
    };

    window
        .set_position(tauri::Position::Physical(tauri::PhysicalPosition { x, y }))
        .map_err(|e| e.to_string())?;
    window
        .set_size(tauri::Size::Physical(tauri::PhysicalSize { width, height }))
        .map_err(|e| e.to_string())?;

    // Hide from taskbar
    let _ = window.set_skip_taskbar(true);

    // Enable click-through
    window
        .set_ignore_cursor_events(true)
        .map_err(|e| e.to_string())?;

    // Windows transparency workaround
    #[cfg(target_os = "windows")]
    {
        let current = window.outer_size().unwrap_or(tauri::PhysicalSize { width, height });
        if let Err(e) = window.set_size(tauri::Size::Physical(tauri::PhysicalSize {
            width: current.width + 1,
            height: current.height + 1,
        })) {
            eprintln!("transparency workaround: nudge failed: {e}");
        }
        if let Err(e) = window.set_size(tauri::Size::Physical(current)) {
            eprintln!("transparency workaround: restore failed: {e}");
        }
    }

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(target_os = "windows")]
    std::env::set_var("WEBVIEW2_DEFAULT_BACKGROUND_COLOR", "0");

    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .invoke_handler(tauri::generate_handler![
            get_cursor_position,
            set_ignore_cursor_events,
            is_mouse_button_pressed,
            get_cursor_state,
            frontend_ready,
        ])
        .setup(|app| {
            // ── System tray ──────────────────────────────────────────────
            let settings_item =
                MenuItem::with_id(app, "settings", "Settings", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&settings_item, &quit_item])?;

            let icon = app
                .default_window_icon()
                .cloned()
                .expect("default window icon must be set in tauri.conf.json");

            TrayIconBuilder::new()
                .icon(icon)
                .tooltip("Project Avatar")
                .menu(&menu)
                .on_menu_event(|app_handle: &AppHandle, event| {
                    match event.id.as_ref() {
                        "settings" => {
                            // Emit a Tauri event that the frontend listens for
                            let _ = app_handle.emit("tray-open-settings", ());
                        }
                        "quit" => {
                            app_handle.exit(0);
                        }
                        _ => {}
                    }
                })
                .build(app)?;

            // Window starts at 1×1 (invisible). frontend_ready command
            // expands it to fullscreen after the webview has rendered.
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
