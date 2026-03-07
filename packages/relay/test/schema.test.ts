import { describe, it, expect } from 'vitest';
import { validateAvatarEvent } from '../../shared/src/schema.js';

describe('validateAvatarEvent', () => {
  const valid = { emotions: { interest: 'high' }, action: 'typing' };

  it('accepts a minimal valid event (emotions + action only)', () => {
    expect(validateAvatarEvent(valid)).toEqual({ ok: true });
  });

  it('accepts an empty emotions blend', () => {
    expect(validateAvatarEvent({ emotions: {}, action: 'idle' })).toEqual({ ok: true });
  });

  it('accepts a fully specified event', () => {
    expect(
      validateAvatarEvent({
        emotions: { joy: 'high', surprise: 'low' },
        action: 'celebrating',
        prop: 'scroll',
        intensity: 'high',
        color: 'hotpink',
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

  it('rejects missing emotions with a "required" message', () => {
    const r = validateAvatarEvent({ action: 'typing' });
    expect(r).toMatchObject({ ok: false });
    if (!r.ok) expect(r.error).toMatch(/required/i);
  });

  it('rejects missing action with a "required" message', () => {
    const r = validateAvatarEvent({ emotions: {} });
    expect(r).toMatchObject({ ok: false });
    if (!r.ok) expect(r.error).toMatch(/required/i);
  });

  it('rejects non-object emotions', () => {
    expect(validateAvatarEvent({ emotions: 'happy', action: 'idle' })).toMatchObject({ ok: false });
    expect(validateAvatarEvent({ emotions: null, action: 'idle' })).toMatchObject({ ok: false });
    expect(validateAvatarEvent({ emotions: ['joy'], action: 'idle' })).toMatchObject({ ok: false });
  });

  it('rejects unknown emotion key', () => {
    const r = validateAvatarEvent({ emotions: { happy: 'high' }, action: 'idle' });
    expect(r).toMatchObject({ ok: false });
    if (!r.ok) expect(r.error).toMatch(/invalid emotion key/i);
  });

  it('rejects invalid word intensity value', () => {
    const r = validateAvatarEvent({ emotions: { joy: 'extreme' }, action: 'idle' });
    expect(r).toMatchObject({ ok: false });
    if (!r.ok) expect(r.error).toMatch(/invalid intensity/i);
  });

  it('rejects unknown action', () => {
    expect(validateAvatarEvent({ emotions: {}, action: 'dancing' })).toMatchObject({ ok: false });
  });

  it('rejects unknown prop', () => {
    expect(
      validateAvatarEvent({ emotions: {}, action: 'typing', prop: 'lightsaber' }),
    ).toMatchObject({ ok: false });
  });

  it('rejects unknown intensity', () => {
    expect(
      validateAvatarEvent({ emotions: {}, action: 'typing', intensity: 'extreme' }),
    ).toMatchObject({ ok: false });
  });

  it('rejects extra fields', () => {
    expect(
      validateAvatarEvent({ emotions: {}, action: 'typing', foo: 'bar' }),
    ).toMatchObject({ ok: false });
  });

  it('accepts all valid primary emotions', () => {
    const primaries = ['joy', 'sadness', 'anger', 'fear', 'surprise', 'disgust', 'interest'];
    for (const emotion of primaries) {
      expect(validateAvatarEvent({ emotions: { [emotion]: 'medium' }, action: 'idle' })).toEqual({ ok: true });
    }
  });

  it('accepts all valid word intensities', () => {
    for (const intensity of ['subtle', 'low', 'medium', 'high']) {
      expect(validateAvatarEvent({ emotions: { joy: intensity }, action: 'idle' })).toEqual({ ok: true });
    }
  });

  it('accepts all valid actions', () => {
    const actions = ['idle', 'typing', 'nodding', 'laughing', 'celebrating', 'dismissive', 'searching', 'nervous', 'sad', 'plotting', 'greeting'];
    for (const action of actions) {
      expect(validateAvatarEvent({ emotions: {}, action })).toEqual({ ok: true });
    }
  });

  it('accepts all valid props', () => {
    const props = ['none', 'keyboard', 'magnifying_glass', 'coffee_cup', 'book', 'phone', 'scroll'];
    for (const prop of props) {
      expect(validateAvatarEvent({ emotions: {}, action: 'idle', prop })).toEqual({ ok: true });
    }
  });

  it('prop is optional', () => {
    expect(validateAvatarEvent({ emotions: {}, action: 'idle', prop: undefined })).toEqual({ ok: true });
  });

  it('accepts color field', () => {
    expect(
      validateAvatarEvent({ emotions: { joy: 'high' }, action: 'idle', color: 'coral' }),
    ).toEqual({ ok: true });
  });

  it('rejects non-string color', () => {
    expect(
      validateAvatarEvent({ emotions: {}, action: 'idle', color: 42 }),
    ).toMatchObject({ ok: false });
  });

  // ── sessionId and priority ────────────────────────────────────────────────

  it('accepts event with valid sessionId', () => {
    expect(
      validateAvatarEvent({ emotions: {}, action: 'typing', sessionId: 'agent:main:discord:channel-1' }),
    ).toEqual({ ok: true });
  });

  it('accepts event with valid priority', () => {
    expect(
      validateAvatarEvent({ emotions: {}, action: 'typing', sessionId: 'sess', priority: 0 }),
    ).toEqual({ ok: true });
  });

  it('rejects non-string sessionId', () => {
    expect(
      validateAvatarEvent({ emotions: {}, action: 'typing', sessionId: 42 }),
    ).toMatchObject({ ok: false });
  });

  it('rejects negative priority', () => {
    expect(
      validateAvatarEvent({ emotions: {}, action: 'typing', priority: -1 }),
    ).toMatchObject({ ok: false });
  });

  it('rejects unknown extra fields alongside sessionId', () => {
    expect(
      validateAvatarEvent({ emotions: {}, action: 'typing', sessionId: 'sess', foo: 'bar' }),
    ).toMatchObject({ ok: false });
  });

  it('accepts multi-primary blend', () => {
    expect(
      validateAvatarEvent({
        emotions: { joy: 'high', fear: 'low', interest: 'medium' },
        action: 'idle',
      }),
    ).toEqual({ ok: true });
  });
});
