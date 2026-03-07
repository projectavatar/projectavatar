// ─── Model ID ─────────────────────────────────────────────────────────────────

/** Valid model ID: alphanumeric, hyphens, underscores, 1–128 chars */
export const MODEL_ID_REGEX = /^[a-zA-Z0-9_-]{1,128}$/;

export function isValidModelId(id: unknown): id is string {
  return typeof id === 'string' && MODEL_ID_REGEX.test(id);
}

// ─── Primary emotions ──────────────────────────────────────────────────────────

export const PRIMARY_EMOTIONS = [
  'joy',
  'sadness',
  'anger',
  'fear',
  'surprise',
  'disgust',
  'interest',
] as const;

export type PrimaryEmotion = (typeof PRIMARY_EMOTIONS)[number];

// ─── Word intensities ──────────────────────────────────────────────────────────

export const WORD_INTENSITIES = ['subtle', 'low', 'medium', 'high'] as const;
export type WordIntensity = (typeof WORD_INTENSITIES)[number];

export const WORD_INTENSITY_VALUES: Record<WordIntensity, number> = {
  subtle: 0.15,
  low:    0.3,
  medium: 0.6,
  high:   1.0,
};

/** Emotion blend — partial map of primary emotions to word intensities. */
export type EmotionBlend = Partial<Record<PrimaryEmotion, WordIntensity>>;

// ─── Actions ───────────────────────────────────────────────────────────────────

export const ACTIONS = [
  'idle',
  'typing',
  'nodding',
  'laughing',
  'celebrating',
  'dismissive',
  'searching',
  'nervous',
  'sad',
  'plotting',
  'greeting',
] as const;

export type Action = (typeof ACTIONS)[number];

// ─── Props ─────────────────────────────────────────────────────────────────────

export const PROPS = [
  'none',
  'keyboard',
  'magnifying_glass',
  'coffee_cup',
  'book',
  'phone',
  'scroll',
] as const;

export type Prop = (typeof PROPS)[number];

// ─── Intensities (action intensity, kept for body animation scaling) ───────────

export const INTENSITIES = ['low', 'medium', 'high'] as const;
export type Intensity = (typeof INTENSITIES)[number];

// ─── Avatar event ──────────────────────────────────────────────────────────────

export interface AvatarEvent {
  /** Primary emotion blend — weighted mix of primaries. */
  emotions: EmotionBlend;
  /** Body action — explicit or inferred from dominant emotion. */
  action: Action;
  /** Hand prop. */
  prop?: Prop;
  /** Action intensity (body animation scaling). */
  intensity?: Intensity;
  /** Optional CSS color name — overrides engine-computed VFX color. */
  color?: string;
  /** Whether the avatar mouth animation is active. Orthogonal to body action. */
  talking?: boolean;
  /**
   * Opaque string identifying the agent session that pushed this event.
   * Used by the relay for multi-session arbitration.
   */
  sessionId?: string;
  /**
   * Session priority for arbitration. Lower number = higher priority.
   * 0 = main/interactive session, 1 = sub-agent, 2+ = background tasks.
   */
  priority?: number;
}

export type ValidationResult = { ok: true } | { ok: false; error: string };

export function validateAvatarEvent(event: unknown): ValidationResult {
  if (typeof event !== 'object' || event === null) {
    return { ok: false, error: 'Event must be an object' };
  }

  const e = event as Record<string, unknown>;

  // ── emotions (required) ──────────────────────────────────────────────────
  if (e.emotions === undefined) {
    return { ok: false, error: "'emotions' is required. Must be an object with primary emotion keys." };
  }

  if (typeof e.emotions !== 'object' || e.emotions === null || Array.isArray(e.emotions)) {
    return { ok: false, error: "'emotions' must be an object mapping primary emotions to word intensities." };
  }

  const emotions = e.emotions as Record<string, unknown>;
  for (const [key, value] of Object.entries(emotions)) {
    if (!PRIMARY_EMOTIONS.includes(key as PrimaryEmotion)) {
      return { ok: false, error: `Invalid emotion key: ${key}. Must be one of: ${PRIMARY_EMOTIONS.join(', ')}` };
    }
    if (typeof value !== 'string' || !WORD_INTENSITIES.includes(value as WordIntensity)) {
      return { ok: false, error: `Invalid intensity for '${key}': ${String(value)}. Must be one of: ${WORD_INTENSITIES.join(', ')}` };
    }
  }

  // ── action (required) ────────────────────────────────────────────────────
  if (typeof e.action !== 'string' || !ACTIONS.includes(e.action as Action)) {
    return {
      ok: false,
      error: e.action === undefined
        ? `'action' is required. Must be one of: ${ACTIONS.join(', ')}`
        : `Invalid action: ${String(e.action)}. Must be one of: ${ACTIONS.join(', ')}`,
    };
  }

  // ── prop (optional) ──────────────────────────────────────────────────────
  if (e.prop !== undefined && (typeof e.prop !== 'string' || !PROPS.includes(e.prop as Prop))) {
    return { ok: false, error: `Invalid prop: ${String(e.prop)}. Must be one of: ${PROPS.join(', ')}` };
  }

  // ── intensity (optional) ─────────────────────────────────────────────────
  if (e.intensity !== undefined && (typeof e.intensity !== 'string' || !INTENSITIES.includes(e.intensity as Intensity))) {
    return { ok: false, error: `Invalid intensity: ${String(e.intensity)}. Must be one of: ${INTENSITIES.join(', ')}` };
  }

  // ── color (optional) ─────────────────────────────────────────────────────
  if (e.color !== undefined && typeof e.color !== 'string') {
    return { ok: false, error: 'color must be a string (CSS color name)' };
  }

  // ── session fields (optional) ────────────────────────────────────────────
  if (e.sessionId !== undefined && typeof e.sessionId !== 'string') {
    return { ok: false, error: 'sessionId must be a string when provided' };
  }

  if (e.priority !== undefined && (typeof e.priority !== 'number' || !Number.isInteger(e.priority) || e.priority < 0)) {
    return { ok: false, error: 'priority must be a non-negative integer when provided' };
  }

  // ── talking (optional) ─────────────────────────────────────────────────
  if (e.talking !== undefined && typeof e.talking !== 'boolean') {
    return { ok: false, error: 'talking must be a boolean when provided' };
  }

  // ── reject unknown fields ────────────────────────────────────────────────
  const allowedKeys = new Set(['emotions', 'action', 'prop', 'intensity', 'color', 'talking', 'sessionId', 'priority']);
  for (const key of Object.keys(e)) {
    if (!allowedKeys.has(key)) {
      return { ok: false, error: `Unknown field: ${key}` };
    }
  }

  return { ok: true };
}

// ─── Channel state ─────────────────────────────────────────────────────────────

export interface ChannelState {
  model: string | null;
  lastAgentEventAt: number | null;
  connectedClients: number;
}

// ─── WebSocket message types (server → client) ─────────────────────────────────

export interface ChannelStateMessage {
  type: 'channel_state';
  version: string;
  data: ChannelState & { lastEvent: AvatarEvent | null };
  timestamp: number;
}

export interface ModelChangedMessage {
  type: 'model_changed';
  version: string;
  data: { model: string | null };
  timestamp: number;
}

export interface AvatarEventMessage {
  type: 'avatar_event';
  version: string;
  data: AvatarEvent;
  timestamp: number;
  replay: boolean;
}

export type WebSocketServerMessage =
  | ChannelStateMessage
  | ModelChangedMessage
  | AvatarEventMessage
  | PingMessage;

// ─── WebSocket message types (client → server) ─────────────────────────────────

export interface SetModelMessage {
  type: 'set_model';
  model: string | null;
}

export type WebSocketClientMessage = SetModelMessage | PongMessage;

// ─── HTTP response types ────────────────────────────────────────────────────────

export type ChannelStateResponse = ChannelState;

// ─── Keepalive ──────────────────────────────────────────────────────────────────

export interface PingMessage { type: 'ping'; }
export interface PongMessage { type: 'pong'; }
