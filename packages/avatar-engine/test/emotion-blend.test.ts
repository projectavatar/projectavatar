import { describe, it, expect, beforeEach } from 'vitest';
import {
  resolveBlend,
  resolveBlendFromWeights,
  createNeutralBlend,
  EmotionDecay,
  EMOTION_COLORS,
  ENERGY_COEFFICIENTS,
} from '../src/emotion-blend.ts';
import type { EmotionBlend, PrimaryEmotion } from '@project-avatar/shared';
import { PRIMARY_EMOTIONS, WORD_INTENSITY_VALUES } from '@project-avatar/shared';

// ─── resolveBlend ─────────────────────────────────────────────────────────────

describe('resolveBlend', () => {
  it('returns neutral baseline for empty blend', () => {
    const blend = resolveBlend({});
    expect(blend.dominant).toBeNull();
    expect(blend.weights.get('joy')).toBeCloseTo(0.1, 2);
    expect(blend.weights.get('interest')).toBeCloseTo(0.1, 2);
    expect(blend.maxWeight).toBeCloseTo(0.1, 2);
  });

  it('resolves a single emotion', () => {
    const blend = resolveBlend({ joy: 'high' });
    expect(blend.dominant).toBe('joy');
    expect(blend.weights.get('joy')).toBe(1.0);
    expect(blend.maxWeight).toBe(1.0);
  });

  it('resolves multiple emotions', () => {
    const blend = resolveBlend({ joy: 'high', fear: 'low' });
    expect(blend.dominant).toBe('joy');
    expect(blend.weights.get('joy')).toBe(1.0);
    expect(blend.weights.get('fear')).toBe(0.3);
  });

  it('ties are won by PRIMARY_EMOTIONS order (positive bias)', () => {
    const blend = resolveBlend({ joy: 'high', anger: 'high' });
    expect(blend.dominant).toBe('joy');
  });

  it('computes energy correctly', () => {
    const blend = resolveBlend({ joy: 'high' });
    expect(blend.energy).toBeCloseTo(1.0 * ENERGY_COEFFICIENTS.joy, 4);
  });

  it('computes negative energy for sadness', () => {
    const blend = resolveBlend({ sadness: 'high' });
    expect(blend.energy).toBeLessThan(0);
  });

  it('computes blended color from emotion weights', () => {
    const blend = resolveBlend({ joy: 'high' });
    expect(blend.color.r).toBeCloseTo(EMOTION_COLORS.joy.r, 1);
    expect(blend.colorOverridden).toBe(false);
  });

  it('applies color override', () => {
    const blend = resolveBlend({ joy: 'high' }, 'red');
    expect(blend.color.r).toBe(1);
    expect(blend.color.g).toBe(0);
    expect(blend.color.b).toBe(0);
    expect(blend.colorOverridden).toBe(true);
  });

  it('applies color override even to empty blend', () => {
    const blend = resolveBlend({}, 'hotpink');
    expect(blend.colorOverridden).toBe(true);
  });

  it('converts all word intensities correctly', () => {
    for (const [word, expected] of Object.entries(WORD_INTENSITY_VALUES)) {
      const blend = resolveBlend({ joy: word as any });
      expect(blend.weights.get('joy')).toBe(expected);
    }
  });

  it('handles all 7 primaries simultaneously', () => {
    const emotions: EmotionBlend = {};
    for (const e of PRIMARY_EMOTIONS) {
      emotions[e] = 'medium';
    }
    const blend = resolveBlend(emotions);
    expect(blend.weights.size).toBe(7);
    expect(blend.dominant).toBe('joy'); // first in array at equal weight
  });
});

// ─── resolveBlendFromWeights ──────────────────────────────────────────────────

describe('resolveBlendFromWeights', () => {
  it('resolves from numeric weights', () => {
    const weights = new Map<PrimaryEmotion, number>([['anger', 0.8]]);
    const blend = resolveBlendFromWeights(weights);
    expect(blend.dominant).toBe('anger');
    expect(blend.maxWeight).toBe(0.8);
  });

  it('returns null dominant when all weights are at neutral floor', () => {
    const weights = new Map<PrimaryEmotion, number>([
      ['joy', 0.1],
      ['interest', 0.1],
    ]);
    const blend = resolveBlendFromWeights(weights);
    expect(blend.dominant).toBeNull();
  });

  it('applies color override', () => {
    const weights = new Map<PrimaryEmotion, number>([['joy', 0.5]]);
    const blend = resolveBlendFromWeights(weights, 'coral');
    expect(blend.colorOverridden).toBe(true);
  });
});

// ─── createNeutralBlend ───────────────────────────────────────────────────────

describe('createNeutralBlend', () => {
  it('returns a new object each time', () => {
    const a = createNeutralBlend();
    const b = createNeutralBlend();
    expect(a).not.toBe(b);
    expect(a.weights).not.toBe(b.weights);
    expect(a.color).not.toBe(b.color);
  });

  it('has neutral weights', () => {
    const blend = createNeutralBlend();
    expect(blend.weights.get('joy')).toBeCloseTo(0.1, 2);
    expect(blend.weights.get('interest')).toBeCloseTo(0.1, 2);
    expect(blend.dominant).toBeNull();
  });

  it('has warm white color', () => {
    const blend = createNeutralBlend();
    expect(blend.color.r).toBeCloseTo(0.9, 1);
    expect(blend.color.g).toBeCloseTo(0.9, 1);
    expect(blend.color.b).toBeCloseTo(0.85, 1);
  });

  it('weights map is mutable (not frozen)', () => {
    const blend = createNeutralBlend();
    expect(() => blend.weights.set('anger', 0.5)).not.toThrow();
    expect(blend.weights.get('anger')).toBe(0.5);
  });
});

// ─── EmotionDecay ─────────────────────────────────────────────────────────────

describe('EmotionDecay', () => {
  let decay: EmotionDecay;

  beforeEach(() => {
    decay = new EmotionDecay();
  });

  it('starts at neutral', () => {
    expect(decay.blend.dominant).toBeNull();
    expect(decay.blend.weights.get('joy')).toBeCloseTo(0.1, 2);
    expect(decay.isDecaying).toBe(false);
  });

  it('interpolates toward target on update', () => {
    const target = resolveBlend({ joy: 'high' });
    decay.setTarget(target);

    for (let i = 0; i < 60; i++) decay.update(1 / 60);

    expect(decay.blend.weights.get('joy')!).toBeGreaterThan(0.9);
  });

  it('decays toward neutral after startDecay()', () => {
    const target = resolveBlend({ joy: 'high' });
    decay.setTarget(target);
    for (let i = 0; i < 120; i++) decay.update(1 / 60);
    expect(decay.blend.weights.get('joy')!).toBeGreaterThan(0.9);

    decay.startDecay();
    expect(decay.isDecaying).toBe(true);

    for (let i = 0; i < 1200; i++) decay.update(1 / 60);

    const joyWeight = decay.blend.weights.get('joy') ?? 0;
    expect(joyWeight).toBeLessThan(0.15);
    expect(joyWeight).toBeGreaterThan(0.05);
  });

  it('setTarget cancels decay', () => {
    decay.startDecay();
    expect(decay.isDecaying).toBe(true);

    decay.setTarget(resolveBlend({ anger: 'high' }));
    expect(decay.isDecaying).toBe(false);
  });

  it('update returns true when blend changes', () => {
    decay.setTarget(resolveBlend({ joy: 'high' }));
    const changed = decay.update(1 / 60);
    expect(changed).toBe(true);
  });

  it('update returns false when stable', () => {
    for (let i = 0; i < 300; i++) decay.update(1 / 60);
    const changed = decay.update(1 / 60);
    expect(changed).toBe(false);
  });

  it('handles rapid target changes without crashing', () => {
    decay.setTarget(resolveBlend({ joy: 'high' }));
    decay.update(1 / 60);
    decay.setTarget(resolveBlend({ anger: 'high' }));
    decay.update(1 / 60);
    decay.setTarget(resolveBlend({ sadness: 'high' }));

    for (let i = 0; i < 120; i++) decay.update(1 / 60);
    expect(decay.blend.weights.get('sadness')!).toBeGreaterThan(0.8);
  });

  it('decays non-neutral emotions to near zero', () => {
    decay.setTarget(resolveBlend({ anger: 'high' }));
    for (let i = 0; i < 120; i++) decay.update(1 / 60);

    decay.startDecay();
    for (let i = 0; i < 1200; i++) decay.update(1 / 60);

    const angerWeight = decay.blend.weights.get('anger') ?? 0;
    expect(angerWeight).toBeLessThan(0.05);
  });

  it('neutral emotions remain after decay', () => {
    decay.setTarget(resolveBlend({ anger: 'high' }));
    for (let i = 0; i < 120; i++) decay.update(1 / 60);

    decay.startDecay();
    for (let i = 0; i < 1200; i++) decay.update(1 / 60);

    // Joy and interest should persist at neutral level
    const joyWeight = decay.blend.weights.get('joy') ?? 0;
    const interestWeight = decay.blend.weights.get('interest') ?? 0;
    expect(joyWeight).toBeGreaterThan(0.05);
    expect(interestWeight).toBeGreaterThan(0.05);
  });
});
