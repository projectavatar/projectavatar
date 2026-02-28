// ─── Model ID ─────────────────────────────────────────────────────────────────

/** Valid model ID: alphanumeric, hyphens, underscores, 1–128 chars */
export const MODEL_ID_REGEX = /^[a-zA-Z0-9_-]{1,128}$/;

export function isValidModelId(id: unknown): id is string {
  return typeof id === 'string' && MODEL_ID_REGEX.test(id);
}

// ─── Avatar event types ────────────────────────────────────────────────────────

export const EMOTIONS = [
  'idle',
  'thinking',
  'excited',
  'confused',
  'happy',
  'angry',
  'sad',
  'surprised',
  'bashful',
  'nervous',
] as const;

export const ACTIONS = [
  'idle',
  'talking',
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

export const PROPS = [
  'none',
  'keyboard',
  'magnifying_glass',
  'coffee_cup',
  'book',
  'phone',
  'scroll',
] as const;

export const INTENSITIES = ['low', 'medium', 'high'] as const;

export type Emotion = (typeof EMOTIONS)[number];
export type Action = (typeof ACTIONS)[number];
export type Prop = (typeof PROPS)[number];
export type Intensity = (typeof INTENSITIES)[number];

export interface AvatarEvent {
  emotion: Emotion;
  action: Action;
  prop?: Prop;
  intensity?: Intensity;
  /**
   * Opaque string identifying the agent session that pushed this event.
   * Used by the relay for multi-session arbitration — lower-priority sessions
   * are suppressed while a higher-priority session is active.
   * Optional: events without sessionId are treated as legacy single-session pushes (priority 0).
   */
  sessionId?: string;
  /**
   * Session priority for arbitration. Lower number = higher priority.
   * 0 = main/interactive session, 1 = sub-agent, 2+ = background tasks.
   * Optional: defaults to 0 (treated as highest priority) when absent.
   */
  priority?: number;
}

export type ValidationResult = { ok: true } | { ok: false; error: string };

export function validateAvatarEvent(event: unknown): ValidationResult {
  if (typeof event !== 'object' || event === null) {
    return { ok: false, error: 'Event must be an object' };
  }

  const e = event as Record<string, unknown>;

  // Use explicit type checks rather than truthiness — avoids false negatives
  // for falsy-but-valid values and gives clearer "required" vs "invalid" errors
  if (typeof e.emotion !== 'string' || !EMOTIONS.includes(e.emotion as Emotion)) {
    return {
      ok: false,
      error: e.emotion === undefined
        ? `'emotion' is required. Must be one of: ${EMOTIONS.join(', ')}`
        : `Invalid emotion: ${String(e.emotion)}. Must be one of: ${EMOTIONS.join(', ')}`,
    };
  }

  if (typeof e.action !== 'string' || !ACTIONS.includes(e.action as Action)) {
    return {
      ok: false,
      error: e.action === undefined
        ? `'action' is required. Must be one of: ${ACTIONS.join(', ')}`
        : `Invalid action: ${String(e.action)}. Must be one of: ${ACTIONS.join(', ')}`,
    };
  }

  if (e.prop !== undefined && (typeof e.prop !== 'string' || !PROPS.includes(e.prop as Prop))) {
    return {
      ok: false,
      error: `Invalid prop: ${String(e.prop)}. Must be one of: ${PROPS.join(', ')}`,
    };
  }

  if (e.intensity !== undefined && (typeof e.intensity !== 'string' || !INTENSITIES.includes(e.intensity as Intensity))) {
    return {
      ok: false,
      error: `Invalid intensity: ${String(e.intensity)}. Must be one of: ${INTENSITIES.join(', ')}`,
    };
  }

  if (e.sessionId !== undefined && typeof e.sessionId !== 'string') {
    return { ok: false, error: 'sessionId must be a string when provided' };
  }

  if (e.priority !== undefined && (typeof e.priority !== 'number' || !Number.isInteger(e.priority) || e.priority < 0)) {
    return { ok: false, error: 'priority must be a non-negative integer when provided' };
  }

  // Reject additional properties — sessionId and priority are now explicitly allowed
  const allowedKeys = new Set(['emotion', 'action', 'prop', 'intensity', 'sessionId', 'priority']);
  for (const key of Object.keys(e)) {
    if (!allowedKeys.has(key)) {
      return { ok: false, error: `Unknown field: ${key}` };
    }
  }

  return { ok: true };
}

// ─── Channel state ─────────────────────────────────────────────────────────────

/**
 * The persistent state of a relay channel (Durable Object).
 * Sent to WebSocket clients on connect, and returned by the HTTP state endpoint.
 * The DO is the source of truth — clients treat this as authoritative.
 */
export interface ChannelState {
  /** Currently selected VRM model ID, or null if not yet chosen */
  model: string | null;
  /** Unix timestamp (ms) of the last agent push event, or null if never pushed */
  lastAgentEventAt: number | null;
  /** Number of currently connected WebSocket clients */
  connectedClients: number;
}

// ─── WebSocket message types (server → client) ─────────────────────────────────

/** Sent once on WebSocket connect — full channel state + optional last event */
export interface ChannelStateMessage {
  type: 'channel_state';
  version: string;
  data: ChannelState & { lastEvent: AvatarEvent | null };
  timestamp: number;
}

/** Sent to all clients when any client changes the model */
export interface ModelChangedMessage {
  type: 'model_changed';
  version: string;
  data: { model: string | null };
  timestamp: number;
}

/** Existing avatar event message (unchanged) */
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

/** Client requests a model change — broadcasts to all connected clients */
export interface SetModelMessage {
  type: 'set_model';
  model: string | null;
}

export type WebSocketClientMessage = SetModelMessage | PongMessage;

// ─── HTTP response types ────────────────────────────────────────────────────────

/** Response from GET /channel/:token/state */
export type ChannelStateResponse = ChannelState;

// ─── Keepalive ──────────────────────────────────────────────────────────────────

/** Server-sent keepalive ping. Clients should reset their dead-connection timer on receipt. */
export interface PingMessage {
  type: 'ping';
}

/** Optional client-sent pong in response to a ping. */
export interface PongMessage {
  type: 'pong';
}
