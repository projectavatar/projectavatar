import { useEffect } from 'react';
import { useStore } from './state/store.ts';
import { SetupWizard } from './setup-wizard.tsx';
import { AvatarCanvas } from './avatar/avatar-canvas.tsx';
import { StatusBadge } from './components/status-badge.tsx';
import { SettingsDrawer } from './components/settings-drawer.tsx';

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
  const setSettingsOpen = useStore((s) => s.setSettingsOpen);

  // Apply theme to body
  useEffect(() => {
    document.body.style.background = theme === 'transparent' ? 'transparent' : 'var(--color-bg)';
  }, [theme]);

  // Onboarding: show wizard when missing token or model
  const needsOnboarding = !token || !modelId;

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
