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
import type { Emotion, Action, Prop, Intensity } from './types.js';
import { EMOTIONS, ACTIONS, PROPS, INTENSITIES } from './types.js';

// Derived sets for runtime validation — same source of truth as types.ts
const EMOTION_SET   = new Set<string>(EMOTIONS);
const ACTION_SET    = new Set<string>(ACTIONS);
const PROP_SET      = new Set<string>(PROPS);
const INTENSITY_SET = new Set<string>(INTENSITIES);

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
          enum: [...EMOTIONS],
          description: 'Your current emotional state.',
        },
        action: {
          type: 'string',
          enum: [...ACTIONS],
          description: 'What you are currently doing.',
        },
        prop: {
          type: 'string',
          enum: [...PROPS],
          description: "Optional prop to hold in your avatar's hand.",
        },
        intensity: {
          type: 'string',
          enum: [...INTENSITIES],
          description: 'Optional intensity of the expression. Defaults to medium.',
        },
      },
    },
    async execute(params: Record<string, unknown>): Promise<{ ok: true } | { ok: false; error: string }> {
      const emotion   = params.emotion   as string | undefined;
      const action    = params.action    as string | undefined;
      const prop      = params.prop      as string | undefined;
      const intensity = params.intensity as string | undefined;

      // Validate — LLMs can emit invalid enum values despite the schema
      if (!emotion || !EMOTION_SET.has(emotion)) {
        return { ok: false, error: `Invalid emotion: ${String(emotion)}` };
      }
      if (!action || !ACTION_SET.has(action)) {
        return { ok: false, error: `Invalid action: ${String(action)}` };
      }
      if (prop !== undefined && !PROP_SET.has(prop)) {
        return { ok: false, error: `Invalid prop: ${String(prop)}` };
      }
      if (intensity !== undefined && !INTENSITY_SET.has(intensity)) {
        return { ok: false, error: `Invalid intensity: ${String(intensity)}` };
      }

      stateMachine.transition({
        emotion:   emotion   as Emotion,
        action:    action    as Action,
        prop:      prop      as Prop      | undefined,
        intensity: intensity as Intensity | undefined,
      });
      return { ok: true };
    },
  };
}
