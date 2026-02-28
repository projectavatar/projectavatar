import { DEFAULTS } from '@project-avatar/shared';
import type { AvatarEvent, Emotion, Action, Prop, Intensity } from '@project-avatar/shared';
import type { ExpressionController } from './expression-controller.ts';
import type { AnimationController } from './animation-controller.ts';
import type { LayerState, ActiveClipInfo } from './animation-controller.ts';
import type { BlinkController } from './blink-controller.ts';
import type { PropManager } from './prop-manager.ts';

/**
 * Avatar state machine coordinating all subsystems.
 *
 * Receives AvatarEvents from the WebSocket client and dispatches
 * to expression, animation, blink, and prop controllers.
 * Returns to idle after a configurable timeout of no events.
 */

interface AvatarState {
  emotion: Emotion;
  action: Action;
  prop: Prop;
  intensity: Intensity;
  lastEventTime: number;
}

const DEFAULT_STATE: AvatarState = {
  emotion: 'idle',
  action: 'idle',
  prop: 'none',
  intensity: 'medium',
  lastEventTime: 0,
};

/** Event log entry for dev panel. */
export interface EventLogEntry {
  timestamp: number;
  emotion: Emotion;
  action: Action;
  prop?: Prop;
  intensity?: Intensity;
  source: 'relay' | 'dev-panel' | 'system';
}

const MAX_LOG_ENTRIES = 50;

export class StateMachine {
  private state: AvatarState = { ...DEFAULT_STATE };
  private expressionCtrl: ExpressionController;
  private animationCtrl: AnimationController;
  private blinkCtrl: BlinkController;
  private propManager: PropManager;
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

    this.animationCtrl.onActionFinished = () => {
      this.state.action = 'idle';
      this.animationCtrl.playAction('idle', this.state.intensity, this.state.emotion);
      this.onStateChange?.(this.state);
    };
  }

  get current(): Readonly<AvatarState> {
    return this.state;
  }

  handleEvent(event: AvatarEvent, source: 'relay' | 'dev-panel' | 'system' = 'relay'): void {
    const prev = { ...this.state };

    this.state.lastEventTime = Date.now();
    this._logEvent(event, source);

    if (event.intensity && event.intensity !== prev.intensity) {
      this.state.intensity = event.intensity;
    }

    if (event.emotion && event.emotion !== prev.emotion) {
      this.state.emotion = event.emotion;
      this.expressionCtrl.setEmotion(event.emotion, this.state.intensity);
      this.animationCtrl.setEmotion(event.emotion);
    }

    if (event.action && event.action !== prev.action) {
      this.state.action = event.action;
      this.animationCtrl.playAction(event.action, this.state.intensity, this.state.emotion);
    }

    if (event.prop !== undefined && event.prop !== prev.prop) {
      this.state.prop = event.prop;
      void this.propManager.setProp(event.prop);
    }

    this.onStateChange?.(this.state);
    this.resetIdleTimer();
  }

  setLayer(layer: keyof LayerState, enabled: boolean): void {
    this.animationCtrl.setLayer(layer, enabled);
  }

  get layerState(): Readonly<LayerState> {
    return this.animationCtrl.layers;
  }

  /**
   * Update all subsystems. Call every frame with delta time.
   *
   * Order matters:
   * 1. AnimationController: mixer ticks FBX clips, then idle layer adds noise
   * 2. ExpressionController: blend shapes + additive head offset (on top of mixer)
   * 3. BlinkController: blink + micro-glance (expression-level, last)
   */
  update(delta: number): void {
    this.animationCtrl.update(delta);

    const layers = this.animationCtrl.layers;
    if (layers.expressions || layers.headOffset) {
      this.expressionCtrl.update(delta, layers.expressions, layers.headOffset);
    }
    if (layers.blink) {
      this.blinkCtrl.update(delta);
    }
  }

  getActiveClips(): ActiveClipInfo[] {
    return this.animationCtrl.getActiveClips();
  }

  dispose(): void {
    if (this.idleTimer !== null) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  private resetIdleTimer(): void {
    if (this.idleTimer !== null) {
      clearTimeout(this.idleTimer);
    }
    this.idleTimer = setTimeout(() => {
      this.handleEvent({ emotion: 'idle', action: 'idle', prop: 'none' }, 'system');
    }, this.idleTimeoutMs);
  }

  private _logEvent(event: AvatarEvent, source: 'relay' | 'dev-panel' | 'system'): void {
    this.eventLog.unshift({
      timestamp: Date.now(),
      emotion: event.emotion,
      action: event.action,
      prop: event.prop,
      intensity: event.intensity,
      source,
    });
    if (this.eventLog.length > MAX_LOG_ENTRIES) {
      this.eventLog.length = MAX_LOG_ENTRIES;
    }
    this.onEventLog?.(this.eventLog);
  }
}
