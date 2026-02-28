import type { VRM } from '@pixiv/three-vrm';

/**
 * Random eye blink + occasional micro-glance.
 * Runs independently of agent events — makes the avatar feel alive.
 */
export class BlinkController {
  private vrm: VRM;
  private nextBlinkTime = 0;
  private blinkPhase: 'idle' | 'closing' | 'opening' = 'idle';
  private blinkProgress = 0;
  private blinkDuration = 0.15; // seconds per phase (close + open)
  private elapsed = 0;

  // Micro-glance state
  private glanceTarget: { x: number; y: number } = { x: 0, y: 0 };
  private glanceCurrent: { x: number; y: number } = { x: 0, y: 0 };
  private shouldGlance = false;

  constructor(vrm: VRM) {
    this.vrm = vrm;
    this.scheduleNextBlink();
  }

  /** Call every frame with delta time. */
  update(delta: number): void {
    this.elapsed += delta;

    if (!this.vrm.expressionManager) return;

    // Handle blink
    this.updateBlink(delta);

    // Handle micro-glance
    this.updateGlance(delta);
  }

  private updateBlink(delta: number): void {
    const em = this.vrm.expressionManager;
    if (!em) return;

    switch (this.blinkPhase) {
      case 'idle':
        if (this.elapsed >= this.nextBlinkTime) {
          this.blinkPhase = 'closing';
          this.blinkProgress = 0;

          // 10-15% chance of micro-glance on blink
          this.shouldGlance = Math.random() < 0.12;
          if (this.shouldGlance) {
            this.glanceTarget = {
              x: (Math.random() - 0.5) * 0.3, // subtle horizontal
              y: (Math.random() - 0.5) * 0.15, // very subtle vertical
            };
          }
        }
        break;

      case 'closing':
        this.blinkProgress += delta / this.blinkDuration;
        if (this.blinkProgress >= 1) {
          this.blinkProgress = 1;
          this.blinkPhase = 'opening';
          em.setValue('blink', 1);
        } else {
          em.setValue('blink', this.blinkProgress);
        }
        break;

      case 'opening':
        this.blinkProgress -= delta / this.blinkDuration;
        if (this.blinkProgress <= 0) {
          this.blinkProgress = 0;
          this.blinkPhase = 'idle';
          em.setValue('blink', 0);
          this.scheduleNextBlink();
        } else {
          em.setValue('blink', this.blinkProgress);
        }
        break;
    }
  }

  private updateGlance(delta: number): void {
    const em = this.vrm.expressionManager;
    if (!em) return;

    const speed = 4.0;

    if (this.shouldGlance && this.blinkPhase === 'opening') {
      // Move eyes toward glance target during blink open
      this.glanceCurrent.x += (this.glanceTarget.x - this.glanceCurrent.x) * Math.min(speed * delta, 1);
      this.glanceCurrent.y += (this.glanceTarget.y - this.glanceCurrent.y) * Math.min(speed * delta, 1);
    } else {
      // Return eyes to center
      this.glanceCurrent.x += (0 - this.glanceCurrent.x) * Math.min(speed * delta, 1);
      this.glanceCurrent.y += (0 - this.glanceCurrent.y) * Math.min(speed * delta, 1);
    }

    // Apply as lookLeft/lookRight and lookUp/lookDown
    if (Math.abs(this.glanceCurrent.x) > 0.01) {
      if (this.glanceCurrent.x > 0) {
        em.setValue('lookRight', this.glanceCurrent.x);
        em.setValue('lookLeft', 0);
      } else {
        em.setValue('lookLeft', -this.glanceCurrent.x);
        em.setValue('lookRight', 0);
      }
    }

    if (Math.abs(this.glanceCurrent.y) > 0.01) {
      if (this.glanceCurrent.y > 0) {
        em.setValue('lookUp', this.glanceCurrent.y);
        em.setValue('lookDown', 0);
      } else {
        em.setValue('lookDown', -this.glanceCurrent.y);
        em.setValue('lookUp', 0);
      }
    }
  }

  /** Schedule the next blink at a random interval (3-7 seconds from now). */
  private scheduleNextBlink(): void {
    this.nextBlinkTime = this.elapsed + 3 + Math.random() * 4;
  }
}
