import { describe, it, expect } from 'vitest';
import { validateAvatarEvent } from '../../shared/src/schema.js';

describe('validateAvatarEvent', () => {
  const valid = { emotion: 'thinking', action: 'typing' };

  it('accepts a minimal valid event (emotion + action only)', () => {
    expect(validateAvatarEvent(valid)).toEqual({ ok: true });
  });

  it('accepts a fully specified event', () => {
    expect(
      validateAvatarEvent({
        emotion: 'excited',
        action: 'celebrating',
        prop: 'scroll',
        intensity: 'high',
      }),
    ).toEqual({ ok: true });
  });

  it('rejects null', () => {
    const r = validateAvatarEvent(null);
    expect(r).toMatchObject({ ok: false });
  });

  it('rejects non-object', () => {
    expect(validateAvatarEvent('string')).toMatchObject({ ok: false });
    expect(validateAvatarEvent(42)).toMatchObject({ ok: false });
  });

  it('rejects missing emotion with a "required" message', () => {
    const r = validateAvatarEvent({ action: 'typing' });
    expect(r).toMatchObject({ ok: false });
    if (!r.ok) expect(r.error).toMatch(/required/i);
  });

  it('rejects missing action with a "required" message', () => {
    const r = validateAvatarEvent({ emotion: 'thinking' });
    expect(r).toMatchObject({ ok: false });
    if (!r.ok) expect(r.error).toMatch(/required/i);
  });

  it('rejects explicit undefined emotion with a "required" message', () => {
    const r = validateAvatarEvent({ emotion: undefined, action: 'typing' });
    expect(r).toMatchObject({ ok: false });
    if (!r.ok) expect(r.error).toMatch(/required/i);
  });

  it('rejects unknown emotion with an "invalid" message', () => {
    const r = validateAvatarEvent({ emotion: 'furious', action: 'typing' });
    expect(r).toMatchObject({ ok: false });
    if (!r.ok) expect(r.error).toMatch(/invalid emotion/i);
  });

  it('rejects unknown action', () => {
    expect(validateAvatarEvent({ emotion: 'thinking', action: 'dancing' })).toMatchObject({ ok: false });
  });

  it('rejects unknown prop', () => {
    expect(
      validateAvatarEvent({ emotion: 'thinking', action: 'typing', prop: 'lightsaber' }),
    ).toMatchObject({ ok: false });
  });

  it('rejects unknown intensity', () => {
    expect(
      validateAvatarEvent({ emotion: 'thinking', action: 'typing', intensity: 'extreme' }),
    ).toMatchObject({ ok: false });
  });

  it('rejects extra fields (additionalProperties: false)', () => {
    expect(
      validateAvatarEvent({ emotion: 'thinking', action: 'typing', foo: 'bar' }),
    ).toMatchObject({ ok: false });
  });

  it('rejects non-string emotion (falsy value edge case)', () => {
    expect(validateAvatarEvent({ emotion: 0, action: 'typing' })).toMatchObject({ ok: false });
    expect(validateAvatarEvent({ emotion: false, action: 'typing' })).toMatchObject({ ok: false });
    expect(validateAvatarEvent({ emotion: '', action: 'typing' })).toMatchObject({ ok: false });
  });

  it('rejects non-string action (falsy value edge case)', () => {
    expect(validateAvatarEvent({ emotion: 'thinking', action: 0 })).toMatchObject({ ok: false });
    expect(validateAvatarEvent({ emotion: 'thinking', action: '' })).toMatchObject({ ok: false });
  });

  it('accepts all valid emotions', () => {
    const emotions = ['idle', 'thinking', 'excited', 'confused', 'happy', 'angry', 'sad', 'surprised', 'bashful', 'nervous'];
    for (const emotion of emotions) {
      expect(validateAvatarEvent({ emotion, action: 'talking' })).toEqual({ ok: true });
    }
  });

  it('accepts all valid actions', () => {
    const actions = ['idle', 'talking', 'typing', 'nodding', 'laughing', 'celebrating', 'dismissive', 'searching', 'nervous', 'sad', 'plotting', 'greeting'];
    for (const action of actions) {
      expect(validateAvatarEvent({ emotion: 'idle', action })).toEqual({ ok: true });
    }
  });

  it('accepts all valid props', () => {
    const props = ['none', 'keyboard', 'magnifying_glass', 'coffee_cup', 'book', 'phone', 'scroll'];
    for (const prop of props) {
      expect(validateAvatarEvent({ emotion: 'idle', action: 'idle', prop })).toEqual({ ok: true });
    }
  });

  it('accepts all valid intensities', () => {
    for (const intensity of ['low', 'medium', 'high']) {
      expect(validateAvatarEvent({ emotion: 'idle', action: 'idle', intensity })).toEqual({ ok: true });
    }
  });

  it('prop is optional — undefined is fine', () => {
    expect(validateAvatarEvent({ emotion: 'idle', action: 'idle', prop: undefined })).toEqual({ ok: true });
  });

  // ── sessionId and priority validation ─────────────────────────────────────

  it('accepts event with valid sessionId', () => {
    expect(
      validateAvatarEvent({ emotion: 'thinking', action: 'typing', sessionId: 'agent:main:discord:channel-1' }),
    ).toEqual({ ok: true });
  });

  it('accepts event with valid priority 0', () => {
    expect(
      validateAvatarEvent({ emotion: 'thinking', action: 'typing', sessionId: 'sess', priority: 0 }),
    ).toEqual({ ok: true });
  });

  it('accepts event with valid priority > 0', () => {
    expect(
      validateAvatarEvent({ emotion: 'thinking', action: 'typing', sessionId: 'sess', priority: 2 }),
    ).toEqual({ ok: true });
  });

  it('accepts event with sessionId but no priority (priority is optional)', () => {
    expect(
      validateAvatarEvent({ emotion: 'thinking', action: 'typing', sessionId: 'sess' }),
    ).toEqual({ ok: true });
  });

  it('accepts event with neither sessionId nor priority (legacy single-session)', () => {
    expect(validateAvatarEvent({ emotion: 'thinking', action: 'typing' })).toEqual({ ok: true });
  });

  it('rejects non-string sessionId', () => {
    expect(
      validateAvatarEvent({ emotion: 'thinking', action: 'typing', sessionId: 42 }),
    ).toMatchObject({ ok: false });
  });

  it('rejects priority: -1 (negative)', () => {
    expect(
      validateAvatarEvent({ emotion: 'thinking', action: 'typing', priority: -1 }),
    ).toMatchObject({ ok: false });
  });

  it('rejects priority: 1.5 (non-integer)', () => {
    expect(
      validateAvatarEvent({ emotion: 'thinking', action: 'typing', priority: 1.5 }),
    ).toMatchObject({ ok: false });
  });

  it('rejects priority: "high" (non-number)', () => {
    expect(
      validateAvatarEvent({ emotion: 'thinking', action: 'typing', priority: 'high' }),
    ).toMatchObject({ ok: false });
  });

  it('still rejects truly unknown extra fields alongside sessionId/priority', () => {
    expect(
      validateAvatarEvent({ emotion: 'thinking', action: 'typing', sessionId: 'sess', foo: 'bar' }),
    ).toMatchObject({ ok: false });
  });
});
