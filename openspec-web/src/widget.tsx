import React from 'react';
import ReactDOM from 'react-dom/client';
import { I18nextProvider } from 'react-i18next';
import i18n from './i18n/config';
import { VibusWidgetUI } from './components/VibusWidgetUI';
import './index.css';
import './widget-responsive.css';
import './enterprise-board.css';
import './enterprise-board-ux.css';
import './enterprise-dialogs.css';

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
      'vibe-enterprise-shell',
      `vibe-theme-${theme}`,
    ].join(' ');
    this.container.dataset.theme = theme;
  }

  connectedCallback() {
    const project = this.getAttribute('project') || this.dataset.project || '';
    const serverUrl = this.getAttribute('server-url') || this.dataset.server || window.location.origin;
    const publicKey = this.getAttribute('public-key') || this.dataset.publicKey || '';
    const apiToken = this.getAttribute('api-token') || this.dataset.apiToken || '';
    const mode = (this.getAttribute('mode') || this.dataset.mode || 'public_feedback') as 'studio' | 'public_feedback' | 'client_preview';
    const themePreference = (this.getAttribute('theme') || this.dataset.theme || 'auto') as WidgetThemePreference;
    const accentColor = this.getAttribute('accent-color') || this.dataset.accentColor || 'indigo';

    if (!this.capabilityToken) {
      this.capabilityToken = consumeUrlCapability();
    }

    if (!this.shadow) {
      this.shadow = this.attachShadow({ mode: 'open' });
    }

    if (!this.container) {
      this.container = document.createElement('div');
      this.container.dataset.vibusRoot = 'true';
      this.shadow.appendChild(this.container);
    }

    if (!this.shadow.querySelector('link[data-vibus-style]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = new URL('/assets/widget.css', serverUrl).toString();
      link.dataset.vibusStyle = 'true';
      this.shadow.prepend(link);
    }

    this.themeMedia?.removeEventListener('change', this.themeListener as EventListener);
    this.themeMedia = null;
    this.themeListener = null;

    this.applyResolvedTheme(resolveTheme(themePreference));
    if (themePreference === 'auto' && window.matchMedia) {
      this.themeMedia = window.matchMedia('(prefers-color-scheme: dark)');
      this.themeListener = () => this.applyResolvedTheme(resolveTheme('auto'));
      this.themeMedia.addEventListener('change', this.themeListener);
    }

    if (!this.root) {
      this.root = ReactDOM.createRoot(this.container);
    }
    this.root.render(
      <I18nextProvider i18n={i18n}>
        <VibusWidgetUI
          projectId={project}
          serverUrl={serverUrl}
          apiToken={this.capabilityToken || apiToken}
          publicKey={publicKey}
          theme={themePreference}
          accentColor={accentColor}
          mode={mode}
        />
      </I18nextProvider>,
    );
  }

  disconnectedCallback() {
    this.themeMedia?.removeEventListener('change', this.themeListener as EventListener);
    this.themeMedia = null;
    this.themeListener = null;
  }
}

if (!customElements.get('vibus-widget')) {
  customElements.define('vibus-widget', VibusWidget);
}

export default VibusWidget;
