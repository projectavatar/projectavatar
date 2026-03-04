use mouse_position::mouse_position::Mouse;
use device_query::{DeviceQuery, DeviceState, MouseState};
use std::sync::{Arc, Mutex};
use tauri::{
    menu::{CheckMenuItem, Menu, MenuItem, Submenu},
    tray::{TrayIcon, TrayIconBuilder},
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

/// Move the avatar window to fill the given monitor coordinates.
#[tauri::command]
fn move_to_monitor(window: tauri::Window, x: i32, y: i32, width: u32, height: u32) -> Result<(), String> {
    apply_monitor(&window, x, y, width, height)
}

#[derive(Clone, Debug)]
struct MonitorInfo {
    name: String,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
}

/// Shared state for the active monitor name (used for checkmark).
struct ActiveMonitorState {
    name: Mutex<String>,
}

/// Shared state for the tray icon (needed to update menu on hot-plug).
struct TrayState {
    tray: Mutex<Option<TrayIcon>>,
}

/// Build the tray menu with the current monitor list.
fn build_tray_menu(app: &AppHandle, active_name: &str) -> Result<(Menu<tauri::Wry>, Vec<MonitorInfo>), Box<dyn std::error::Error>> {
    let all_monitors = app.available_monitors().unwrap_or_default();
    let primary_name = app.primary_monitor().ok().flatten()
        .and_then(|m| m.name().cloned());

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

        // Check if this is the active monitor, or primary if no active set
        let is_checked = if active_name.is_empty() {
            primary_name.as_deref() == Some(&name)
        } else {
            name == active_name
        };

        monitor_items.push(
            CheckMenuItem::with_id(app, &format!("monitor_{}", i), &label, true, is_checked, None::<&str>)?
        );
        monitor_infos.push(MonitorInfo {
            name,
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

    Ok((menu, monitor_infos))
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
        .manage(ActiveMonitorState { name: Mutex::new(String::new()) })
        .manage(TrayState { tray: Mutex::new(None) })
        .invoke_handler(tauri::generate_handler![
            get_cursor_position,
            set_ignore_cursor_events,
            is_mouse_button_pressed,
            get_cursor_state,
            frontend_ready,
            move_to_monitor,
        ])
        .setup(|app| {
            let app_handle = app.handle().clone();

            // Build initial menu
            let active = app.state::<ActiveMonitorState>().name.lock().unwrap().clone();
            let (menu, monitor_infos) = build_tray_menu(&app_handle, &active)?;

            let icon = app
                .default_window_icon()
                .cloned()
                .expect("default window icon must be set in tauri.conf.json");

            let monitor_infos = Arc::new(Mutex::new(monitor_infos));
            let infos_for_event = Arc::clone(&monitor_infos);

            let tray = TrayIconBuilder::new()
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
                                // Clone the info we need, then drop the lock
                                let info = {
                                    let infos = infos_for_event.lock().unwrap();
                                    infos.get(idx).cloned()
                                };
                                if let Some(info) = info {
                                    let _ = app_handle.emit("move-to-monitor", serde_json::json!({
                                        "x": info.x, "y": info.y,
                                        "width": info.width, "height": info.height,
                                        "name": info.name,
                                    }));
                                    // Update active monitor state
                                    if let Some(state) = app_handle.try_state::<ActiveMonitorState>() {
                                        if let Ok(mut name) = state.name.lock() {
                                            *name = info.name.clone();
                                        }
                                    }
                                    // Rebuild menu with updated checkmarks
                                    if let Some(tray_state) = app_handle.try_state::<TrayState>() {
                                        if let Ok(tray_lock) = tray_state.tray.lock() {
                                            if let Some(tray) = tray_lock.as_ref() {
                                                if let Ok((new_menu, new_infos)) = build_tray_menu(app_handle, &info.name) {
                                                    let _ = tray.set_menu(Some(new_menu));
                                                    if let Ok(mut infos_mut) = infos_for_event.lock() {
                                                        *infos_mut = new_infos;
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                        _ => {}
                    }
                })
                .build(app)?;

            // Store tray icon for hot-plug updates
            if let Ok(mut tray_lock) = app.state::<TrayState>().tray.lock() {
                *tray_lock = Some(tray);
            }

            // ── Hot-plug monitor detection ──────────────────────────────
            let poll_handle = app.handle().clone();
            let poll_infos = Arc::clone(&monitor_infos);
            std::thread::spawn(move || {
                let mut last_count = 0usize;
                let mut last_names: Vec<String> = Vec::new();
                loop {
                    std::thread::sleep(std::time::Duration::from_secs(3));

                    let monitors = poll_handle.available_monitors().unwrap_or_default();
                    let names: Vec<String> = monitors.iter()
                        .map(|m| m.name().cloned().unwrap_or_default())
                        .collect();

                    if names.len() != last_count || names != last_names {
                        last_count = names.len();
                        last_names = names;

                        // Rebuild tray menu
                        let active = poll_handle.try_state::<ActiveMonitorState>()
                            .and_then(|s| s.name.lock().ok().map(|n| n.clone()))
                            .unwrap_or_default();

                        if let Ok((new_menu, new_infos)) = build_tray_menu(&poll_handle, &active) {
                            if let Some(tray_state) = poll_handle.try_state::<TrayState>() {
                                if let Ok(tray_lock) = tray_state.tray.lock() {
                                    if let Some(tray) = tray_lock.as_ref() {
                                        let _ = tray.set_menu(Some(new_menu));
                                    }
                                }
                            }
                            if let Ok(mut infos_mut) = poll_infos.lock() {
                                *infos_mut = new_infos;
                            }
                        }
                    }
                }
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
