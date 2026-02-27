import { create } from 'zustand';
import { DEFAULTS, generateToken } from '@project-avatar/shared';
import type { Emotion, Action, Prop, Intensity, ChannelState, AvatarEvent } from '@project-avatar/shared';
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
  // Auth / config
  token: string | null;
  relayUrl: string;
  modelId: string | null;
  modelUrl: string | null;

  // Channel state (from DO — source of truth)
  lastAgentEventAt: number | null;
  /** Computed from lastAgentEventAt — updated live as avatar_events arrive */
  agentPresence: 'active' | 'recent' | 'away';

  // Connection
  connectionState: ConnectionState;
  reconnectAttempt: number;

  // Avatar
  avatar: AvatarState;

  // UI
  settingsOpen: boolean;
  theme: 'dark' | 'transparent';
  setupComplete: boolean;

  // Actions
  setToken: (token: string | null) => void;
  setRelayUrl: (url: string) => void;
  /** Update local model state (called when model_changed arrives from DO) */
  setModelId: (id: string | null) => void;
  setModelUrl: (url: string | null) => void;
  setConnectionState: (state: ConnectionState) => void;
  setReconnectAttempt: (attempt: number) => void;
  setAvatarState: (state: Partial<AvatarState>) => void;
  setSettingsOpen: (open: boolean) => void;
  setTheme: (theme: 'dark' | 'transparent') => void;
  setSetupComplete: (complete: boolean) => void;
  generateAndSetToken: () => string;
  /**
   * Apply the full channel state received from the DO on WebSocket connect.
   * This is the single authoritative write path for DO-owned state.
   * Overwrites any locally cached model — DO always wins.
   */
  applyChannelState: (channelState: ChannelState & { lastEvent: AvatarEvent | null }) => void;
  /** Record a live agent event — updates lastAgentEventAt + agentPresence without a full channel_state */
  recordAgentEvent: () => void;
}

const STORAGE_KEY = 'project-avatar-settings';

/** Look up a model's URL from the manifest by ID */
function resolveModelUrl(modelId: string | null): string | null {
  if (!modelId) return null;
  const models = (manifest as unknown as { models: ModelEntry[] }).models;
  const entry = models.find((m) => m.id === modelId);
  return entry?.url ?? null;
}

/**
 * Update URL params via history.replaceState — no reload.
 * Only token is stored in the URL. Model is owned by the DO.
 */
function updateUrlParams(params: Record<string, string | null>) {
  try {
    const url = new URL(window.location.href);
    for (const [key, value] of Object.entries(params)) {
      if (value != null) {
        url.searchParams.set(key, value);
      } else {
        url.searchParams.delete(key);
      }
    }
    // Also strip any stale `model` param from old URLs
    url.searchParams.delete('model');
    window.history.replaceState(null, '', url.toString());
  } catch {
    // SSR or restricted environment — silently ignore
  }
}

function loadPersistedState(): Partial<Pick<AppState, 'token' | 'relayUrl' | 'modelId' | 'modelUrl' | 'theme'>> {
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
    };
  } catch {
    return {};
  }
}

function persistState(state: Pick<AppState, 'token' | 'relayUrl' | 'modelId' | 'modelUrl' | 'theme'>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      token:    state.token,
      relayUrl: state.relayUrl,
      modelId:  state.modelId,
      modelUrl: state.modelUrl,
      theme:    state.theme,
    }));
  } catch {
    // localStorage may be unavailable (e.g. OBS browser source privacy settings)
  }
}

/** Compute agent presence from a lastAgentEventAt timestamp */
function computePresence(ts: number | null): 'active' | 'recent' | 'away' {
  if (!ts) return 'away';
  const age = Date.now() - ts;
  if (age < 60_000)  return 'active';
  if (age < 300_000) return 'recent';
  return 'away';
}

/** Read URL params on init — token only, model is owned by DO */
function getUrlParams(): { token: string | null } {
  try {
    const params = new URLSearchParams(window.location.search);
    return { token: params.get('token') };
  } catch {
    return { token: null };
  }
}

const persisted  = loadPersistedState();
const urlParams  = getUrlParams();

// Token: URL wins over localStorage (share links, OBS browser sources)
const initialToken = urlParams.token ?? persisted.token ?? null;

// Model: localStorage is an optimistic cache only.
// The DO will send the real model via channel_state on connect.
// If they disagree, applyChannelState() (called on connect) wins.
const initialModelId  = persisted.modelId ?? null;
const initialModelUrl = resolveModelUrl(initialModelId) ?? persisted.modelUrl ?? null;

export const useStore = create<AppState>((set, get) => ({
  token:    initialToken,
  relayUrl: persisted.relayUrl ?? DEFAULTS.relayUrl,
  modelId:  initialModelId,
  modelUrl: initialModelUrl,

  lastAgentEventAt: null,
  agentPresence: 'away',

  connectionState: 'disconnected',
  reconnectAttempt: 0,

  avatar: {
    emotion:   'idle',
    action:    'waiting',
    prop:      'none',
    intensity: 'medium',
  },

  settingsOpen:  false,
  theme:         persisted.theme ?? 'dark',
  setupComplete: false,

  setToken: (token) => {
    set({ token });
    const state = get();
    persistState(state);
    updateUrlParams({ token });
  },

  setRelayUrl: (relayUrl) => {
    set({ relayUrl });
    persistState(get());
  },

  setModelId: (modelId) => {
    const modelUrl = resolveModelUrl(modelId);
    set({ modelId, modelUrl });
    persistState(get());
    // No URL param update — model is owned by the DO, not the URL
  },

  setModelUrl: (modelUrl) => {
    set({ modelUrl });
    persistState(get());
  },

  setConnectionState: (connectionState) => set({ connectionState }),

  setReconnectAttempt: (reconnectAttempt) => set({ reconnectAttempt }),

  setAvatarState: (partial) =>
    set((state) => ({
      avatar: { ...state.avatar, ...partial },
    })),

  setSettingsOpen:  (settingsOpen)  => set({ settingsOpen }),

  setTheme: (theme) => {
    set({ theme });
    persistState(get());
  },

  setSetupComplete: (complete) => {
    set({ setupComplete: complete });
  },

  generateAndSetToken: () => {
    const token = generateToken();
    set({ token });
    const state = get();
    persistState(state);
    updateUrlParams({ token });
    return token;
  },

  applyChannelState: (channelState) => {
    const modelId  = channelState.model;
    const modelUrl = resolveModelUrl(modelId);
    set({
      modelId,
      modelUrl,
      lastAgentEventAt: channelState.lastAgentEventAt,
      agentPresence:    computePresence(channelState.lastAgentEventAt),
    });
    // Update localStorage cache with the DO's model
    persistState(get());
  },

  recordAgentEvent: () => {
    const now = Date.now();
    set({ lastAgentEventAt: now, agentPresence: 'active' });
  },
}));
