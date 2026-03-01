/**
 * Clip Manager state — useReducer-based, separate from avatar app's Zustand.
 * v3: actions use groups[] array with rarity-weighted random selection.
 */
import { useReducer } from 'react';
import type { ClipsJson, ClipData, ActionData, EmotionData, ClipStatus } from './types.ts';

// ─── State ────────────────────────────────────────────────────────────────────

export interface AppState {
  data: ClipsJson;
  /** Currently selected clip id in the library panel */
  selectedClip: string | null;
  /** Currently active tab in header */
  activeTab: 'clips' | 'actions' | 'emotions';
  /** Currently expanded action (in actions tab) */
  expandedAction: string | null;
  /** Currently expanded emotion (in emotions tab) */
  expandedEmotion: string | null;
  /** Clip currently playing in preview (Clips tab — single clip preview) */
  previewClip: string | null;
  /** Action currently being previewed via engine (Actions tab — blended preview) */
  previewAction: string | null;
  /** Currently expanded group index within the selected action (for preview) */
  previewGroupIndex: number;
  /** Search query for clip library */
  searchQuery: string;
  /** Active category filter */
  categoryFilter: string | null;
  /** Active energy filter */
  energyFilter: string | null;
  /** Whether data has unsaved changes */
  dirty: boolean;
  /** Last save timestamp */
  lastSaved: number | null;
}

// ─── Actions ──────────────────────────────────────────────────────────────────

export type Action =
  | { type: 'SET_DATA'; data: ClipsJson }
  | { type: 'SELECT_CLIP'; clipId: string | null }
  | { type: 'SET_TAB'; tab: AppState['activeTab'] }
  | { type: 'EXPAND_ACTION'; action: string | null }
  | { type: 'EXPAND_EMOTION'; emotion: string | null }
  | { type: 'SET_PREVIEW_CLIP'; clipId: string | null }
  | { type: 'SET_PREVIEW_ACTION'; action: string | null }
  | { type: 'SET_PREVIEW_GROUP_INDEX'; index: number }
  | { type: 'SET_SEARCH'; query: string }
  | { type: 'SET_CATEGORY_FILTER'; category: string | null }
  | { type: 'SET_ENERGY_FILTER'; energy: string | null }
  | { type: 'UPDATE_CLIP'; clipId: string; data: Partial<ClipData> }
  | { type: 'ADD_CLIP'; clipId: string; data: ClipData }
  | { type: 'DELETE_CLIP'; clipId: string }
  | { type: 'UPDATE_ACTION'; action: string; data: Partial<ActionData> }
  | { type: 'UPDATE_EMOTION'; emotion: string; data: Partial<EmotionData> }
  | { type: 'CREATE_EMOTION'; emotion: string }
  | { type: 'MARK_SAVED' };

// ─── Reducer ──────────────────────────────────────────────────────────────────

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'SET_DATA':
      return { ...state, data: action.data, dirty: false };

    case 'SELECT_CLIP':
      return {
        ...state,
        selectedClip: action.clipId,
        activeTab: action.clipId ? 'clips' : state.activeTab,
      };

    case 'SET_TAB':
      return { ...state, activeTab: action.tab };

    case 'EXPAND_ACTION':
      return {
        ...state,
        expandedAction: action.action,
        previewAction: action.action,
        previewGroupIndex: 0,
      };

    case 'EXPAND_EMOTION':
      return { ...state, expandedEmotion: action.emotion };

    case 'SET_PREVIEW_CLIP':
      return { ...state, previewClip: action.clipId };

    case 'SET_PREVIEW_ACTION':
      return { ...state, previewAction: action.action };

    case 'SET_PREVIEW_GROUP_INDEX':
      return { ...state, previewGroupIndex: action.index };

    case 'SET_SEARCH':
      return { ...state, searchQuery: action.query };

    case 'SET_CATEGORY_FILTER':
      return { ...state, categoryFilter: action.category };

    case 'SET_ENERGY_FILTER':
      return { ...state, energyFilter: action.energy };

    case 'UPDATE_CLIP': {
      const clips = { ...state.data.clips };
      const existing = clips[action.clipId];
      if (!existing) return state;
      clips[action.clipId] = { ...existing, ...action.data };
      return { ...state, data: { ...state.data, clips }, dirty: true };
    }

    case 'ADD_CLIP': {
      const clips = { ...state.data.clips, [action.clipId]: action.data };
      return { ...state, data: { ...state.data, clips }, dirty: true };
    }

    case 'DELETE_CLIP': {
      const clips = { ...state.data.clips };
      delete clips[action.clipId];
      return {
        ...state,
        data: { ...state.data, clips },
        selectedClip: state.selectedClip === action.clipId ? null : state.selectedClip,
        dirty: true,
      };
    }

    case 'UPDATE_ACTION': {
      const actions = { ...state.data.actions };
      const existing = actions[action.action];
      if (!existing) return state;
      actions[action.action] = { ...existing, ...action.data };
      return { ...state, data: { ...state.data, actions }, dirty: true };
    }

    case 'UPDATE_EMOTION': {
      const emotions = { ...state.data.emotions };
      const existing = emotions[action.emotion];
      if (!existing) return state;
      emotions[action.emotion] = { ...existing, ...action.data };
      return { ...state, data: { ...state.data, emotions }, dirty: true };
    }

    case 'CREATE_EMOTION': {
      const emotions = { ...state.data.emotions };
      if (emotions[action.emotion]) return state;
      emotions[action.emotion] = { weightScale: 1.0, overrides: {}, layers: [] };
      return { ...state, data: { ...state.data, emotions }, dirty: true };
    }

    case 'MARK_SAVED':
      return { ...state, dirty: false, lastSaved: Date.now() };

    default:
      return state;
  }
}

// ─── Computed helpers ─────────────────────────────────────────────────────────

export function getClipStatus(clipId: string, data: ClipsJson): ClipStatus {
  for (const action of Object.values(data.actions)) {
    for (const group of action.groups) {
      if (group.clips.some(c => c.clip === clipId)) return 'mapped';
    }
  }
  for (const emotion of Object.values(data.emotions)) {
    for (const override of Object.values(emotion.overrides)) {
      if (override.clip === clipId) return 'mapped';
    }
    if (emotion.layers.some(l => l.clip === clipId)) return 'mapped';
  }
  return 'orphan';
}

export function getClipUsage(clipId: string, data: ClipsJson): { actions: string[]; emotions: string[] } {
  const actions: string[] = [];
  const emotions: string[] = [];

  for (const [name, action] of Object.entries(data.actions)) {
    const used = action.groups.some(g => g.clips.some(c => c.clip === clipId));
    if (used) actions.push(name);
  }

  for (const [name, emotion] of Object.entries(data.emotions)) {
    const inOverrides = Object.values(emotion.overrides).some(o => o.clip === clipId);
    const inLayers = emotion.layers.some(l => l.clip === clipId);
    if (inOverrides || inLayers) emotions.push(name);
  }

  return { actions, emotions };
}

export function getStats(data: ClipsJson) {
  const total = Object.keys(data.clips).length;
  let mapped = 0;
  let orphans = 0;
  for (const id of Object.keys(data.clips)) {
    if (getClipStatus(id, data) === 'mapped') mapped++;
    else orphans++;
  }
  return { total, mapped, orphans };
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

const EMPTY_DATA: ClipsJson = { version: 3, clips: {}, actions: {}, emotions: {} };

export function useAppState(initialData?: ClipsJson) {
  const initial: AppState = {
    data: initialData ?? EMPTY_DATA,
    selectedClip: null,
    activeTab: 'actions',
    expandedAction: null,
    expandedEmotion: null,
    previewClip: null,
    previewAction: null,
    previewGroupIndex: 0,
    searchQuery: '',
    categoryFilter: null,
    energyFilter: null,
    dirty: false,
    lastSaved: null,
  };

  return useReducer(reducer, initial);
}
