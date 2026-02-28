/**
 * Clip Manager App — three-panel layout.
 */
import { useEffect, useState, useMemo } from 'react';
import { useAppState } from './state.ts';
import type { ClipsJson } from './types.ts';
import { Header } from './components/header.tsx';
import { StatusBar } from './components/status-bar.tsx';
import { ClipLibrary } from './components/clip-library.tsx';
import { ClipDetail } from './components/clip-detail.tsx';
import { ActionEditor } from './components/action-editor.tsx';
import { EmotionEditor } from './components/emotion-editor.tsx';
import { MatrixView } from './components/matrix-view.tsx';
import { PreviewPanel } from './preview/preview-panel.tsx';

// Import clips.json — Vite resolves this at build time
import clipsData from '../../web/src/data/clips.json';

// ─── Model options (from web app's manifest) ─────────────────────────────────

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
  borderRight: '1px solid var(--color-border)',
};

const tabBarStyle: React.CSSProperties = {
  display: 'flex',
  borderBottom: '1px solid var(--color-border)',
  flexShrink: 0,
};

const tabStyle = (active: boolean): React.CSSProperties => ({
  padding: '8px 16px',
  fontSize: 11,
  fontFamily: 'var(--font-mono)',
  fontWeight: 600,
  color: active ? 'var(--color-accent)' : 'var(--color-text-muted)',
  borderBottom: active ? '2px solid var(--color-accent)' : '2px solid transparent',
  cursor: 'pointer',
  transition: 'color 0.1s, border-color 0.1s',
  background: 'none',
});

const centerBodyStyle: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflow: 'hidden',
};

const rightPanelStyle: React.CSSProperties = {
  width: 380,
  flexShrink: 0,
  overflow: 'hidden',
};

// ─── Animation base path ─────────────────────────────────────────────────────

// FBX files are served from the web app's public dir.
// In dev, we symlink or use Vite proxy. For now, use relative path.
const ANIM_BASE = '/animations/';

// ─── App ──────────────────────────────────────────────────────────────────────

export function App() {
  const [state, dispatch] = useAppState(clipsData as ClipsJson);
  const [modelUrl, setModelUrl] = useState(MODEL_OPTIONS[0]!.url);

  // Resolve preview clip path
  const previewClipPath = useMemo(() => {
    if (!state.previewClip) return null;
    const clip = state.data.clips[state.previewClip];
    if (!clip) return null;
    return ANIM_BASE + clip.file;
  }, [state.previewClip, state.data.clips]);

  // Ctrl+S keyboard shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        // Trigger save via custom event (header listens)
        window.dispatchEvent(new CustomEvent('clips-save-request'));
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Listen for save confirmation
  useEffect(() => {
    const handler = () => dispatch({ type: 'MARK_SAVED' });
    window.addEventListener('clips-saved', handler);
    return () => window.removeEventListener('clips-saved', handler);
  }, [dispatch]);

  const renderCenterContent = () => {
    switch (state.activeTab) {
      case 'detail':
        return state.selectedClip ? (
          <ClipDetail clipId={state.selectedClip} data={state.data} dispatch={dispatch} />
        ) : (
          <div style={{ padding: 20, color: 'var(--color-text-dim)', fontStyle: 'italic', fontSize: 12 }}>
            Select a clip from the library to view details
          </div>
        );
      case 'actions':
        return <ActionEditor data={state.data} expandedAction={state.expandedAction} dispatch={dispatch} />;
      case 'emotions':
        return <EmotionEditor data={state.data} expandedEmotion={state.expandedEmotion} dispatch={dispatch} />;
      case 'matrix':
        return <MatrixView data={state.data} dispatch={dispatch} />;
      default:
        return null;
    }
  };

  return (
    <div style={layoutStyle}>
      <Header
        dirty={state.dirty}
        data={state.data}
        modelUrl={modelUrl}
        onModelChange={setModelUrl}
        modelOptions={MODEL_OPTIONS}
      />

      <div style={mainStyle}>
        {/* Left — Clip Library */}
        <div style={leftPanelStyle}>
          <ClipLibrary
            data={state.data}
            selectedClip={state.selectedClip}
            searchQuery={state.searchQuery}
            categoryFilter={state.categoryFilter}
            energyFilter={state.energyFilter}
            dispatch={dispatch}
          />
        </div>

        {/* Center — Tabs + Editor */}
        <div style={centerPanelStyle}>
          <div style={tabBarStyle}>
            <button style={tabStyle(state.activeTab === 'detail')} onClick={() => dispatch({ type: 'SET_TAB', tab: 'detail' })}>
              Detail
            </button>
            <button style={tabStyle(state.activeTab === 'actions')} onClick={() => dispatch({ type: 'SET_TAB', tab: 'actions' })}>
              Actions
            </button>
            <button style={tabStyle(state.activeTab === 'emotions')} onClick={() => dispatch({ type: 'SET_TAB', tab: 'emotions' })}>
              Emotions
            </button>
            <button style={tabStyle(state.activeTab === 'matrix')} onClick={() => dispatch({ type: 'SET_TAB', tab: 'matrix' })}>
              Matrix
            </button>
          </div>
          <div style={centerBodyStyle}>
            {renderCenterContent()}
          </div>
        </div>

        {/* Right — Preview */}
        <div style={rightPanelStyle}>
          <PreviewPanel
            clipPath={previewClipPath}
            modelUrl={modelUrl}
          />
        </div>
      </div>

      <StatusBar
        data={state.data}
        dirty={state.dirty}
        lastSaved={state.lastSaved}
      />
    </div>
  );
}
