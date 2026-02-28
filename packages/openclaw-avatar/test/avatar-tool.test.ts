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
    expect(tool.parameters.properties.emotion).toBeDefined();
    expect(tool.parameters.properties.action).toBeDefined();
    expect(tool.parameters.required).toEqual([]);
  });

  it('transitions with valid emotion and action', async () => {
    const { sm, calls } = makeMockSM();
    const tool = createAvatarTool(sm);
    const result = await tool.execute('call-1', { emotion: 'happy', action: 'nodding' });
    expect(result).toEqual({ content: [{ type: 'text', text: 'ok' }] });
    expect(calls).toHaveLength(1);
    expect(calls[0].emotion).toBe('happy');
    expect(calls[0].action).toBe('nodding');
  });

  it('passes prop and intensity when valid', async () => {
    const { sm, calls } = makeMockSM();
    const tool = createAvatarTool(sm);
    await tool.execute('call-2', { emotion: 'thinking', action: 'typing', prop: 'keyboard', intensity: 'high' });
    expect(calls).toHaveLength(1);
    expect(calls[0].prop).toBe('keyboard');
    expect(calls[0].intensity).toBe('high');
  });

  it('ignores invalid prop silently', async () => {
    const { sm, calls } = makeMockSM();
    const tool = createAvatarTool(sm);
    await tool.execute('call-3', { emotion: 'happy', action: 'nodding', prop: 'banana' });
    expect(calls).toHaveLength(1);
    expect(calls[0].prop).toBeUndefined();
  });

  it('ignores invalid intensity silently', async () => {
    const { sm, calls } = makeMockSM();
    const tool = createAvatarTool(sm);
    await tool.execute('call-4', { emotion: 'happy', action: 'nodding', intensity: 'extreme' });
    expect(calls).toHaveLength(1);
    expect(calls[0].intensity).toBeUndefined();
  });

  it('transitions with emotion-only (no action)', async () => {
    const { sm, calls } = makeMockSM();
    const tool = createAvatarTool(sm);
    const result = await tool.execute('call-5', { emotion: 'happy' });
    expect(result).toEqual({ content: [{ type: 'text', text: 'ok' }] });
    expect(calls).toHaveLength(1);
    expect(calls[0].emotion).toBe('happy');
    expect(calls[0].action).toBeUndefined();
  });

  it('transitions with action-only (no emotion)', async () => {
    const { sm, calls } = makeMockSM();
    const tool = createAvatarTool(sm);
    const result = await tool.execute('call-6', { action: 'typing' });
    expect(result).toEqual({ content: [{ type: 'text', text: 'ok' }] });
    expect(calls).toHaveLength(1);
    expect(calls[0].action).toBe('typing');
    expect(calls[0].emotion).toBeUndefined();
  });

  it('does not transition on invalid emotion with no valid action', async () => {
    const { sm, calls } = makeMockSM();
    const tool = createAvatarTool(sm);
    const result = await tool.execute('call-7', { emotion: 'furious' });
    expect(result).toEqual({ content: [{ type: 'text', text: 'ok' }] });
    expect(calls).toHaveLength(0);
  });

  it('does not transition when both are invalid', async () => {
    const { sm, calls } = makeMockSM();
    const tool = createAvatarTool(sm);
    await tool.execute('call-8', { emotion: 'furious', action: 'dancing' });
    expect(calls).toHaveLength(0);
  });

  it('does not transition on empty params', async () => {
    const { sm, calls } = makeMockSM();
    const tool = createAvatarTool(sm);
    await tool.execute('call-9', {});
    expect(calls).toHaveLength(0);
  });

  it('always returns ok even on invalid input', async () => {
    const { sm } = makeMockSM();
    const tool = createAvatarTool(sm);
    const result = await tool.execute('call-10', {});
    expect(result).toEqual({ content: [{ type: 'text', text: 'ok' }] });
  });
});
