# Desktop Changelog


## 0.8.0

### Changed
- **Small draggable window** — Replaced fullscreen overlay with a small borderless window. Click and drag the avatar to move the window across screens using native OS drag.
- **Native OS window drag** — Uses Tauri's `startDragging()` for smooth, 60fps, cross-monitor dragging. No manual position tracking.
- **No user resize** — Window is not resizable by the user. Auto-resize (future) will adjust to fit the model.

### Removed
- Fullscreen overlay mode (was causing high GPU usage on multi-monitor setups)
- Multi-monitor scissor rendering
- In-canvas pan/viewport offset (#101) — dragging now moves the window
- Monitor hot-plug detection

### Added
- `start_drag` Rust command — initiates native OS window drag
- `set_window_size` Rust command — for future auto-resize support

## 0.7.0

### Added
- **Fullscreen mode** — Window expands to fill the entire primary monitor on launch. No more manual resizing.
- **System tray** — App icon lives in the system tray with Settings and Quit menu items. No more taskbar icon.
- **Tray → Settings bridge** — "Settings" tray menu opens the settings drawer inside the app.

### Changed
- **Instant hover activation** — Removed the 0.5s hover delay on the avatar hitbox. Pan and rotate immediately on hover.
- **No window chrome** — Removed all visible chrome: drag grip, pin button, close button, dashed border, resize handles. The window is now fully invisible.
- **Skip taskbar** — Window no longer appears in the taskbar / dock. Only the tray icon is visible.
- **Window starts hidden** — Positioned and sized before becoming visible, preventing flash at default 400×600 size.

### Removed
- Edge/corner resize handles (window is fullscreen, not resizable)
- Drag grip handle (window is fullscreen, not movable)
- Pin/close buttons (quit via tray; always-on-top is always on)
- Dashed border overlay
- Window bounds persistence (always fullscreen)

## 0.6.3

### Added
- **Pan/move avatar** — Left or middle-click drag to reposition the avatar in the viewport. Position persisted across sessions. (#66)
- **Boundary clamping** — Avatar can never be dragged fully off-screen. Head stays within viewport vertically, body stays at least 50% visible horizontally.
- **Smart air/ground mode** — Idle mode now switches based on leg visibility instead of zoom distance. Mid-shin visible = air mode (dangling), mid-shin off-screen = ground mode (standing). Works with both zoom and pan.

### Changed
- **Middle mouse** reserved for pan — no longer triggers OrbitControls dolly.
- **Touch input** passes through to OrbitControls rotation (pan is mouse-only).

## 0.6.2

### Fixed
- **Idle look reset** — avatar head/eyes now return to forward after 5s of mouse inactivity. The click-through hook was resetting the idle timer every poll even when the cursor hadn't moved.

## 0.6.1

### Added
- **Click-through on transparent areas** — window passes clicks to apps behind it. Hover the avatar for 0.5s to activate; chrome, settings, and status pill appear. Leave the window for 1s to deactivate. (#70)
- **Drag protection** — holding a mouse button (dragging files/windows past the avatar) prevents accidental activation.
- **Dual-color border** — dashed white + black outline visible on both dark and light backgrounds.

### Changed
- **Single cursor poll** — hit-testing and head/eye tracking share one 5fps IPC call (`get_cursor_state`), eliminating duplicate polling.
- **Hitbox shape** — AABB expanded to cube for consistent feel from all angles, X/Z shrunk 1.5× for T-pose compensation.

### Technical
- New Rust commands: `set_ignore_cursor_events`, `get_cursor_state`, `is_mouse_button_pressed`
- `device_query` crate for cross-platform mouse button detection
- `DeviceState` cached with `LazyLock`
- VRM root exposed via `AvatarScene.vrmRoot`
- `AvatarCanvas`: `onScene`, `cursorPollMs`, `externalCursorPoll`, `onProjectCursor` props
- `App`: `activated` prop forces UI visible in desktop mode

## 0.6.0

*Version bump only — no user-facing changes.*

## 0.5.0

### Added
- **Remote asset loading** — assets fetched from web CDN instead of bundled locally. Desktop binary is dramatically smaller.
- **Loading progress bar** — shows model + animation download progress with smooth transitions and fade-out.

### Fixed
- **CSP policy** — `ipc.localhost`, `blob:`, and `app.projectavatar.io` added to Content Security Policy. Fixes Tauri IPC fallback and blob URL asset loading.

## 0.4.0

### Fixed
- **CSP connect-src** — added `http://ipc.localhost` and `blob:` to fix Tauri IPC custom protocol blocking and VRM/GLB blob URL loading.

## 0.3.1

### Polish
- **Deadzones removed** — head and eye tracking deadzones removed after fixing the underlying raycast plane positioning bug.
- **Smooth idle mode blending** — zooming in/out crossfades between air mode (floating) and ground mode (breathing) instead of hard-switching. Both modes run simultaneously during transition with effects scaled by weight.
- **Zoom-aware idle mode** — auto-switches to ground mode when camera distance < 3, preventing dizzy bobbing on close-ups.
- **Tuned tracking values** — head influence 30%, eye lerp speed 3, raycast plane at 10% from origin.


## 0.3.0

### New Features

- **Auto-hide UI** — Gear button, status pills, and window controls fade out after 1 second of mouse inactivity. Move the mouse to reveal them.
- **Window chrome** — Hover to reveal drag grip handle (top center), pin/close buttons (top right). Dashed border shows window bounds.
- **Always-on-top toggle** — Pin button (📌) keeps the avatar above all windows. Enabled by default.
- **Window position persistence** — Position and size saved to localStorage, restored on next launch.
- **Resize handles** — Drag edges (10px) or corners (20px) to resize. Border stays visible during resize.
- **Bloom transparency** — Bloom effect now works correctly over transparent backgrounds. Custom blending preserves alpha channel.
- **Autostart with OS** — App registers to launch on OS startup by default. Toggle in Settings → General.
- **Rounded window corners** — Content clipped to 12px border-radius.

### Cursor Tracking

- **Head follows cursor** — Avatar's head subtly turns toward the mouse cursor (40% influence, smooth exponential lerp).
- **Eye follows cursor** — VRM lookAt proxy blends between camera and cursor target for natural eye movement.
- **Dead zone** — Head ignores cursor within 0.3 units of the head position, preventing jitter when cursor crosses over the model.
- **5-second idle return** — Head and eyes smoothly return to looking at the camera after cursor stops moving.
- **Desktop global cursor** — Rust plugin (`mouse_position` crate) polls OS-level cursor position at ~30Hz. Tracks cursor even outside the window.
- **Tauri auto-detection** — Probes with real invoke before switching from mousemove to global polling. Falls back gracefully on web.
- **Bypass head/eye tracking** — Clips can set `bypassHeadTracking: true` to override cursor tracking (e.g. typing, searching animations).
- **Clip manager UI** — New "Bypass Head/Eye Tracking" checkbox in action editor.

### Fixes

- DevTools now available in production builds (`devtools` Cargo feature).
- Updater error toast silenced — logged to console only.
- Restored window bounds validated (rejects offscreen positions, corrupt data).
- Pin state synced from actual window on mount.
- Touch events supported in auto-hide (mobile/tablet).
- Chrome overlay no longer blocks gear button clicks.

## 0.2.3

- Transparency fixes for Windows (WebView2 env var, CSS overrides).
- Asset bundling via publicDir.
- CI trigger on master push.
- Signing key regenerated.

## 0.2.2

- Initial transparent window support.
- Titlebar overlay with resize handles.

## 0.2.1

- Initial desktop release with Tauri v2.
