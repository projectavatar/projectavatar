import { describe, it, expect } from 'vitest';
import { validateAvatarEvent } from '../../packages/shared/src/schema.js';

describe('validateAvatarEvent', () => {
  const valid = { emotion: 'focused', action: 'coding' };

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

  it('rejects missing emotion', () => {
    expect(validateAvatarEvent({ action: 'coding' })).toMatchObject({ ok: false });
  });

  it('rejects missing action', () => {
    expect(validateAvatarEvent({ emotion: 'focused' })).toMatchObject({ ok: false });
  });

  it('rejects unknown emotion', () => {
    expect(validateAvatarEvent({ emotion: 'angry', action: 'coding' })).toMatchObject({ ok: false });
  });

  it('rejects unknown action', () => {
    expect(validateAvatarEvent({ emotion: 'focused', action: 'dancing' })).toMatchObject({ ok: false });
  });

  it('rejects unknown prop', () => {
    expect(
      validateAvatarEvent({ emotion: 'focused', action: 'coding', prop: 'lightsaber' }),
    ).toMatchObject({ ok: false });
  });

  it('rejects unknown intensity', () => {
    expect(
      validateAvatarEvent({ emotion: 'focused', action: 'coding', intensity: 'extreme' }),
    ).toMatchObject({ ok: false });
  });

  it('rejects extra fields (additionalProperties: false)', () => {
    expect(
      validateAvatarEvent({ emotion: 'focused', action: 'coding', foo: 'bar' }),
    ).toMatchObject({ ok: false });
  });

  it('accepts all valid emotions', () => {
    const emotions = ['idle', 'thinking', 'focused', 'excited', 'confused', 'satisfied', 'concerned'];
    for (const emotion of emotions) {
      expect(validateAvatarEvent({ emotion, action: 'responding' })).toEqual({ ok: true });
    }
  });

  it('accepts all valid actions', () => {
    const actions = ['responding', 'searching', 'coding', 'reading', 'waiting', 'error', 'celebrating'];
    for (const action of actions) {
      expect(validateAvatarEvent({ emotion: 'idle', action })).toEqual({ ok: true });
    }
  });

  it('accepts all valid props', () => {
    const props = ['none', 'keyboard', 'magnifying_glass', 'coffee_cup', 'book', 'phone', 'scroll'];
    for (const prop of props) {
      expect(validateAvatarEvent({ emotion: 'idle', action: 'waiting', prop })).toEqual({ ok: true });
    }
  });

  it('accepts all valid intensities', () => {
    for (const intensity of ['low', 'medium', 'high']) {
      expect(validateAvatarEvent({ emotion: 'idle', action: 'waiting', intensity })).toEqual({ ok: true });
    }
  });

  it('prop is optional — undefined is fine', () => {
    expect(validateAvatarEvent({ emotion: 'idle', action: 'waiting', prop: undefined })).toEqual({ ok: true });
  });
});
