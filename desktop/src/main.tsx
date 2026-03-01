import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { DesktopApp } from './desktop-app.tsx';
import '../../web/src/styles/global.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <DesktopApp />
  </StrictMode>,
);
