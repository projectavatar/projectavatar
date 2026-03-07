# @project-avatar/shared

## 1.1.0

### New Features

- **`talking?: boolean` on AvatarEvent** — separate axis for mouth animation state, independent of `action`. Validated as optional boolean.

### Breaking Changes

- **`'talking'` removed from ACTIONS** — no longer a valid action string. Use the `talking` boolean field instead.

## 1.0.0

- Initial release.
