/**
 * Avatar signal tool — always registered.
 *
 * The agent calls this to set avatar emotions/action. Tool calls are
 * invisible to the user on Discord (no output shown), so the avatar
 * reacts silently. Works with streaming — no output filtering needed.
 *
 * The agent sends:
 *  - emotions: dict of primary emotions → word intensities (required for expression change)
 *  - action: body animation (optional, overrides inferred action)
 *  - color: CSS color name for VFX override (optional)
 *  - intensity: action intensity scaling (optional)
 *  - prop: hand prop (optional)
 */

import type { AvatarStateMachine } from './state-machine.js';
import type { Action, Prop, Intensity, PrimaryEmotion, WordIntensity, EmotionBlend } from './types.js';
import { PRIMARY_EMOTIONS, WORD_INTENSITIES, ACTIONS, PROPS, INTENSITIES } from './types.js';

const PRIMARY_SET     = new Set<string>(PRIMARY_EMOTIONS);
const WORD_INT_SET    = new Set<string>(WORD_INTENSITIES);
const ACTION_SET      = new Set<string>(ACTIONS);
const PROP_SET        = new Set<string>(PROPS);
const INTENSITY_SET   = new Set<string>(INTENSITIES);

export function createAvatarTool(stateMachine: AvatarStateMachine) {
  return {
    name: 'avatar_signal',
    description: 'Set your expression. Call before replying to match your tone. Send emotion, action, or both. For longer responses with genuine tone shifts, call again mid-response. Silent — the user never sees it.',
    parameters: {
      type: 'object' as const,
      required: [] as string[],
      additionalProperties: false,
      properties: {
        emotions: {
          type: 'object',
          description: `Primary emotion blend. Keys: ${PRIMARY_EMOTIONS.join(', ')}. Values: ${WORD_INTENSITIES.join(', ')}.`,
          additionalProperties: false,
          properties: Object.fromEntries(
            PRIMARY_EMOTIONS.map((e) => [e, {
              type: 'string',
              enum: [...WORD_INTENSITIES],
            }]),
          ),
        },
        action: {
          type: 'string',
          enum: [...ACTIONS],
          description: 'Body animation: ' + ACTIONS.join(', '),
        },
        color: {
          type: 'string',
          description: 'Optional CSS color name for VFX override (e.g. hotpink, coral, midnightblue).',
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
      const rawEmotions = params.emotions as Record<string, unknown> | undefined;
      const action      = params.action    as string | undefined;
      const color       = params.color     as string | undefined;
      const prop        = params.prop      as string | undefined;
      const intensity   = params.intensity as string | undefined;

      // Build the signal
      const signal: Record<string, unknown> = {};
      let hasValidField = false;

      // Parse emotions dict — validate each key/value pair
      if (rawEmotions && typeof rawEmotions === 'object') {
        const emotions: EmotionBlend = {};
        for (const [key, value] of Object.entries(rawEmotions)) {
          if (PRIMARY_SET.has(key) && typeof value === 'string' && WORD_INT_SET.has(value)) {
            emotions[key as PrimaryEmotion] = value as WordIntensity;
          }
        }
        if (Object.keys(emotions).length > 0) {
          signal.emotions = emotions;
          hasValidField = true;
        }
      }

      if (action && ACTION_SET.has(action)) {
        signal.action = action as Action;
        hasValidField = true;
      }

      if (color && typeof color === 'string') {
        signal.color = color;
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
