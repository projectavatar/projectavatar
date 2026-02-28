import { validateAvatarEvent } from '@project-avatar/shared';
import type { AvatarEvent, ChannelState } from '@project-avatar/shared';

export type ConnectionCallback = (state: 'connected' | 'disconnected' | 'reconnecting', attempt?: number) => void;
export type EventCallback = (event: AvatarEvent) => void;
export type ChannelStateCallback = (state: ChannelState & { lastEvent: AvatarEvent | null }) => void;
export type ModelChangedCallback = (model: string | null) => void;

interface ServerMessage {
  type: string;
  data?: unknown;
  timestamp?: number;
  replay?: boolean;
  version?: string;
}

/** If no message is received within this window, close + reconnect */
const KEEPALIVE_TIMEOUT_MS = 60_000;

export class WebSocketClient {
  private url: string;
  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private maxReconnectDelay = 30_000;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private keepaliveTimer: ReturnType<typeof setTimeout> | null = null;
  private intentionalClose = false;
  private onEvent: EventCallback;
  private onConnectionChange: ConnectionCallback;
  private onChannelState: ChannelStateCallback;
  private onModelChanged: ModelChangedCallback;

  constructor(
    relayUrl: string,
    token: string,
    onEvent: EventCallback,
    onConnectionChange: ConnectionCallback,
    onChannelState: ChannelStateCallback,
    onModelChanged: ModelChangedCallback,
  ) {
    const wsBase = relayUrl.replace(/^http/, 'ws');
    this.url = `${wsBase}/stream/${token}`;
    this.onEvent = onEvent;
    this.onConnectionChange = onConnectionChange;
    this.onChannelState = onChannelState;
    this.onModelChanged = onModelChanged;
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
      this.resetKeepalive();
      console.log('[Avatar WS] Connected');
    };

    this.ws.onmessage = (evt: MessageEvent) => {
      this.resetKeepalive(); // Any message resets the dead-connection timer
      try {
        const msg = JSON.parse(String(evt.data)) as ServerMessage;
        this.handleMessage(msg);
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
      // onclose fires after this — reconnection handled there
      this.ws?.close();
    };
  }

  disconnect(): void {
    this.intentionalClose = true;
    this.cleanup();
    this.onConnectionChange('disconnected');
    console.log('[Avatar WS] Disconnected (intentional)');
  }

  private resetKeepalive(): void {
    if (this.keepaliveTimer !== null) clearTimeout(this.keepaliveTimer);
    this.keepaliveTimer = setTimeout(() => {
      this.keepaliveTimer = null;
      console.warn('[Avatar WS] No message in 60s — reconnecting');
      this.ws?.close(); // onclose fires → scheduleReconnect
    }, KEEPALIVE_TIMEOUT_MS);
  }

  /**
   * Send a set_model message to the relay.
   * The DO will persist the model and broadcast `model_changed` to all clients
   * (including the sender). The local store is updated when `model_changed`
   * arrives — do not update it optimistically here.
   */
  sendSetModel(model: string | null): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn('[Avatar WS] Cannot send set_model — not connected');
      return;
    }
    this.ws.send(JSON.stringify({ type: 'set_model', model }));
  }

  private handleMessage(msg: ServerMessage): void {
    switch (msg.type) {
      case 'channel_state': {
        const data = msg.data as (ChannelState & { lastEvent: AvatarEvent | null }) | undefined;
        if (data) {
          this.onChannelState(data);
          // If there's a last event included, replay it through the event handler
          if (data.lastEvent) {
            const validation = validateAvatarEvent(data.lastEvent);
            if (validation.ok) {
              this.onEvent(data.lastEvent as AvatarEvent);
            }
          }
        }
        break;
      }

      case 'avatar_event': {
        if (msg.data) {
          const validation = validateAvatarEvent(msg.data);
          if (validation.ok) {
            this.onEvent(msg.data as AvatarEvent);
          } else {
            console.warn('[Avatar WS] Invalid avatar_event:', validation.error);
          }
        }
        break;
      }

      case 'model_changed': {
        const data = msg.data as { model: string | null } | undefined;
        if (data !== undefined) {
          this.onModelChanged(data.model ?? null);
        }
        break;
      }

      case 'ping': {
        // Server keepalive — respond with pong. resetKeepalive() already
        // fired in onmessage before we got here, so the timer is reset.
        try { this.ws?.send(JSON.stringify({ type: 'pong' })); } catch { /* noop */ }
        break;
      }

      default:
        // Unknown message type — ignore
        break;
    }
  }

  private cleanup(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.keepaliveTimer !== null) {
      clearTimeout(this.keepaliveTimer);
      this.keepaliveTimer = null;
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
