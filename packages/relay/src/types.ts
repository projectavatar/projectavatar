import type { AvatarEvent } from '../../shared/src/schema.js';

export interface Env {
  CHANNEL: DurableObjectNamespace;
  RELAY_VERSION: string;
  // KV removed — rate limiting now uses DO SQL storage
}

export interface WebSocketMessage {
  type: 'avatar_event';
  version: string;
  data: AvatarEvent;
  timestamp: number;
  replay: boolean;
}
