import { createRoot } from 'react-dom/client';
import { App } from './app.tsx';
import './styles/global.css';

// StrictMode disabled intentionally — double-mount in dev breaks the Three.js
// scene lifecycle (async VRM load + AnimationController disposal race condition).
// Re-enable only after the scene lifecycle is made cancellation-safe.
createRoot(document.getElementById('root')!).render(<App />);
