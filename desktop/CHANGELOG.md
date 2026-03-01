# Desktop Changelog

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
