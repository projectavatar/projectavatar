/**
 * Avatar signal tool — always registered.
 *
 * The agent calls this to set avatar emotion/action. Tool calls are
 * invisible to the user on Discord (no output shown), so the avatar
 * reacts silently. Works with streaming — no output filtering needed.
 *
 * The agent can send:
 *  - Both emotion + action (full state change)
 *  - Emotion only (face change, body keeps current action)
 *  - Action only (body change, face keeps current emotion)
 *
 * This flexibility lets the agent update one axis without fighting the other.
 */

import type { AvatarStateMachine } from './state-machine.js';
import type { Emotion, Action, Prop, Intensity } from './types.js';
import { EMOTIONS, ACTIONS, PROPS, INTENSITIES } from './types.js';

const EMOTION_SET   = new Set<string>(EMOTIONS);
const ACTION_SET    = new Set<string>(ACTIONS);
const PROP_SET      = new Set<string>(PROPS);
const INTENSITY_SET = new Set<string>(INTENSITIES);

export function createAvatarTool(stateMachine: AvatarStateMachine) {
  return {
    name: 'avatar_signal',
    description: 'Set your expression. Call before replying to match your tone. For longer responses with genuine tone shifts, call again mid-response. Silent — the user never sees it.',
    parameters: {
      type: 'object' as const,
      required: ['emotion', 'action'] as string[],
      additionalProperties: false,
      properties: {
        emotion: {
          type: 'string',
          enum: [...EMOTIONS],
          description: 'Facial expression: ' + EMOTIONS.join(', '),
        },
        action: {
          type: 'string',
          enum: [...ACTIONS],
          description: 'Body animation: ' + ACTIONS.join(', '),
        },
        prop: {
          type: 'string',
          enum: [...PROPS],
          description: 'Optional hand prop.',
        },
        intensity: {
          type: 'string',
          enum: [...INTENSITIES],
          description: 'Expression intensity.',
        },
      },
    },
    async execute(_toolCallId: string, params: Record<string, unknown>): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
      const emotion   = params.emotion   as string | undefined;
      const action    = params.action    as string | undefined;
      const prop      = params.prop      as string | undefined;
      const intensity = params.intensity as string | undefined;

      // Build a partial signal — only include valid fields
      const signal: Record<string, unknown> = {};
      let hasValidField = false;

      if (emotion && EMOTION_SET.has(emotion)) {
        signal.emotion = emotion as Emotion;
        hasValidField = true;
      }
      if (action && ACTION_SET.has(action)) {
        signal.action = action as Action;
        hasValidField = true;
      }
      if (prop && PROP_SET.has(prop)) {
        signal.prop = prop as Prop;
      }
      if (intensity && INTENSITY_SET.has(intensity)) {
        signal.intensity = intensity as Intensity;
      }

      if (hasValidField) {
        stateMachine.transition(signal);
      }

      return { content: [{ type: 'text', text: 'ok' }] };
    },
  };
}
