import { create } from 'zustand';
import { DEFAULTS, generateToken } from '@project-avatar/shared';
import type { Emotion, Action, Prop, Intensity } from '@project-avatar/shared';

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
  modelUrl: string | null;

  // Connection
  connectionState: ConnectionState;
  reconnectAttempt: number;

  // Avatar
  avatar: AvatarState;

  // UI
  settingsOpen: boolean;
  theme: 'dark' | 'transparent';

  // Actions
  setToken: (token: string | null) => void;
  setRelayUrl: (url: string) => void;
  setModelUrl: (url: string | null) => void;
  setConnectionState: (state: ConnectionState) => void;
  setReconnectAttempt: (attempt: number) => void;
  setAvatarState: (state: Partial<AvatarState>) => void;
  setSettingsOpen: (open: boolean) => void;
  setTheme: (theme: 'dark' | 'transparent') => void;
  generateAndSetToken: () => string;
}

const STORAGE_KEY = 'project-avatar-settings';

function loadPersistedState(): Partial<Pick<AppState, 'token' | 'relayUrl' | 'modelUrl' | 'theme'>> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      token: typeof parsed['token'] === 'string' ? parsed['token'] : undefined,
      relayUrl: typeof parsed['relayUrl'] === 'string' ? parsed['relayUrl'] : undefined,
      modelUrl: typeof parsed['modelUrl'] === 'string' ? parsed['modelUrl'] : undefined,
      theme: parsed['theme'] === 'transparent' ? 'transparent' : undefined,
    };
  } catch {
    return {};
  }
}

function persistState(state: Pick<AppState, 'token' | 'relayUrl' | 'modelUrl' | 'theme'>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      token: state.token,
      relayUrl: state.relayUrl,
      modelUrl: state.modelUrl,
      theme: state.theme,
    }));
  } catch {
    // localStorage may be unavailable (e.g. OBS browser source privacy settings)
  }
}

// Check URL for token param (OBS browser source / share link)
function getTokenFromUrl(): string | null {
  try {
    const params = new URLSearchParams(window.location.search);
    return params.get('token');
  } catch {
    return null;
  }
}

const persisted = loadPersistedState();
const urlToken = getTokenFromUrl();

export const useStore = create<AppState>((set, get) => ({
  // URL token wins over localStorage
  token: urlToken ?? persisted.token ?? null,
  relayUrl: persisted.relayUrl ?? DEFAULTS.relayUrl,
  modelUrl: persisted.modelUrl ?? null,

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

  setToken: (token) => {
    set({ token });
    persistState({ ...get(), token });
  },

  setRelayUrl: (relayUrl) => {
    set({ relayUrl });
    persistState({ ...get(), relayUrl });
  },

  setModelUrl: (modelUrl) => {
    set({ modelUrl });
    persistState({ ...get(), modelUrl });
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
    persistState({ ...get(), theme });
  },

  generateAndSetToken: () => {
    const token = generateToken();
    set({ token });
    persistState({ ...get(), token });
    return token;
  },
}));
