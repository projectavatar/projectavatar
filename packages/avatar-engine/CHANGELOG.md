# @project-avatar/avatar-engine

## 1.1.0

### New Features

- **TalkingLayer** — procedural mouth viseme animation. Cycles through VRM visemes (`aa`, `ih`, `ou`, `ee`, `oh`) with weighted random selection, variable hold times, phrase breaks, smooth transitions, amplitude variation, and head micro-nods.
- **Mouth expression suppression** — when TalkingLayer is active, ExpressionController scales down mouth-affecting emotion expressions (`happy`, `sad`, `angry`, `surprised`) so visemes own the mouth while emotions keep eyes/brows.
- **`talkingLayer` in LayerState** — new dev panel toggle (defaults off) that acts as a manual preview trigger for talking animation.

### API

- `AnimationController.setTalking(active)` — start/stop procedural mouth animation
- `AnimationController.getTalkingBlend()` — current master blend (0–1) for suppression
- `ExpressionController.setMouthSuppression(amount)` — scale down mouth-affecting expressions
- `TalkingLayer` exported from package index

## 1.0.0

- Initial release.
