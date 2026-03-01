# Desktop Changelog

## [0.2.1] — 2026-03-01

### Fixed
- Camera angle no longer lost after restart — persistence uses spherical coordinates instead of raw position.
- Dynamic camera framing (zoom in → focus shifts from hips to upper chest) now works reliably.
- Camera state always saved on close (no more lost state from debounce race).

## [0.2.0] — 2026-03-01

### Added
- Initial desktop release — Tauri v2, transparent borderless window, custom titlebar.
- Auto-updater — check, download, install, restart.
- Right-click to rotate camera (left-click reserved for window drag).

### Fixed
- App identifier set to `io.projectavatar.desktop`.
