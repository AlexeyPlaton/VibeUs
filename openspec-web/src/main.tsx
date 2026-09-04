import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import './widget-responsive.css';
import './enterprise-board.css';
import './enterprise-board-ux.css';
import './enterprise-dashboard.css';
import './enterprise-dialogs.css';
import App from './App';
import './pages/landingpage.v8.css';
import './i18n/config';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);