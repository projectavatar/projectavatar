use mouse_position::mouse_position::Mouse;
use device_query::{DeviceQuery, DeviceState, MouseState};
use tauri::{
    menu::{CheckMenuItem, Menu, MenuItem, Submenu},
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

#[tauri::command]
fn is_mouse_button_pressed() -> bool {
    let device_state = DeviceState::new();
    let mouse: MouseState = device_state.get_mouse();
    mouse.button_pressed.iter().skip(1).any(|&b| b)
}

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

/// Position and size a window to fill a monitor, with Windows transparency workaround.
fn apply_monitor(window: &tauri::Window, x: i32, y: i32, width: u32, height: u32) -> Result<(), String> {
    window
        .set_position(tauri::Position::Physical(tauri::PhysicalPosition { x, y }))
        .map_err(|e| e.to_string())?;
    window
        .set_size(tauri::Size::Physical(tauri::PhysicalSize { width, height }))
        .map_err(|e| e.to_string())?;

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

#[tauri::command]
fn frontend_ready(window: tauri::Window) -> Result<(), String> {
    let (width, height, x, y) = match window.primary_monitor() {
        Ok(Some(monitor)) => {
            let size = monitor.size();
            let pos = monitor.position();
            (size.width, size.height, pos.x, pos.y)
        }
        _ => (1920, 1080, 0, 0),
    };

    apply_monitor(&window, x, y, width, height)?;
    let _ = window.set_skip_taskbar(true);
    window
        .set_ignore_cursor_events(true)
        .map_err(|e| e.to_string())?;

    Ok(())
}

/// Move the avatar to a specific monitor by index (called from tray menu via event).
#[tauri::command]
fn move_to_monitor(window: tauri::Window, x: i32, y: i32, width: u32, height: u32) -> Result<(), String> {
    apply_monitor(&window, x, y, width, height)
}

#[derive(Clone)]
struct MonitorInfo {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
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
            move_to_monitor,
        ])
        .setup(|app| {
            let all_monitors = app.available_monitors().unwrap_or_default();

            let mut monitor_items: Vec<CheckMenuItem<tauri::Wry>> = Vec::new();
            let mut monitor_infos: Vec<MonitorInfo> = Vec::new();
            for (i, monitor) in all_monitors.iter().enumerate() {
                let name = monitor.name().cloned().unwrap_or_default();
                let size = monitor.size();
                let pos = monitor.position();
                let label = if name.is_empty() {
                    format!("Monitor {} ({}x{})", i + 1, size.width, size.height)
                } else {
                    format!("{} ({}x{})", name, size.width, size.height)
                };
                let is_primary = i == 0;
                monitor_items.push(
                    CheckMenuItem::with_id(app, &format!("monitor_{}", i), &label, true, is_primary, None::<&str>)?
                );
                monitor_infos.push(MonitorInfo {
                    x: pos.x, y: pos.y,
                    width: size.width, height: size.height,
                });
            }

            let monitor_refs: Vec<&dyn tauri::menu::IsMenuItem<tauri::Wry>> =
                monitor_items.iter().map(|m| m as &dyn tauri::menu::IsMenuItem<tauri::Wry>).collect();
            let monitor_submenu = Submenu::with_items(app, "Move to Screen", true, &monitor_refs)?;

            let settings_item = MenuItem::with_id(app, "settings", "Settings", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;

            let menu = Menu::with_items(app, &[
                &monitor_submenu as &dyn tauri::menu::IsMenuItem<tauri::Wry>,
                &settings_item as &dyn tauri::menu::IsMenuItem<tauri::Wry>,
                &quit_item as &dyn tauri::menu::IsMenuItem<tauri::Wry>,
            ])?;

            let icon = app
                .default_window_icon()
                .cloned()
                .expect("default window icon must be set in tauri.conf.json");

            // Clone check items for the event handler
            let check_items: Vec<_> = monitor_items.iter().map(|m| m.clone()).collect();

            TrayIconBuilder::new()
                .icon(icon)
                .tooltip("Project Avatar")
                .menu(&menu)
                .on_menu_event(move |app_handle: &AppHandle, event| {
                    let id = event.id.as_ref();
                    match id {
                        "settings" => {
                            let _ = app_handle.emit("tray-open-settings", ());
                        }
                        "quit" => {
                            app_handle.exit(0);
                        }
                        _ if id.starts_with("monitor_") => {
                            if let Ok(idx) = id.strip_prefix("monitor_").unwrap_or("").parse::<usize>() {
                                if let Some(info) = monitor_infos.get(idx) {
                                    let _ = app_handle.emit("move-to-monitor", serde_json::json!({
                                        "x": info.x, "y": info.y,
                                        "width": info.width, "height": info.height,
                                    }));
                                    // Update check marks
                                    for (j, item) in check_items.iter().enumerate() {
                                        let _ = item.set_checked(j == idx);
                                    }
                                }
                            }
                        }
                        _ => {}
                    }
                })
                .build(app)?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
