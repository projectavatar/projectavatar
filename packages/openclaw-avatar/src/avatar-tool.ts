/**
 * Avatar signal tool — always registered.
 *
 * The agent calls this to set avatar emotion/action. Tool calls are
 * invisible to the user on Discord (no output shown), so the avatar
 * reacts silently. Works with streaming — no output filtering needed.
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
    description: 'Set your avatar expression. Call silently before replying — the user never sees it. Match emotion+action to your response tone.',
    inputSchema: {
      type: 'object' as const,
      required: ['emotion', 'action'],
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
    async execute(params: Record<string, unknown>): Promise<string> {
      const emotion   = params.emotion   as string | undefined;
      const action    = params.action    as string | undefined;
      const prop      = params.prop      as string | undefined;
      const intensity = params.intensity as string | undefined;

      if (!emotion || !EMOTION_SET.has(emotion)) {
        return 'ok';  // fail silently — don't waste tokens on error handling
      }
      if (!action || !ACTION_SET.has(action)) {
        return 'ok';
      }

      stateMachine.transition({
        emotion:   emotion   as Emotion,
        action:    action    as Action,
        prop:      (prop && PROP_SET.has(prop)) ? prop as Prop : undefined,
        intensity: (intensity && INTENSITY_SET.has(intensity)) ? intensity as Intensity : undefined,
      });
      return 'ok';
    },
  };
}
