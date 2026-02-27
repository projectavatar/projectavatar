import { DEFAULTS } from '@project-avatar/shared';
import type { AvatarEvent, Emotion, Action, Prop, Intensity } from '@project-avatar/shared';
import type { ExpressionController } from './expression-controller.ts';
import type { AnimationController } from './animation-controller.ts';
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

export class StateMachine {
  private state: AvatarState = { ...DEFAULT_STATE };
  private expressionCtrl: ExpressionController;
  private animationCtrl: AnimationController;
  private blinkCtrl: BlinkController;
  private propManager: PropManager;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private idleTimeoutMs: number;
  private onStateChange?: (state: Readonly<AvatarState>) => void;

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
  }

  /** Get current state (read-only). */
  get current(): Readonly<AvatarState> {
    return this.state;
  }

  /** Handle an incoming avatar event from the relay. */
  handleEvent(event: AvatarEvent): void {
    const prev = { ...this.state };

    this.state.lastEventTime = Date.now();

    // Update intensity first (used by subsequent updates)
    if (event.intensity && event.intensity !== prev.intensity) {
      this.state.intensity = event.intensity;
    }

    // Update emotion
    if (event.emotion && event.emotion !== prev.emotion) {
      this.state.emotion = event.emotion;
      this.expressionCtrl.setEmotion(event.emotion, this.state.intensity);
    }

    // Update action
    if (event.action && event.action !== prev.action) {
      this.state.action = event.action;
      this.animationCtrl.playAction(event.action, this.state.intensity);
    }

    // Update prop
    if (event.prop !== undefined && event.prop !== prev.prop) {
      this.state.prop = event.prop;
      void this.propManager.setProp(event.prop);
    }

    // Notify listener
    this.onStateChange?.(this.state);

    // Reset idle timer
    this.resetIdleTimer();
  }

  /** Update all subsystems. Call every frame with delta time. */
  update(delta: number): void {
    // Order matters: mixer must write bone values before expression controller
    // applies its additive head offset on top. Blink runs last (also expression-level).
    this.animationCtrl.update(delta);
    this.expressionCtrl.update(delta);
    this.blinkCtrl.update(delta);
  }

  /** Clean up timers. */
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
      this.handleEvent({ emotion: 'idle', action: 'idle', prop: 'none' });
    }, this.idleTimeoutMs);
  }
}
