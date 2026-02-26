import { useStore } from './state/store.ts';
import { SetupWizard } from './SetupWizard.tsx';
import { AvatarCanvas } from './avatar/AvatarCanvas.tsx';
import { StatusBadge } from './components/StatusBadge.tsx';
import { SettingsDrawer } from './components/SettingsDrawer.tsx';

const settingsBtnStyle: React.CSSProperties = {
  position: 'fixed',
  top: 12,
  left: 12,
  width: 32,
  height: 32,
  borderRadius: 6,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 16,
  color: 'var(--color-text-muted)',
  background: 'rgba(10, 10, 15, 0.75)',
  backdropFilter: 'blur(8px)',
  border: '1px solid var(--color-border)',
  cursor: 'pointer',
  zIndex: 100,
  transition: 'border-color 0.15s',
};

const avatarContainerStyle: React.CSSProperties = {
  width: '100%',
  height: '100%',
  position: 'relative',
};

export function App() {
  const token = useStore((s) => s.token);
  const modelId = useStore((s) => s.modelId);
  const theme = useStore((s) => s.theme);
  const setupComplete = useStore((s) => s.setupComplete);
  const setSettingsOpen = useStore((s) => s.setSettingsOpen);

  // Apply theme to body
  if (typeof document !== 'undefined') {
    document.body.style.background = theme === 'transparent' ? 'transparent' : 'var(--color-bg)';
  }

  // Onboarding complete = has token + modelId + setup complete
  const needsOnboarding = !token || !modelId || !setupComplete;

  if (needsOnboarding) {
    return <SetupWizard />;
  }

  // Token + model present → show avatar with controls
  return (
    <div style={avatarContainerStyle}>
      <AvatarCanvas />
      <StatusBadge />
      <button
        style={settingsBtnStyle}
        onClick={() => setSettingsOpen(true)}
        title="Settings"
      >
        ⚙
      </button>
      <SettingsDrawer />
    </div>
  );
}
