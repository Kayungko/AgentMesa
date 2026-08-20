import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// Tokens first: every component css consumes Tier 2/3 custom properties.
import './styles/tokens.css';
import './components/ui/ui.css';
import './components/shell/shell.css';
import './components/conv/conv.css';
import './components/chat/chat.css';
import './components/cards/cards.css';
import './components/dialog/dialog.css';
import './components/views/views.css';
import './components/deploy/deploy.css';
import './components/widget/widget.css';
import { App } from './App.js';

const root = document.getElementById('root');
if (!root) {
  throw new Error('Root element not found');
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
