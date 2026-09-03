/**
 * Lightweight anonymous telemetry helper for Vibus.
 * Zero-PII: Does not track IP, passwords, personal data, or content.
 * Only logs feature interaction counts to help prioritize product roadmap.
 */

export interface TelemetryEvent {
  event: string;
  projectId?: string;
  properties?: Record<string, any>;
  timestamp?: string;
}

export const trackEvent = (eventName: string, properties: Record<string, any> = {}) => {
  try {
    const payload: TelemetryEvent = {
      event: eventName,
      properties: {
        ...properties,
        viewport: typeof window !== 'undefined' ? `${window.innerWidth}x${window.innerHeight}` : 'unknown',
        isMobile: typeof window !== 'undefined' ? window.innerWidth < 768 : false,
      },
      timestamp: new Date().toISOString()
    };

    // Dispatch custom event for embedders or parent apps
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('vibus:telemetry', { detail: payload }));
    }

    // In development, log telemetry events
    if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.DEV) {
      console.debug('[Vibus Telemetry]', payload);
    }
  } catch (err) {
    // Silently ignore telemetry errors to never disrupt UI
  }
};
