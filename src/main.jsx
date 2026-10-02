import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.jsx';
import { registerServiceWorker } from './registerSW.js';

// App owns its own providers (theme, toast, auth, data), so the root only has
// to render it.
createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

registerServiceWorker();
