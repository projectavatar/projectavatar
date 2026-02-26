import { create } from 'zustand';
import { DEFAULTS, generateToken } from '@project-avatar/shared';
import type { Emotion, Action, Prop, Intensity } from '@project-avatar/shared';
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
  setModelId: (id: string | null) => void;
  setModelUrl: (url: string | null) => void;
  setConnectionState: (state: ConnectionState) => void;
  setReconnectAttempt: (attempt: number) => void;
  setAvatarState: (state: Partial<AvatarState>) => void;
  setSettingsOpen: (open: boolean) => void;
  setTheme: (theme: 'dark' | 'transparent') => void;
  setSetupComplete: (complete: boolean) => void;
  generateAndSetToken: () => string;
}

const STORAGE_KEY = 'project-avatar-settings';

/** Look up a model's URL from the manifest by ID */
function resolveModelUrl(modelId: string | null): string | null {
  if (!modelId) return null;
  const models = (manifest as unknown as { models: ModelEntry[] }).models;
  const entry = models.find((m) => m.id === modelId);
  return entry?.url ?? null;
}

/** Update URL params via history.replaceState — no reload */
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
      token: typeof parsed['token'] === 'string' ? parsed['token'] : undefined,
      relayUrl: typeof parsed['relayUrl'] === 'string' ? parsed['relayUrl'] : undefined,
      modelId: typeof parsed['modelId'] === 'string' ? parsed['modelId'] : undefined,
      modelUrl: typeof parsed['modelUrl'] === 'string' ? parsed['modelUrl'] : undefined,
      theme: parsed['theme'] === 'transparent' ? 'transparent' : undefined,
    };
  } catch {
    return {};
  }
}

function persistState(state: Pick<AppState, 'token' | 'relayUrl' | 'modelId' | 'modelUrl' | 'theme'>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      token: state.token,
      relayUrl: state.relayUrl,
      modelId: state.modelId,
      modelUrl: state.modelUrl,
      theme: state.theme,
    }));
  } catch {
    // localStorage may be unavailable (e.g. OBS browser source privacy settings)
  }
}

/** Read URL params on init */
function getUrlParams(): { token: string | null; model: string | null } {
  try {
    const params = new URLSearchParams(window.location.search);
    return {
      token: params.get('token'),
      model: params.get('model'),
    };
  } catch {
    return { token: null, model: null };
  }
}

const persisted = loadPersistedState();
const urlParams = getUrlParams();

// URL params win over localStorage
const initialToken = urlParams.token ?? persisted.token ?? null;
const initialModelId = urlParams.model ?? persisted.modelId ?? null;
const initialModelUrl = resolveModelUrl(initialModelId) ?? persisted.modelUrl ?? null;

export const useStore = create<AppState>((set, get) => ({
  token: initialToken,
  relayUrl: persisted.relayUrl ?? DEFAULTS.relayUrl,
  modelId: initialModelId,
  modelUrl: initialModelUrl,

  connectionState: 'disconnected',
  reconnectAttempt: 0,

  avatar: {
    emotion: 'idle',
    action: 'waiting',
    prop: 'none',
    intensity: 'medium',
  },

  settingsOpen: false,
  theme: persisted.theme ?? 'dark',
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
    const state = get();
    persistState(state);
    updateUrlParams({ model: modelId });
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

  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),

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
}));
