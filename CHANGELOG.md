# Changelog

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
