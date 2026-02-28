import { describe, it, expect, vi } from 'vitest';
import { createAvatarTool } from '../src/avatar-tool.js';
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
    expect(tool.parameters.required).toContain('emotion');
    expect(tool.parameters.required).toContain('action');
  });

  it('transitions with valid emotion and action', async () => {
    const { sm, calls } = makeMockSM();
    const tool = createAvatarTool(sm);
    const result = await tool.execute('call-1', { emotion: 'happy', action: 'waving' });
    expect(result).toEqual({ content: [{ type: 'text', text: 'ok' }] });
    expect(calls).toHaveLength(1);
    expect(calls[0].emotion).toBe('happy');
    expect(calls[0].action).toBe('waving');
  });

  it('passes prop and intensity when valid', async () => {
    const { sm, calls } = makeMockSM();
    const tool = createAvatarTool(sm);
    await tool.execute('call-2', { emotion: 'focused', action: 'typing', prop: 'keyboard', intensity: 'high' });
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

  it('does not transition on invalid emotion', async () => {
    const { sm, calls } = makeMockSM();
    const tool = createAvatarTool(sm);
    const result = await tool.execute('call-5', { emotion: 'furious', action: 'nodding' });
    expect(result).toEqual({ content: [{ type: 'text', text: 'ok' }] });
    expect(calls).toHaveLength(0);
  });

  it('does not transition on invalid action', async () => {
    const { sm, calls } = makeMockSM();
    const tool = createAvatarTool(sm);
    const result = await tool.execute('call-6', { emotion: 'happy', action: 'dancing' });
    expect(result).toEqual({ content: [{ type: 'text', text: 'ok' }] });
    expect(calls).toHaveLength(0);
  });

  it('does not transition when emotion is missing', async () => {
    const { sm, calls } = makeMockSM();
    const tool = createAvatarTool(sm);
    await tool.execute('call-7', { action: 'nodding' });
    expect(calls).toHaveLength(0);
  });

  it('does not transition when action is missing', async () => {
    const { sm, calls } = makeMockSM();
    const tool = createAvatarTool(sm);
    await tool.execute('call-8', { emotion: 'happy' });
    expect(calls).toHaveLength(0);
  });

  it('always returns ok even on invalid input', async () => {
    const { sm } = makeMockSM();
    const tool = createAvatarTool(sm);
    const result = await tool.execute('call-9', {});
    expect(result).toEqual({ content: [{ type: 'text', text: 'ok' }] });
  });
});
