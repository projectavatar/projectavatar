# Desktop Changelog

## [0.2.2] — 2026-03-01

### Fixed
- Window transparency now works on Windows — added `backgroundColor: [0,0,0,0]` to WebView2 config + resize workaround as safety net.
- Updater signing — regenerated key with a real password, CI reads from GitHub Secrets properly.
- CI changelog extraction — `shell: bash` ensures `awk` works on Windows runners.
- Titlebar no longer overlaps UI elements — settings button and drawer offset by `--titlebar-inset` CSS variable (32px).
- Assets (models, animations, props) now bundled in desktop build — Vite `publicDir` points to `web/public`.

### Changed
- Desktop build triggers on `master` merge instead of `release` branch.

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
