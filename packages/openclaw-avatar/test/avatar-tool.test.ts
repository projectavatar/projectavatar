import { describe, it, expect, vi } from 'vitest';
import { createAvatarTool } from '../src/avatar-signal-tool.js';
import type { AvatarStateMachine } from '../src/state-machine.js';

function makeMockSM() {
  const calls: any[] = [];
  return {
    sm: {
      transition: vi.fn((signal: any) => { calls.push(signal); }),
      getCurrent: vi.fn(),
      reset: vi.fn(),
      scheduleIdle: vi.fn(),
    } as unknown as AvatarStateMachine,
    calls,
  };
}

describe('createAvatarTool', () => {
  it('has correct name and structure', () => {
    const { sm } = makeMockSM();
    const tool = createAvatarTool(sm);
    expect(tool.name).toBe('avatar_signal');
    expect(tool.parameters).toBeDefined();
    expect(tool.parameters.properties.emotions).toBeDefined();
    expect(tool.parameters.properties.action).toBeDefined();
    expect(tool.parameters.properties.color).toBeDefined();
    expect(tool.parameters.required).toEqual([]);
  });

  it('transitions with valid emotions blend and action', async () => {
    const { sm, calls } = makeMockSM();
    const tool = createAvatarTool(sm);
    const result = await tool.execute('call-1', { emotions: { joy: 'high' }, action: 'nodding' });
    expect(result).toEqual({ content: [{ type: 'text', text: 'ok' }] });
    expect(calls).toHaveLength(1);
    expect(calls[0].emotions).toEqual({ joy: 'high' });
    expect(calls[0].action).toBe('nodding');
  });

  it('passes prop, intensity, and color when valid', async () => {
    const { sm, calls } = makeMockSM();
    const tool = createAvatarTool(sm);
    await tool.execute('call-2', {
      emotions: { interest: 'high' },
      action: 'typing',
      prop: 'keyboard',
      intensity: 'high',
      color: 'coral',
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].prop).toBe('keyboard');
    expect(calls[0].intensity).toBe('high');
    expect(calls[0].color).toBe('coral');
  });

  it('ignores invalid prop silently', async () => {
    const { sm, calls } = makeMockSM();
    const tool = createAvatarTool(sm);
    await tool.execute('call-3', { emotions: { joy: 'high' }, action: 'nodding', prop: 'banana' });
    expect(calls).toHaveLength(1);
    expect(calls[0].prop).toBeUndefined();
  });

  it('ignores invalid intensity silently', async () => {
    const { sm, calls } = makeMockSM();
    const tool = createAvatarTool(sm);
    await tool.execute('call-4', { emotions: { joy: 'high' }, action: 'nodding', intensity: 'extreme' });
    expect(calls).toHaveLength(1);
    expect(calls[0].intensity).toBeUndefined();
  });

  it('transitions with emotions-only (no action)', async () => {
    const { sm, calls } = makeMockSM();
    const tool = createAvatarTool(sm);
    const result = await tool.execute('call-5', { emotions: { joy: 'high' } });
    expect(result).toEqual({ content: [{ type: 'text', text: 'ok' }] });
    expect(calls).toHaveLength(1);
    expect(calls[0].emotions).toEqual({ joy: 'high' });
    expect(calls[0].action).toBeUndefined();
  });

  it('transitions with action-only (no emotions)', async () => {
    const { sm, calls } = makeMockSM();
    const tool = createAvatarTool(sm);
    const result = await tool.execute('call-6', { action: 'typing' });
    expect(result).toEqual({ content: [{ type: 'text', text: 'ok' }] });
    expect(calls).toHaveLength(1);
    expect(calls[0].action).toBe('typing');
    expect(calls[0].emotions).toBeUndefined();
  });

  it('filters invalid emotion keys from blend', async () => {
    const { sm, calls } = makeMockSM();
    const tool = createAvatarTool(sm);
    await tool.execute('call-7', { emotions: { happy: 'high', joy: 'medium' } });
    expect(calls).toHaveLength(1);
    expect(calls[0].emotions).toEqual({ joy: 'medium' }); // 'happy' filtered out
  });

  it('filters invalid word intensity values from blend', async () => {
    const { sm, calls } = makeMockSM();
    const tool = createAvatarTool(sm);
    await tool.execute('call-8', { emotions: { joy: 'extreme', sadness: 'low' } });
    expect(calls).toHaveLength(1);
    expect(calls[0].emotions).toEqual({ sadness: 'low' }); // 'joy: extreme' filtered
  });

  it('does not transition when all emotion keys are invalid', async () => {
    const { sm, calls } = makeMockSM();
    const tool = createAvatarTool(sm);
    await tool.execute('call-9', { emotions: { happy: 'high', excited: 'medium' } });
    expect(calls).toHaveLength(0);
  });

  it('does not transition on empty params', async () => {
    const { sm, calls } = makeMockSM();
    const tool = createAvatarTool(sm);
    await tool.execute('call-10', {});
    expect(calls).toHaveLength(0);
  });

  it('always returns ok even on invalid input', async () => {
    const { sm } = makeMockSM();
    const tool = createAvatarTool(sm);
    const result = await tool.execute('call-11', {});
    expect(result).toEqual({ content: [{ type: 'text', text: 'ok' }] });
  });

  it('accepts multi-primary blend', async () => {
    const { sm, calls } = makeMockSM();
    const tool = createAvatarTool(sm);
    await tool.execute('call-12', {
      emotions: { joy: 'high', fear: 'low', interest: 'medium' },
      action: 'idle',
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].emotions).toEqual({ joy: 'high', fear: 'low', interest: 'medium' });
  });
});
