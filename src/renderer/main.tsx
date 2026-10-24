import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import './styles.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import type { Api } from '../shared/ipc.js';
import { App } from './App.js';
import { markPlatform } from './lib/platform.js';

declare global {
  interface Window {
    api: Api;
  }
}

const root = document.getElementById('root');
if (!root) throw new Error('index.html has no #root element');
markPlatform(document.documentElement, window.api.platformSync);
createRoot(root).render(
  <StrictMode>
    <App api={window.api} />
  </StrictMode>,
);
