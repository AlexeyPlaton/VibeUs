import React from 'react';
import ReactDOM from 'react-dom/client';
import { I18nextProvider } from 'react-i18next';
import i18n from './i18n/config';
import { VibusWidgetUI } from './components/VibusWidgetUI';
import './index.css';
import './widget-responsive.css';
import './enterprise-board.css';

type WidgetThemePreference = 'dark' | 'light' | 'auto';
type ResolvedWidgetTheme = 'dark' | 'light';

function consumeUrlCapability(): string {
  if (typeof window === 'undefined') return '';

  try {
    const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const token = hashParams.get('vibus_auth') || hashParams.get('vibus_key') || '';
    if (!token) return '';

    // Capabilities are accepted only from the URL fragment so they are never
    // sent to the HTTP server as part of the request target. After reading,
    // remove them immediately; the token remains only in this widget instance.
    hashParams.delete('vibus_auth');
    hashParams.delete('vibus_key');
    hashParams.delete('single_use');

    const hash = hashParams.toString();
    window.history.replaceState(
      null,
      '',
      window.location.pathname + window.location.search + (hash ? `#${hash}` : ''),
    );
    return token;
  } catch {
    return '';
  }
}

function resolveTheme(preference: WidgetThemePreference): ResolvedWidgetTheme {
  if (preference === 'light' || preference === 'dark') return preference;
  if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches) {
    return 'dark';
  }
  return 'light';
}

class VibusWidget extends HTMLElement {
  private root: ReactDOM.Root | null = null;
  private shadow: ShadowRoot | null = null;
  private container: HTMLDivElement | null = null;
  private capabilityToken = '';
  private themeMedia: MediaQueryList | null = null;
  private themeListener: ((event: MediaQueryListEvent) => void) | null = null;

  private applyResolvedTheme(theme: ResolvedWidgetTheme) {
    if (!this.container) return;
    this.container.className = [
      'vibeus-widget-root',
      'vibus-widget-root',
      'vibe-enterprise-shell',
      `vibe-theme-${theme}`,
      theme === 'dark' ? 'dark' : '',
    ].filter(Boolean).join(' ');
  }

  private stopSystemThemeListener() {
    if (this.themeMedia && this.themeListener) {
      this.themeMedia.removeEventListener('change', this.themeListener);
    }
    this.themeMedia = null;
    this.themeListener = null;
  }

  connectedCallback() {
    if (this.root) return;

    if (!this.shadow) {
      this.shadow = this.attachShadow({ mode: 'open' });
    }

    const projectId = this.getAttribute('project-id') || 'default';
    const serverUrl = this.getAttribute('server-url') || (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:8000');
    const apiToken = this.getAttribute('api-token') || this.capabilityToken || consumeUrlCapability();
    if (apiToken) this.capabilityToken = apiToken;
    const publicKey = this.getAttribute('public-key') || this.getAttribute('public-widget-key') || '';
    const rawTheme = this.getAttribute('theme');
    const theme: WidgetThemePreference = rawTheme === 'light' || rawTheme === 'dark' || rawTheme === 'auto' ? rawTheme : 'auto';
    const accentColor = this.getAttribute('accent-color') || 'indigo';
    const modeAttr = this.getAttribute('mode') || 'studio';
    const mode: 'studio' | 'public_feedback' | 'client_preview' = modeAttr === 'public' || modeAttr === 'public_feedback' ? 'public_feedback' : (modeAttr === 'client_preview' ? 'client_preview' : 'studio');

    // Keep a single stylesheet and root node across custom-element reconnects.
    let styleLink = this.shadow.querySelector<HTMLLinkElement>('link[data-vibus-style]');
    if (!styleLink) {
      styleLink = document.createElement('link');
      styleLink.rel = 'stylesheet';
      styleLink.dataset.vibusStyle = 'true';
      styleLink.href = serverUrl.replace(/\/$/, '') + '/static/vibus-widget.css';
      this.shadow.appendChild(styleLink);
    }

    this.container = this.shadow.querySelector<HTMLDivElement>('[data-vibus-root]');
    if (!this.container) {
      this.container = document.createElement('div');
      this.container.dataset.vibusRoot = 'true';
      this.shadow.appendChild(this.container);
    }

    this.applyResolvedTheme(resolveTheme(theme));
    this.stopSystemThemeListener();
    if (theme === 'auto' && typeof window !== 'undefined' && window.matchMedia) {
      this.themeMedia = window.matchMedia('(prefers-color-scheme: dark)');
      this.themeListener = (event) => this.applyResolvedTheme(event.matches ? 'dark' : 'light');
      this.themeMedia.addEventListener('change', this.themeListener);
    }

    this.root = ReactDOM.createRoot(this.container);
    this.root.render(
      <React.StrictMode>
        <I18nextProvider i18n={i18n}>
          <VibusWidgetUI
            projectId={projectId}
            serverUrl={serverUrl}
            apiToken={apiToken}
            publicKey={publicKey}
            theme={theme}
            accentColor={accentColor}
            mode={mode}
          />
        </I18nextProvider>
      </React.StrictMode>
    );
  }

  disconnectedCallback() {
    this.stopSystemThemeListener();
    if (this.root) {
      this.root.unmount();
      this.root = null;
    }
  }
}

class VibeusWidgetAlias extends VibusWidget {}

if (!customElements.get('vibus-widget')) {
  customElements.define('vibus-widget', VibusWidget);
}
if (!customElements.get('vibeus-widget')) {
  customElements.define('vibeus-widget', VibeusWidgetAlias);
}

// Automatically create and append <vibus-widget> to document if loaded via <script> tag
function autoMountWidget() {
  if (typeof document === 'undefined') return;

  // If already instantiated, skip
  if (document.querySelector('vibus-widget, vibeus-widget')) return;

  const scripts = document.querySelectorAll('script[src*="widget.js"], script[src*="vibus-widget"]');
  const currentScript = scripts[scripts.length - 1];

  const projectId = currentScript?.getAttribute('data-project') || 'default';
  const serverUrl = currentScript?.getAttribute('data-server') || (typeof window !== 'undefined' ? window.location.origin : 'https://vibeus.pro');
  const apiToken = currentScript?.getAttribute('data-token') || consumeUrlCapability();
  const publicKey = currentScript?.getAttribute('data-public-key') || '';
  const mode = currentScript?.getAttribute('data-mode') || 'public_feedback';
  const theme = currentScript?.getAttribute('data-theme') || 'auto';
  const accentColor = currentScript?.getAttribute('data-accent-color') || 'indigo';

  const el = document.createElement('vibus-widget');
  el.setAttribute('project-id', projectId);
  el.setAttribute('server-url', serverUrl);
  el.setAttribute('api-token', apiToken);
  el.setAttribute('public-key', publicKey);
  el.setAttribute('mode', mode);
  el.setAttribute('theme', theme);
  el.setAttribute('accent-color', accentColor);

  if (document.body) {
    document.body.appendChild(el);
  } else {
    document.addEventListener('DOMContentLoaded', () => {
      if (!document.querySelector('vibus-widget, vibeus-widget')) {
        document.body.appendChild(el);
      }
    });
  }
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoMountWidget);
  } else {
    autoMountWidget();
  }
}
