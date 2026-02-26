import type { AvatarEvent } from '../../packages/shared/src/schema.js';

export interface Env {
  CHANNEL: DurableObjectNamespace;
  RELAY_VERSION: string;
  RATE_LIMIT_KV: KVNamespace;
}

export interface WebSocketMessage {
  type: 'avatar_event';
  version: string;
  data: AvatarEvent;
  timestamp: number;
  replay: boolean;
}
