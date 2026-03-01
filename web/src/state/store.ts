import { create } from 'zustand';
import { DEFAULTS, generateToken } from '@project-avatar/shared';
import type { Emotion, Action, Prop, Intensity, ChannelState, AvatarEvent } from '@project-avatar/shared';
import { DEFAULT_EFFECTS_STATE } from '@project-avatar/avatar-engine';
import type { EffectsState } from '@project-avatar/avatar-engine';
import manifest from '../assets/models/manifest.json';
import type { ModelEntry } from '../types.ts';

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

export interface AvatarState {
  emotion: Emotion;
  action: Action;
  prop: Prop;
  intensity: Intensity;
}

export interface AppState {
  token: string | null;
  relayUrl: string;
  modelId: string | null;
  modelUrl: string | null;
  lastAgentEventAt: number | null;
  // agentPresence is NOT stored — computed on render in StatusBadge
  // from lastAgentEventAt + Date.now() to avoid stale state.
  connectionState: ConnectionState;
  reconnectAttempt: number;
  /**
   * True once the first channel_state message is received from the DO after
   * connecting. Gates ModelPickerOverlay to prevent a flash between onopen
   * (connectionState = 'connected') and the first message event (channel_state).
   * Reset via resetConnectionState() on disconnect or token change.
   */
  channelStateReceived: boolean;
  avatar: AvatarState;
  effects: EffectsState;
  renderScale: number;
  settingsOpen: boolean;
  devPanelOpen: boolean;
  theme: 'dark' | 'transparent';
  setupComplete: boolean;
  setToken: (token: string | null) => void;
  setRelayUrl: (url: string) => void;
  setModelId: (id: string | null) => void;
  setModelUrl: (url: string | null) => void;
  setConnectionState: (state: ConnectionState) => void;
  setReconnectAttempt: (attempt: number) => void;
  setAvatarState: (state: Partial<AvatarState>) => void;
  setEffect: (effect: keyof EffectsState, enabled: boolean) => void;
  setRenderScale: (scale: number) => void;
  setSettingsOpen: (open: boolean) => void;
  setDevPanelOpen: (open: boolean) => void;
  setTheme: (theme: 'dark' | 'transparent') => void;
  setSetupComplete: (complete: boolean) => void;
  generateAndSetToken: () => string;
  /**
   * Apply channel state from DO on connect — single authoritative write path.
   * DO always wins over localStorage. Sets channelStateReceived = true.
   */
  applyChannelState: (channelState: ChannelState & { lastEvent: AvatarEvent | null }) => void;
  /** Record live agent event — updates lastAgentEventAt only */
  recordAgentEvent: () => void;
  /** Reset transient connection state — call on disconnect or token change */
  resetConnectionState: () => void;
}

const STORAGE_KEY = 'project-avatar-settings';

function resolveModelUrl(modelId: string | null): string | null {
  if (!modelId) return null;
  const models = (manifest as unknown as { models: ModelEntry[] }).models;
  const entry = models.find((m) => m.id === modelId);
  return entry?.url ?? null;
}

function updateUrlParams(params: Record<string, string | null>) {
  try {
    const url = new URL(window.location.href);
    for (const [key, value] of Object.entries(params)) {
      if (value != null) url.searchParams.set(key, value);
      else url.searchParams.delete(key);
    }
    url.searchParams.delete('model'); // strip stale pre-4.1 param
    window.history.replaceState(null, '', url.toString());
  } catch { /* SSR / restricted */ }
}

function loadPersistedState(): Partial<Pick<AppState, 'token' | 'relayUrl' | 'modelId' | 'modelUrl' | 'theme' | 'effects' | 'renderScale'>> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      token:    typeof parsed['token']    === 'string' ? parsed['token']    : undefined,
      relayUrl: typeof parsed['relayUrl'] === 'string' ? parsed['relayUrl'] : undefined,
      modelId:  typeof parsed['modelId']  === 'string' ? parsed['modelId']  : undefined,
      modelUrl: typeof parsed['modelUrl'] === 'string' ? parsed['modelUrl'] : undefined,
      theme:    parsed['theme'] === 'transparent' ? 'transparent' : undefined,
      effects:  parsed['effects'] && typeof parsed['effects'] === 'object' ? parsed['effects'] as EffectsState : undefined,
      renderScale: typeof parsed['renderScale'] === 'number' ? parsed['renderScale'] as number : undefined,
    };
  } catch { return {}; }
}

function persistState(state: Pick<AppState, 'token' | 'relayUrl' | 'modelId' | 'modelUrl' | 'theme' | 'effects' | 'renderScale'>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      token: state.token, relayUrl: state.relayUrl,
      modelId: state.modelId, modelUrl: state.modelUrl, theme: state.theme,
      effects: state.effects,
      renderScale: state.renderScale,
    }));
  } catch { /* localStorage unavailable */ }
}

function getUrlParams(): { token: string | null } {
  try { return { token: new URLSearchParams(window.location.search).get('token') }; }
  catch { return { token: null }; }
}

const persisted      = loadPersistedState();
const urlParams      = getUrlParams();
const initialToken   = urlParams.token ?? persisted.token ?? null;
const initialModelId = persisted.modelId ?? null;
const initialModelUrl = resolveModelUrl(initialModelId) ?? persisted.modelUrl ?? null;

export const useStore = create<AppState>((set, get) => ({
  token:    initialToken,
  relayUrl: persisted.relayUrl ?? DEFAULTS.relayUrl,
  modelId:  initialModelId,
  modelUrl: initialModelUrl,

  lastAgentEventAt:     null,
  channelStateReceived: false,
  connectionState:      'disconnected',
  reconnectAttempt:     0,

  avatar: { emotion: 'idle', action: 'idle', prop: 'none', intensity: 'medium' },
  effects: persisted.effects ?? { ...DEFAULT_EFFECTS_STATE },
  renderScale: persisted.renderScale ?? 2,

  settingsOpen:  false,
  devPanelOpen:  false,
  theme:         persisted.theme ?? 'dark',
  setupComplete: false,

  setToken: (token) => { set({ token }); persistState(get()); updateUrlParams({ token }); },

  setRelayUrl: (relayUrl) => { set({ relayUrl }); persistState(get()); },

  setModelId: (modelId) => {
    const modelUrl = resolveModelUrl(modelId);
    set({ modelId, modelUrl });
    persistState(get());
  },

  setModelUrl: (modelUrl) => { set({ modelUrl }); persistState(get()); },

  setConnectionState: (connectionState) => set({ connectionState }),

  setReconnectAttempt: (reconnectAttempt) => set({ reconnectAttempt }),

  setAvatarState: (partial) => set((state) => ({ avatar: { ...state.avatar, ...partial } })),

  setEffect: (effect, enabled) => {
    set((state) => ({
      effects: { ...state.effects, [effect]: enabled },
    }));
    persistState(get());
  },

  setRenderScale: (renderScale) => {
    set({ renderScale });
    persistState(get());
  },

  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  setDevPanelOpen: (devPanelOpen) => set({ devPanelOpen }),

  setTheme: (theme) => { set({ theme }); persistState(get()); },

  setSetupComplete: (complete) => set({ setupComplete: complete }),

  generateAndSetToken: () => {
    const token = generateToken();
    set({ token });
    persistState(get());
    updateUrlParams({ token });
    return token;
  },

  applyChannelState: (channelState) => {
    const modelId  = channelState.model;
    const modelUrl = resolveModelUrl(modelId);
    set({
      modelId,
      modelUrl,
      lastAgentEventAt:     channelState.lastAgentEventAt,
      channelStateReceived: true,
    });
    persistState(get());
  },

  recordAgentEvent: () => set({ lastAgentEventAt: Date.now() }),

  resetConnectionState: () => set({ channelStateReceived: false }),
}));
