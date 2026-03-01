import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app.tsx';
import './styles/global.css';

// StrictMode intentionally re-enabled. The async VRM load effect has a
// cancellation flag so double-mount in dev is handled correctly.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
