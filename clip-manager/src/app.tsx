/**
 * Clip Manager App — consistent 3-column layout across all tabs.
 *
 * Header: tabs (Actions / Emotions / Clips) + model selector + save
 * Body: [left list | center detail | right preview]
 */
import { useEffect, useState, useMemo, useCallback } from 'react';
import { useAppState } from './state.ts';
import type { ClipsJson } from './types.ts';
import { Header } from './components/header.tsx';
import { StatusBar } from './components/status-bar.tsx';
import { ClipLibrary } from './components/clip-library.tsx';
import { ClipDetail } from './components/clip-detail.tsx';
import { ActionList } from './components/action-list.tsx';
import { ActionEditor } from './components/action-editor.tsx';
import { EmotionList } from './components/emotion-list.tsx';
import { EmotionEditor } from './components/emotion-editor.tsx';
import { PropList } from './components/prop-list.tsx';
import { PropEditor } from './components/prop-editor.tsx';
import { PreviewPanel } from './preview/preview-panel.tsx';

import clipsData from '@data/clips.json';
import { useScanClips } from './hooks/use-scan-clips.ts';
import { useScanProps } from './hooks/use-scan-props.ts';

// ─── Model options ────────────────────────────────────────────────────────────

const MODEL_OPTIONS = [
  { id: 'maid', url: '/models/maid.vrm' },
  { id: 'avatarsample_c', url: '/models/avatarsample_c.vrm' },
  { id: 'avatarsample_a', url: '/models/avatarsample_a.vrm' },
  { id: 'maid_0', url: '/models/maid_0.vrm' },
  { id: 'potato', url: '/models/potato.vrm' },
  { id: 'summer', url: '/models/summer.vrm' },
  { id: 'turtle', url: '/models/turtle.vrm' },
];

// ─── Styles ───────────────────────────────────────────────────────────────────

const layoutStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  width: '100%',
};

const mainStyle: React.CSSProperties = {
  display: 'flex',
  flex: 1,
  minHeight: 0,
  overflow: 'hidden',
};

const leftPanelStyle: React.CSSProperties = {
  width: 280,
  flexShrink: 0,
  overflow: 'hidden',
};

const centerPanelStyle: React.CSSProperties = {
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  minWidth: 0,
  borderLeft: '1px solid var(--color-border)',
};

const centerBodyStyle: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflow: 'hidden',
};

const rightPanelStyle: React.CSSProperties = {
  width: 450,
  flexShrink: 0,
  overflow: 'hidden',
};

const ANIM_BASE = '/animations/';

// ─── App ──────────────────────────────────────────────────────────────────────

export function App() {
  const [state, dispatch] = useAppState(clipsData as ClipsJson);
  const unregisteredClips = useScanClips(state.data);
  const availableProps = useScanProps();
  const [modelUrl, setModelUrl] = useState(MODEL_OPTIONS[0]!.url);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Preview clip path (Clips tab — single clip)
  const previewClipPath = useMemo(() => {
    if (state.activeTab !== 'clips') return null;
    if (!state.previewClip) return null;
    const clip = state.data.clips[state.previewClip];
    if (!clip) return null;
    return ANIM_BASE + clip.file;
  }, [state.previewClip, state.data.clips, state.activeTab]);

  const previewClipBodyParts = useMemo(() => {
    if (!state.previewClip) return undefined;
    const clip = state.data.clips[state.previewClip];
    return clip?.bodyParts;
  }, [state.previewClip, state.data.clips]);

  // Preview action (Actions tab — blended action)
  const previewAction = state.activeTab === 'actions' ? state.previewAction : null;
  const previewGroupIndex = state.activeTab === 'actions' ? state.previewGroupIndex : 0;

  const handleSave = useCallback(async () => {
    setSaveError(null);
    try {
      const res = await fetch('/api/save-clips', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(state.data),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? 'Save failed');
      }
      dispatch({ type: 'MARK_SAVED' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Save failed';
      setSaveError(msg);
      console.error('[ClipManager] Save failed:', err);
    }
  }, [state.data, dispatch]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        void handleSave();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleSave]);

  return (
    <div style={layoutStyle}>
      <Header
        dirty={state.dirty}
        data={state.data}
        modelUrl={modelUrl}
        activeTab={state.activeTab}
        onTabChange={(tab) => dispatch({ type: 'SET_TAB', tab })}
        onModelChange={setModelUrl}
        onSave={handleSave}
        modelOptions={MODEL_OPTIONS}
      />

      <div style={mainStyle}>
        {/* Left panel — list */}
        <div style={leftPanelStyle}>
          {state.activeTab === 'clips' && (
            <ClipLibrary
              data={state.data}
              selectedClip={state.selectedClip}
              searchQuery={state.searchQuery}
              categoryFilter={state.categoryFilter}
              energyFilter={state.energyFilter}
              unregisteredClips={unregisteredClips}
              dispatch={dispatch}
            />
          )}
          {state.activeTab === 'actions' && (
            <ActionList
              data={state.data}
              selectedAction={state.expandedAction}
              dispatch={dispatch}
            />
          )}
          {state.activeTab === 'emotions' && (
            <EmotionList
              data={state.data}
              selectedEmotion={state.expandedEmotion}
              dispatch={dispatch}
            />
          )}
          {state.activeTab === 'props' && (
            <PropList
              data={state.data}
              availableProps={availableProps}
              selectedProp={state.selectedProp}
              dispatch={dispatch}
            />
          )}
        </div>

        {/* Center panel — detail */}
        <div style={centerPanelStyle}>
          <div style={centerBodyStyle}>
            {state.activeTab === 'clips' && (
              state.selectedClip ? (
                <ClipDetail clipId={state.selectedClip} data={state.data} dispatch={dispatch} />
              ) : (
                <div style={{ padding: 20, color: 'var(--color-text-dim)', fontStyle: 'italic', fontSize: 12 }}>
                  Select a clip from the library
                </div>
              )
            )}
            {state.activeTab === 'actions' && (
              <ActionEditor
                data={state.data}
                selectedAction={state.expandedAction}
                dispatch={dispatch}
              />
            )}
            {state.activeTab === 'emotions' && (
              <EmotionEditor
                data={state.data}
                selectedEmotion={state.expandedEmotion}
                dispatch={dispatch}
              />
            )}
            {state.activeTab === 'props' && (
              <PropEditor
                data={state.data}
                selectedProp={state.selectedProp}
                dispatch={dispatch}
              />
            )}
          </div>
        </div>

        {/* Right panel — preview */}
        <div style={rightPanelStyle}>
          <PreviewPanel
            clipPath={previewClipPath}
            modelUrl={modelUrl}
            clipBodyParts={previewClipBodyParts}
            clipsData={state.data}
            previewAction={previewAction}
            previewGroupIndex={previewGroupIndex}
          />
        </div>
      </div>

      <StatusBar
        data={state.data}
        dirty={state.dirty}
        lastSaved={state.lastSaved}
        saveError={saveError}
      />
    </div>
  );
}
