import { DEFAULTS } from '@project-avatar/shared';
import type { AvatarEvent, Action, Intensity, EmotionBlend, PrimaryEmotion } from '@project-avatar/shared';
import type { ExpressionController } from './expression-controller.ts';
import type { AnimationController } from './animation-controller.ts';
import type { LayerState, ActiveClipInfo } from './animation-controller.ts';
import type { BlinkController } from './blink-controller.ts';
import type { PropManager } from './prop-manager.ts';
import type { VfxManager } from './effects/vfx-manager.ts';
import { resolveBlend, EmotionDecay } from './emotion-blend.ts';
import type { ResolvedBlend } from './emotion-blend.ts';

/**
 * Avatar state machine coordinating all subsystems.
 *
 * Receives AvatarEvents (emotion blend format) from the WebSocket client
 * and dispatches to expression, animation, blink, prop, and VFX controllers.
 *
 * Emotion decay: after the idle timeout, emotions don't snap to zero —
 * they decay gradually toward a neutral baseline ({ joy: 0.1, interest: 0.1 }).
 * The avatar is never truly blank.
 */

// ─── Action inference from dominant emotion ───────────────────────────────────

const EMOTION_ACTION_MAP: Record<PrimaryEmotion, { low: Action; high: Action }> = {
  joy:      { low: 'nodding',     high: 'celebrating' },
  sadness:  { low: 'sad',         high: 'sad'         },
  anger:    { low: 'dismissive',  high: 'dismissive'  },
  fear:     { low: 'nervous',     high: 'nervous'     },
  surprise: { low: 'idle',        high: 'idle'        },
  interest: { low: 'idle',        high: 'idle'        },
  disgust:  { low: 'idle',        high: 'idle'        },
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
  private state: AvatarState;
  private expressionCtrl: ExpressionController;
  private animationCtrl: AnimationController;
  private blinkCtrl: BlinkController;
  private propManager: PropManager;
  private vfxManager: VfxManager | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private idleTimeoutMs: number;
  private onStateChange?: (state: Readonly<AvatarState>) => void;

  /** Emotion decay — smooth interpolation toward neutral. */
  private decay: EmotionDecay;

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

    // Initialize decay and state
    this.decay = new EmotionDecay();
    this.state = {
      emotions: EMPTY_BLEND,
      blend: this.decay.blend,
      action: 'idle',
      intensity: 'medium',
      lastEventTime: 0,
    };

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
    this.state.emotions = event.emotions;

    // Resolve the emotion blend
    const blend = resolveBlend(event.emotions, event.color);
    this.state.blend = blend;

    // Set as decay target — weights will interpolate toward this
    this.decay.setTarget(blend, event.color);

    // Log the event
    this._logEvent(event, source, blend);

    // Update intensity
    if (event.intensity && event.intensity !== prev.intensity) {
      this.state.intensity = event.intensity;
    }

    // Update face — expression controller reads from decay's blend each frame
    // (initial snap handled by decay's fast interpolation)

    // Update body action — explicit non-idle action takes priority, otherwise infer
    // Infer action from dominant emotion when action is 'idle' and emotions are active.
    // Explicit non-idle actions always take priority.
    // Empty emotions + idle = real idle (no inference).
    const hasExplicitEmotions = Object.keys(event.emotions).length > 0;
    const action = (event.action === 'idle' && hasExplicitEmotions) ? inferAction(blend) : event.action;
    if (action !== prev.action) {
      this.state.action = action;
      this.animationCtrl.playAction(action, this.state.intensity);
    }

    // Notify animation controller of emotion change (for clip overrides)
    const emotionKey = blend.dominant ?? 'idle';
    this.animationCtrl.setEmotion(emotionKey);

    // VFX updated each frame via decay blend — initial dispatch for action fallback
    this.vfxManager?.setBlendState(blend, this.state.action);

    // Notify listener
    this.onStateChange?.(this.state);

    // Reset idle timer
    this.resetIdleTimer();
  }

  /** Set VFX manager (optional, added post-construction). */
  setVfxManager(mgr: VfxManager): void {
    this.vfxManager = mgr;
    mgr.setBlendState(this.decay.blend, this.state.action);
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
   * Order:
   * 1. EmotionDecay: interpolate weights toward target/neutral
   * 2. AnimationController: mixer ticks FBX clips, idle layer adds noise
   * 3. ExpressionController: blend shapes from decayed blend
   * 4. VFX: update with decayed blend
   * 5. BlinkController: blink + micro-glance (last)
   */
  update(delta: number): void {
    // Tick emotion decay — updates blend weights smoothly
    const blendChanged = this.decay.update(delta);

    if (blendChanged) {
      const blend = this.decay.blend;
      this.state.blend = blend;

      // Update face from decayed blend
      this.expressionCtrl.setEmotionBlend(blend);

      // Update VFX color/selection from decayed blend
      this.vfxManager?.setBlendState(blend, this.state.action);

      // If decaying and dominant changed, update action inference
      if (this.decay.isDecaying) {
        const inferredAction = inferAction(blend);
        if (inferredAction !== this.state.action) {
          this.state.action = inferredAction;
          this.animationCtrl.playAction(inferredAction, this.state.intensity);
        }
        const emotionKey = blend.dominant ?? 'idle';
        this.animationCtrl.setEmotion(emotionKey);
      }
    }

    this.animationCtrl.update(delta);

    const bobOffset = this.animationCtrl.getIdleBobOffset();
    this.propManager.update(delta, bobOffset);

    this.vfxManager?.update(delta);

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
      // Start decay — emotions will gradually settle toward neutral.
      // Don't snap action to idle immediately — let the decay-driven
      // action inference handle the transition smoothly.
      this.decay.startDecay();
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
