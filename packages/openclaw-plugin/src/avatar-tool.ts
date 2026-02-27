/**
 * Optional "avatar" agent tool.
 *
 * When `enableAvatarTool: true`, this registers a tool the LLM can call
 * explicitly to set avatar state. Useful for expressions that aren't tied
 * to specific tool calls — e.g. "I'm thinking hard about this" during a
 * long reasoning block.
 *
 * The tool is marked optional so it doesn't appear in the default tool list
 * and doesn't consume token budget unless enabled.
 */

import type { AvatarStateMachine } from './state-machine.js';

export function createAvatarTool(stateMachine: AvatarStateMachine) {
  return {
    name: 'avatar',
    description: [
      'Set your avatar state explicitly. Use this when your emotional state',
      'or current task is not captured by an automatic tool-call hook.',
      'Available emotions: idle, thinking, focused, excited, confused, satisfied, concerned.',
      'Available actions: responding, searching, coding, reading, waiting, error, celebrating.',
      'Optional: prop (keyboard, magnifying_glass, coffee_cup, book, phone, scroll, none),',
      'intensity (low, medium, high).',
    ].join(' '),
    inputSchema: {
      type: 'object' as const,
      required: ['emotion', 'action'],
      additionalProperties: false,
      properties: {
        emotion: {
          type: 'string',
          enum: ['idle', 'thinking', 'focused', 'excited', 'confused', 'satisfied', 'concerned'],
          description: 'Your current emotional state.',
        },
        action: {
          type: 'string',
          enum: ['responding', 'searching', 'coding', 'reading', 'waiting', 'error', 'celebrating'],
          description: 'What you are currently doing.',
        },
        prop: {
          type: 'string',
          enum: ['keyboard', 'magnifying_glass', 'coffee_cup', 'book', 'phone', 'scroll', 'none'],
          description: 'Optional prop to hold in your avatar\'s hand.',
        },
        intensity: {
          type: 'string',
          enum: ['low', 'medium', 'high'],
          description: 'Optional intensity of the expression. Defaults to medium.',
        },
      },
    },
    async execute(params: Record<string, unknown>) {
      stateMachine.transition({
        emotion:   params.emotion   as string | undefined as any,
        action:    params.action    as string | undefined as any,
        prop:      params.prop      as string | undefined as any,
        intensity: params.intensity as string | undefined as any,
      });
      return { ok: true };
    },
  };
}
