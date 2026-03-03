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

/// Returns the bounding rect (physical pixels) that spans all monitors.
/// Falls back to the primary monitor, then to 1920×1080 at (0,0).
/// Virtual screen info: bounds + max scale factor across all monitors.
#[derive(serde::Serialize)]
struct VirtualScreen {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    max_scale_factor: f64,
}

fn compute_virtual_screen(window: &tauri::Window) -> VirtualScreen {
    if let Ok(monitors) = window.available_monitors() {
        if !monitors.is_empty() {
            let mut min_x = i32::MAX;
            let mut min_y = i32::MAX;
            let mut max_x = i32::MIN;
            let mut max_y = i32::MIN;
            let mut max_scale: f64 = 1.0;

            for monitor in &monitors {
                let pos = monitor.position();
                let size = monitor.size();
                min_x = min_x.min(pos.x);
                min_y = min_y.min(pos.y);
                max_x = max_x.max(pos.x + size.width as i32);
                max_y = max_y.max(pos.y + size.height as i32);
                if monitor.scale_factor() > max_scale {
                    max_scale = monitor.scale_factor();
                }
            }

            let width = (max_x - min_x) as u32;
            let height = (max_y - min_y) as u32;
            return VirtualScreen { x: min_x, y: min_y, width, height, max_scale_factor: max_scale };
        }
    }

    // Fallback: primary monitor
    if let Ok(Some(monitor)) = window.primary_monitor() {
        let size = monitor.size();
        let pos = monitor.position();
        return VirtualScreen {
            x: pos.x, y: pos.y,
            width: size.width, height: size.height,
            max_scale_factor: monitor.scale_factor(),
        };
    }

    VirtualScreen { x: 0, y: 0, width: 1920, height: 1080, max_scale_factor: 1.0 }
}

/// Called by the frontend when it's ready (transparent, rendered).
/// Expands 1×1 window to span all monitors, hides from taskbar, enables click-through.
#[tauri::command]
fn frontend_ready(window: tauri::Window) -> Result<(), String> {
    let screen = compute_virtual_screen(&window);
    let (x, y, width, height) = (screen.x, screen.y, screen.width, screen.height);

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

/// Returns the virtual screen info (bounds + max scale factor) in physical pixels.
/// Used by the frontend to set correct pixel ratio and NDC coordinates.
#[tauri::command]
fn get_virtual_screen(window: tauri::Window) -> VirtualScreen {
    compute_virtual_screen(&window)
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
            get_virtual_screen,
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
