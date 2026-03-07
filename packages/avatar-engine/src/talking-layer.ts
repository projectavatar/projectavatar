import * as THREE from 'three';
import type { VRM } from '@pixiv/three-vrm';

/**
 * TalkingLayer — procedural mouth viseme animation.
 *
 * Drives VRM viseme blend shapes (aa, ih, ou, ee, oh) when the agent
 * is actively generating a response. Creates natural-looking mouth
 * movement with weighted random viseme selection, variable timing,
 * phrase breaks, and subtle head micro-nods.
 *
 * Runs AFTER IdleLayer but BEFORE ExpressionController in the update loop.
 * Writes to VRM expressionManager for mouth shapes (no conflict with
 * emotion expressions which use happy, sad, angry, etc.).
 * Head micro-nods are additive bone transforms on the head bone.
 */

// ─── Viseme definitions ───────────────────────────────────────────────────────

interface VisemeDef {
  name: string;
  weight: number; // selection probability weight
}

const VISEMES: VisemeDef[] = [
  { name: 'aa', weight: 0.30 },
  { name: 'oh', weight: 0.20 },
  { name: 'ee', weight: 0.20 },
  { name: 'ih', weight: 0.15 },
  { name: 'ou', weight: 0.15 },
];

const VISEME_NAMES = VISEMES.map((v) => v.name);
const TOTAL_WEIGHT = VISEMES.reduce((sum, v) => sum + v.weight, 0);

// ─── Timing constants ─────────────────────────────────────────────────────────

const HOLD_MIN_MS = 80;
const HOLD_MAX_MS = 200;
const TRANSITION_MS = 40;
const EASE_IN_MS = 150;
const EASE_OUT_MS = 200;

// Phrase breaks
const BREAK_MIN_VISEMES = 3;
const BREAK_MAX_VISEMES = 7;
const BREAK_MIN_MS = 100;
const BREAK_MAX_MS = 300;

// Amplitude variation
const AMP_MIN = 0.4;
const AMP_MAX = 0.8;

// Head micro-nod
const NOD_AMPLITUDE = 0.02;   // radians ±
const NOD_FREQUENCY = 0.15;   // Hz

// ─── TalkingLayer ─────────────────────────────────────────────────────────────

export class TalkingLayer {
  private vrm: VRM;
  private head: THREE.Object3D | null = null;

  // Talking state
  private active = false;
  private masterBlend = 0;        // 0–1, eases in/out

  // Current viseme state
  private currentViseme = '';      // active viseme name
  private currentWeight = 0;       // current interpolated weight for active viseme
  private targetWeight = 0;        // target weight for current viseme
  private prevViseme = '';         // previous viseme (for crossfade)
  private prevWeight = 0;          // fading-out weight for previous viseme

  // Timing (in seconds)
  private holdTimer = 0;          // time remaining on current viseme hold
  private holdDuration = 0;       // total hold duration for current viseme
  private transitionTimer = 0;    // time remaining on transition to new viseme
  private transitionDuration = TRANSITION_MS / 1000;

  // Phrase break
  private visemesSinceBreak = 0;
  private nextBreakAt = 0;        // viseme count before next break
  private inBreak = false;
  private breakTimer = 0;

  // Amplitude (used internally during viseme selection)

  // Head nod
  private nodElapsed = 0;
  private lastNodAngle = 0;

  // Track whether we've been initialized
  private initialized = false;

  constructor(vrm: VRM) {
    this.vrm = vrm;
    this.head = vrm.humanoid?.getNormalizedBoneNode('head') ?? null;
    this._scheduleNextBreak();
    this._pickNextViseme();
    this.initialized = true;
  }

  /** Start or stop talking animation. */
  setTalking(active: boolean): void {
    this.active = active;
    if (active) {
      // Reset phrase state for fresh start
      this.visemesSinceBreak = 0;
      this._scheduleNextBreak();
      this._pickNextViseme();
    }
  }

  /** Whether talking is currently active (or easing out). */
  get isTalking(): boolean {
    return this.active || this.masterBlend > 0.001;
  }

  /** Current master blend (0–1), for suppressing competing mouth expressions. */
  getMasterBlend(): number {
    return this.masterBlend;
  }

  /** Update every frame. Call AFTER IdleLayer, BEFORE ExpressionController. */
  update(delta: number): void {
    if (!this.initialized) return;

    // Ease master blend in/out
    this._updateMasterBlend(delta);

    // If fully faded out, clear all visemes and return
    if (this.masterBlend < 0.001) {
      this._clearVisemes();
      return;
    }

    // Advance viseme animation
    this._updateVisemes(delta);

    // Apply viseme weights to VRM
    this._applyVisemes();

    // Head micro-nod (only when actively talking)
    if (this.active) {
      this._updateHeadNod(delta);
    }
  }

  /** Clean up — reset all viseme expressions. */
  dispose(): void {
    // Remove any residual nod offset
    if (this.head) this.head.rotation.y -= this.lastNodAngle;
    this.lastNodAngle = 0;
    this.active = false;
    this.masterBlend = 0;
    this._clearVisemes();
  }

  // ─── Private: master blend ────────────────────────────────────────────

  private _updateMasterBlend(delta: number): void {
    const target = this.active ? 1 : 0;
    if (Math.abs(this.masterBlend - target) < 0.001) {
      this.masterBlend = target;
      return;
    }

    const easeMs = this.active ? EASE_IN_MS : EASE_OUT_MS;
    const speed = 1000 / easeMs; // units per second
    if (this.masterBlend < target) {
      this.masterBlend = Math.min(this.masterBlend + speed * delta, 1);
    } else {
      this.masterBlend = Math.max(this.masterBlend - speed * delta, 0);
    }
  }

  // ─── Private: viseme sequencing ───────────────────────────────────────

  private _updateVisemes(delta: number): void {
    // Handle phrase break
    if (this.inBreak) {
      this.breakTimer -= delta;
      // During break, ease current weight toward 0
      this.currentWeight = Math.max(this.currentWeight - delta * (1000 / TRANSITION_MS), 0);
      if (this.breakTimer <= 0) {
        this.inBreak = false;
        this.visemesSinceBreak = 0;
        this._scheduleNextBreak();
        this._pickNextViseme();
      }
      return;
    }

    // Transition phase — lerp from prev to current
    if (this.transitionTimer > 0) {
      this.transitionTimer -= delta;
      const t = 1 - Math.max(this.transitionTimer / this.transitionDuration, 0);
      this.currentWeight = THREE.MathUtils.lerp(0, this.targetWeight, t);
      this.prevWeight = THREE.MathUtils.lerp(this.prevWeight, 0, t);
      return;
    }

    // Hold phase
    this.currentWeight = this.targetWeight;
    this.prevWeight = 0;
    this.holdTimer -= delta;

    if (this.holdTimer <= 0) {
      // Current viseme hold is done
      this.visemesSinceBreak++;

      // Check for phrase break
      if (this.visemesSinceBreak >= this.nextBreakAt) {
        this.inBreak = true;
        this.breakTimer = _randRange(BREAK_MIN_MS, BREAK_MAX_MS) / 1000;
        return;
      }

      // Pick next viseme
      this._pickNextViseme();
    }
  }

  private _pickNextViseme(): void {
    // Store previous for crossfade
    this.prevViseme = this.currentViseme;
    this.prevWeight = this.currentWeight;

    // Weighted random selection (avoid repeating same viseme)
    let selected = this.currentViseme;
    let attempts = 0;
    while (selected === this.currentViseme && attempts < 5) {
      selected = _weightedRandom(VISEMES);
      attempts++;
    }

    this.currentViseme = selected;
    this.currentWeight = 0;
    this.targetWeight = _randRange(AMP_MIN * 100, AMP_MAX * 100) / 100;
    this.holdDuration = _randRange(HOLD_MIN_MS, HOLD_MAX_MS) / 1000;
    this.holdTimer = this.holdDuration;
    this.transitionTimer = this.transitionDuration;


  }

  private _scheduleNextBreak(): void {
    this.nextBreakAt = Math.floor(_randRange(BREAK_MIN_VISEMES, BREAK_MAX_VISEMES + 1));
  }

  // ─── Private: apply to VRM ────────────────────────────────────────────

  private _applyVisemes(): void {
    const em = this.vrm.expressionManager;
    if (!em) return;

    const master = this.masterBlend;

    // Reset all viseme expressions
    for (const name of VISEME_NAMES) {
      let weight = 0;
      if (name === this.currentViseme) {
        weight = this.currentWeight;
      } else if (name === this.prevViseme) {
        weight = this.prevWeight;
      }
      em.setValue(name, weight * master);
    }
  }

  private _clearVisemes(): void {
    const em = this.vrm.expressionManager;
    if (!em) return;
    for (const name of VISEME_NAMES) {
      em.setValue(name, 0);
    }
    this.currentWeight = 0;
    this.prevWeight = 0;
  }

  // ─── Private: head micro-nod ──────────────────────────────────────────

  private _updateHeadNod(delta: number): void {
    if (!this.head) return;

    this.nodElapsed += delta;

    // Subtract previous offset, apply new one (additive without accumulation)
    const nodAngle = Math.sin(this.nodElapsed * NOD_FREQUENCY * Math.PI * 2) * NOD_AMPLITUDE * this.masterBlend;
    this.head.rotation.y += nodAngle - this.lastNodAngle;
    this.lastNodAngle = nodAngle;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function _randRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function _weightedRandom(items: VisemeDef[]): string {
  let r = Math.random() * TOTAL_WEIGHT;
  for (const item of items) {
    r -= item.weight;
    if (r <= 0) return item.name;
  }
  return items[items.length - 1]!.name;
}
