# Changelog

## [0.3.1] — 2026-03-01

### Added
- **Cursor head tracking** — avatar head follows mouse cursor with 30% influence, smooth exponential lerp. Returns to camera after 5s idle.
- **Cursor eye tracking** — VRM lookAt proxy blends between camera and cursor target (lerp speed 3). Snappy, natural eye movement.
- **Zoom-aware idle modes** — auto-switches from air (floating/bobbing) to ground (breathing/sway) when zoomed in past distance 3. Smooth crossfade via `modeBlend` weight blending.
- **Desktop autostart** — app launches on OS startup via `tauri-plugin-autostart`. Toggle in Settings → General.
- **Desktop auto-hide UI** — gear button, status pills fade after 1s idle, reappear on mouse move.
- **Desktop window controls** — close (✕) and always-on-top (📌) floating buttons. Left-click drag to move window.
- **Desktop devtools** — enabled via Cargo `devtools` feature.

### Fixed
- Head/eye tracking deadzones removed — root cause (raycast plane position) fixed instead.
- Bloom effect preserves alpha transparency on desktop.
- Updater error toast silenced (console.warn only).

### Changed
- Raycast plane positioned at 10% from origin for optimal cursor spread.
- Idle mode transition is blended (both modes run simultaneously with weighted effects) instead of hard switch.


## [0.2.1] — 2026-03-01

### Fixed
- **Dynamic camera framing restored** — zoom-based orbit target (hips → upper chest between distance 4–2) was being permanently disabled by camera persistence and user interaction. Now stays active at all times.
- **Camera angle preserved across sessions** — persistence switched from raw position to spherical coordinates (distance + angles). Camera angle no longer drifts or resets after reload.
- **Camera state always saved** — added `beforeunload` flush so closing the tab mid-debounce no longer loses your camera position.
- **CI build fixed** — missing `@tauri-apps/plugin-process` and `@tauri-apps/plugin-updater` added to root lockfile.

## [0.2.0] — 2026-03-01

### Added
- **Desktop app** — Tauri v2 wrapper with transparent borderless window, custom titlebar, right-click rotate, and window drag.
- **Auto-updater** — check for updates, download, install, and restart from within the app.

### Fixed
- Identifier changed to `io.projectavatar.desktop`.
- TypeScript config fixes for Tauri imports.
- Titlebar, CSP, and resize handling from PR review.

## [0.1.0] — 2026-02-28

### Added
- **Visual effects system** — particle aura, energy trails, bloom + SMAA, holographic overlay. All toggleable from settings.
- **Mixamo finger retargeting** — 30 finger bone mappings, clips with finger tracks skip procedural curl.
- **Camera persistence** — save/restore camera position to localStorage.
- **Right-click pan** — left-click rotate, right-click pan, scroll zoom.
- Pan disabled — orbit target locked to model center.

### Fixed
- T-pose delay for smooth idle crossfade on load.
- Energy trail streaks on model switch.
- Effects delayed 500ms after model reveal.
- Master Maid PR review fixes (all HIGH + MEDIUM severity).
