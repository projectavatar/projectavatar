import { DEFAULTS } from '@project-avatar/shared';
import type { AvatarEvent, Action, Intensity, EmotionBlend, PrimaryEmotion } from '@project-avatar/shared';
import type { ExpressionController } from './expression-controller.ts';
import type { AnimationController } from './animation-controller.ts';
import type { LayerState, ActiveClipInfo } from './animation-controller.ts';
import type { BlinkController } from './blink-controller.ts';
import type { PropManager } from './prop-manager.ts';
import type { VfxManager } from './effects/vfx-manager.ts';
import { resolveBlend, NEUTRAL_BLEND } from './emotion-blend.ts';
import type { ResolvedBlend } from './emotion-blend.ts';

/**
 * Avatar state machine coordinating all subsystems.
 *
 * Receives AvatarEvents (emotion blend format) from the WebSocket client
 * and dispatches to expression, animation, blink, prop, and VFX controllers.
 * Returns to idle after a configurable timeout of no events.
 *
 * The emotion blend drives all layers:
 *   - Face: VRM blend shapes via ExpressionController
 *   - Body: action inference from dominant emotion (or explicit action)
 *   - Idle: energy modulates procedural animation
 *   - VFX: color + intensity from blend
 */

// ─── Action inference from dominant emotion ───────────────────────────────────

const EMOTION_ACTION_MAP: Record<PrimaryEmotion, { low: Action; high: Action }> = {
  joy:      { low: 'nodding',     high: 'celebrating' },
  sadness:  { low: 'sad',         high: 'sad'         },
  anger:    { low: 'dismissive',  high: 'dismissive'  },
  fear:     { low: 'nervous',     high: 'nervous'     },
  surprise: { low: 'idle',        high: 'idle'        },  // future: startled clip
  interest: { low: 'idle',        high: 'idle'        },  // future: lean forward clip
  disgust:  { low: 'idle',        high: 'idle'        },  // future: recoil clip
};

function inferAction(blend: ResolvedBlend): Action {
  if (!blend.dominant) return 'idle';
  const entry = EMOTION_ACTION_MAP[blend.dominant];
  return blend.maxWeight >= 0.6 ? entry.high : entry.low;
}

// ─── State ────────────────────────────────────────────────────────────────────

interface AvatarState {
  emotions: EmotionBlend;
  blend: ResolvedBlend;
  action: Action;
  intensity: Intensity;
  lastEventTime: number;
}

const EMPTY_BLEND: EmotionBlend = {};

const DEFAULT_STATE: AvatarState = {
  emotions: EMPTY_BLEND,
  blend: { ...NEUTRAL_BLEND },
  action: 'idle',
  intensity: 'medium',
  lastEventTime: 0,
};

/** Event log entry for dev panel. */
export interface EventLogEntry {
  timestamp: number;
  emotions: EmotionBlend;
  action: Action;
  intensity?: Intensity;
  color?: string;
  dominant?: PrimaryEmotion | null;
  source: 'relay' | 'dev-panel' | 'system';
}

const MAX_LOG_ENTRIES = 50;

// ─── State Machine ────────────────────────────────────────────────────────────

export class StateMachine {
  private state: AvatarState = { ...DEFAULT_STATE, blend: { ...NEUTRAL_BLEND } };
  private expressionCtrl: ExpressionController;
  private animationCtrl: AnimationController;
  private blinkCtrl: BlinkController;
  private propManager: PropManager;
  private vfxManager: VfxManager | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private idleTimeoutMs: number;
  private onStateChange?: (state: Readonly<AvatarState>) => void;

  /** Event log — most recent events for dev panel inspection. */
  readonly eventLog: EventLogEntry[] = [];

  /** Callback when event log updates. */
  onEventLog?: (log: EventLogEntry[]) => void;

  constructor(
    expressionCtrl: ExpressionController,
    animationCtrl: AnimationController,
    blinkCtrl: BlinkController,
    propManager: PropManager,
    opts?: {
      idleTimeoutMs?: number;
      onStateChange?: (state: Readonly<AvatarState>) => void;
    },
  ) {
    this.expressionCtrl = expressionCtrl;
    this.animationCtrl = animationCtrl;
    this.blinkCtrl = blinkCtrl;
    this.propManager = propManager;
    this.idleTimeoutMs = opts?.idleTimeoutMs ?? DEFAULTS.idleTimeoutMs;
    this.onStateChange = opts?.onStateChange;

    // When a non-looping animation finishes, return to idle action
    this.animationCtrl.onActionFinished = () => {
      this.state.action = 'idle';
      this.animationCtrl.playAction('idle', this.state.intensity);
      this.onStateChange?.(this.state);
    };

    // When animation controller selects a new clip group, update the prop
    this.animationCtrl.onPropChange = (binding) => {
      void this.propManager.setPropBinding(binding);
    };
  }

  /** Get current state (read-only). */
  get current(): Readonly<AvatarState> {
    return this.state;
  }

  /** Handle an incoming avatar event from the relay. */
  handleEvent(event: AvatarEvent, source: 'relay' | 'dev-panel' | 'system' = 'relay'): void {
    const prev = { ...this.state };

    this.state.lastEventTime = Date.now();

    // Resolve the emotion blend
    const blend = resolveBlend(event.emotions, event.color);
    this.state.emotions = event.emotions;
    this.state.blend = blend;

    // Log the event
    this._logEvent(event, source, blend);

    // Update intensity
    if (event.intensity && event.intensity !== prev.intensity) {
      this.state.intensity = event.intensity;
    }

    // Update face — expression controller handles multi-primary blend shapes
    this.expressionCtrl.setEmotionBlend(blend);

    // Update body action — explicit action takes priority, otherwise infer
    const action = event.action !== 'idle' ? event.action : inferAction(blend);
    if (action !== prev.action) {
      this.state.action = action;
      this.animationCtrl.playAction(action, this.state.intensity);
    }

    // Notify animation controller of emotion change (for clip overrides)
    const emotionKey = blend.dominant ?? 'idle';
    this.animationCtrl.setEmotion(emotionKey);

    // Update VFX with blend
    this.vfxManager?.setBlendState(blend, this.state.action);

    // Notify listener
    this.onStateChange?.(this.state);

    // Reset idle timer
    this.resetIdleTimer();
  }

  /** Set VFX manager (optional, added post-construction). */
  setVfxManager(mgr: VfxManager): void {
    this.vfxManager = mgr;
    // Apply initial state
    mgr.setBlendState(this.state.blend, this.state.action);
  }

  /** Set camera for head tracking. */
  setCamera(camera: import('three').Camera): void {
    this.animationCtrl.setCamera(camera);
  }

  /** Set a layer toggle. */
  setLayer(layer: keyof LayerState, enabled: boolean): void {
    this.animationCtrl.setLayer(layer, enabled);
  }

  /** Get current layer state. */
  get layerState(): Readonly<LayerState> {
    return this.animationCtrl.layers;
  }

  /**
   * Update all subsystems. Call every frame.
   *
   * Order matters:
   * 1. AnimationController: mixer ticks FBX clips, then idle layer adds noise
   * 2. ExpressionController: blend shapes (on top of mixer)
   * 3. BlinkController: blink + micro-glance (expression-level, last)
   */
  update(delta: number): void {
    this.animationCtrl.update(delta);

    // Prop fade animations — pass bob offset so props track the idle layer bob
    const bobOffset = this.animationCtrl.getIdleBobOffset();
    this.propManager.update(delta, bobOffset);

    // VFX animations
    this.vfxManager?.update(delta);

    // Expression layers respect toggles
    const layers = this.animationCtrl.layers;
    if (layers.expressions) {
      this.expressionCtrl.update(delta, layers.expressions);
    }
    if (layers.blink) {
      this.blinkCtrl.update(delta);
    }
  }

  /** Get info about currently active animation clips. */
  getActiveClips(): ActiveClipInfo[] {
    return this.animationCtrl.getActiveClips();
  }

  /** Clean up timers. */
  dispose(): void {
    if (this.idleTimer !== null) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    this.vfxManager?.clear();
    this.vfxManager = null;
    this.propManager.clear();
  }

  private resetIdleTimer(): void {
    if (this.idleTimer !== null) {
      clearTimeout(this.idleTimer);
    }
    this.idleTimer = setTimeout(() => {
      this.handleEvent({ emotions: {}, action: 'idle', prop: 'none' }, 'system');
    }, this.idleTimeoutMs);
  }

  private _logEvent(event: AvatarEvent, source: 'relay' | 'dev-panel' | 'system', blend: ResolvedBlend): void {
    this.eventLog.unshift({
      timestamp: Date.now(),
      emotions: event.emotions,
      action: event.action,
      intensity: event.intensity,
      color: event.color,
      dominant: blend.dominant,
      source,
    });
    if (this.eventLog.length > MAX_LOG_ENTRIES) {
      this.eventLog.length = MAX_LOG_ENTRIES;
    }
    this.onEventLog?.(this.eventLog);
  }
}
