import { useStore } from '../state/store.ts';
import manifestData from '../assets/models/manifest.json';

interface ModelEntry {
  id: string;
  name: string;
  url: string | null;
  thumbnail?: string | null;
  author?: string;
  license?: string;
}

const manifest = manifestData as unknown as { models: ModelEntry[] };

const containerStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.5rem',
};

const labelStyle: React.CSSProperties = {
  fontSize: '0.8rem',
  fontWeight: 500,
  color: 'var(--color-text-muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
};

const gridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))',
  gap: '0.5rem',
};

const cardStyle: React.CSSProperties = {
  padding: '0.75rem',
  borderRadius: 8,
  border: '1px solid var(--color-border)',
  background: 'var(--color-bg)',
  cursor: 'pointer',
  textAlign: 'center',
  fontSize: '0.8rem',
  transition: 'border-color 0.15s, background 0.15s',
};

const activeCardStyle: React.CSSProperties = {
  ...cardStyle,
  borderColor: 'var(--color-accent)',
  background: 'rgba(108, 92, 231, 0.1)',
};

const emptyStyle: React.CSSProperties = {
  fontSize: '0.8rem',
  color: 'var(--color-text-muted)',
  fontStyle: 'italic',
  padding: '1rem 0',
};

export function ModelPicker() {
  const modelUrl = useStore((s) => s.modelUrl);
  const setModelUrl = useStore((s) => s.setModelUrl);

  const models = manifest.models;

  if (models.length === 0) {
    return (
      <div style={containerStyle}>
        <label style={labelStyle}>VRM Model</label>
        <p style={emptyStyle}>
          No bundled models yet. Drop a .vrm file here or add models to the manifest.
        </p>
      </div>
    );
  }

  return (
    <div style={containerStyle}>
      <label style={labelStyle}>VRM Model</label>
      <div style={gridStyle}>
        {models.map((model) => (
          <div
            key={model.id}
            style={modelUrl === model.url ? activeCardStyle : cardStyle}
            onClick={() => setModelUrl(model.url ?? null)}
          >
            <div style={{ fontWeight: 500 }}>{model.name}</div>
            {model.author && (
              <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', marginTop: 2 }}>
                by {model.author}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
