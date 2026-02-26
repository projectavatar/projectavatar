import { validateAvatarEvent } from '@project-avatar/shared';
import type { AvatarEvent } from '@project-avatar/shared';

export type ConnectionCallback = (state: 'connected' | 'disconnected' | 'reconnecting', attempt?: number) => void;
export type EventCallback = (event: AvatarEvent) => void;

interface WebSocketMessage {
  type: string;
  data?: unknown;
  timestamp?: number;
  replay?: boolean;
}

export class WebSocketClient {
  private url: string;
  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private maxReconnectDelay = 30_000;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private intentionalClose = false;
  private onEvent: EventCallback;
  private onConnectionChange: ConnectionCallback;

  constructor(
    relayUrl: string,
    token: string,
    onEvent: EventCallback,
    onConnectionChange: ConnectionCallback,
  ) {
    // Convert http(s) to ws(s)
    const wsBase = relayUrl.replace(/^http/, 'ws');
    this.url = `${wsBase}/stream/${token}`;
    this.onEvent = onEvent;
    this.onConnectionChange = onConnectionChange;
  }

  connect(): void {
    this.intentionalClose = false;
    this.cleanup();

    try {
      this.ws = new WebSocket(this.url);
    } catch (err) {
      console.warn('[Avatar WS] Failed to create WebSocket:', err);
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.onConnectionChange('connected');
      console.log('[Avatar WS] Connected');
    };

    this.ws.onmessage = (evt: MessageEvent) => {
      try {
        const msg = JSON.parse(String(evt.data)) as WebSocketMessage;
        if (msg.type === 'avatar_event' && msg.data) {
          const validation = validateAvatarEvent(msg.data);
          if (validation.ok) {
            this.onEvent(msg.data as AvatarEvent);
          } else {
            console.warn('[Avatar WS] Invalid event:', validation.error);
          }
        }
      } catch (e) {
        console.warn('[Avatar WS] Failed to parse message:', e);
      }
    };

    this.ws.onclose = () => {
      if (!this.intentionalClose) {
        this.scheduleReconnect();
      }
    };

    this.ws.onerror = () => {
      // onclose will fire after this, which handles reconnection
      this.ws?.close();
    };
  }

  disconnect(): void {
    this.intentionalClose = true;
    this.cleanup();
    this.onConnectionChange('disconnected');
    console.log('[Avatar WS] Disconnected (intentional)');
  }

  private cleanup(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onmessage = null;
      this.ws.onclose = null;
      this.ws.onerror = null;
      if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
        this.ws.close();
      }
      this.ws = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.intentionalClose) return;

    const delay = Math.min(
      1000 * Math.pow(2, this.reconnectAttempts) + Math.random() * 1000,
      this.maxReconnectDelay,
    );
    this.reconnectAttempts++;
    this.onConnectionChange('reconnecting', this.reconnectAttempts);
    console.log(`[Avatar WS] Reconnecting in ${Math.round(delay)}ms (attempt ${this.reconnectAttempts})`);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }
}
