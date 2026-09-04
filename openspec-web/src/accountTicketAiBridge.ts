import { tr } from './i18n/config';

let lastSelectedRoute = '';

function boardTicketKeys(host: HTMLElement): Set<string> {
  return new Set(
    Array.from(host.querySelectorAll<HTMLElement>('article.spatial-card span.font-mono'))
      .map((node) => (node.textContent || '').trim())
      .filter(Boolean),
  );
}

function injectTicketAiButton() {
  const host = document.querySelector<HTMLElement>('.enterprise-board-host[data-project-slug]');
  if (!host) return;
  const slug = host.dataset.projectSlug || '';
  if (!slug) return;
  const knownKeys = boardTicketKeys(host);
  if (!knownKeys.size) return;

  for (const overlay of Array.from(host.querySelectorAll<HTMLElement>('div.fixed.inset-0'))) {
    if (!String(overlay.className).includes('z-[99999999]')) continue;
    if (overlay.querySelector('[data-ticket-ai-entry]')) continue;
    const panel = overlay.firstElementChild as HTMLElement | null;
    const header = panel?.firstElementChild as HTMLElement | null;
    if (!header) continue;
    const ticketKey = Array.from(header.querySelectorAll<HTMLElement>('span.font-mono'))
      .map((node) => (node.textContent || '').trim())
      .find((value) => knownKeys.has(value));
    if (!ticketKey) continue;

    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.ticketAiEntry = 'true';
    button.className = 'shrink-0 rounded-lg border border-indigo-500/30 bg-indigo-500/10 px-3 py-2 text-xs font-semibold text-indigo-300 transition-colors hover:bg-indigo-500/15 hover:text-indigo-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400';
    button.textContent = tr('v7.ticket.work_with_ai');
    button.title = tr('v7.ticket.work_with_ai');
    button.setAttribute('aria-label', tr('v7.ticket.work_with_ai'));
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      window.location.assign(`/app/ai/${encodeURIComponent(slug)}?ticket=${encodeURIComponent(ticketKey)}`);
    });

    const last = header.lastElementChild;
    if (last) header.insertBefore(button, last);
    else header.appendChild(button);
  }
}

function selectTicketFromQuery() {
  const match = window.location.pathname.match(/^\/app\/ai\/[^/]+\/?$/);
  if (!match) return;
  const ticket = new URLSearchParams(window.location.search).get('ticket')?.trim();
  if (!ticket) return;
  const routeKey = `${window.location.pathname}?ticket=${ticket}`;
  if (lastSelectedRoute === routeKey) return;

  for (const button of Array.from(document.querySelectorAll<HTMLButtonElement>('aside button'))) {
    const key = button.querySelector<HTMLElement>('span.font-mono')?.textContent?.trim();
    if (key === ticket) {
      lastSelectedRoute = routeKey;
      button.click();
      button.scrollIntoView({ block: 'nearest' });
      break;
    }
  }
}

function syncAccountAiEntry() {
  injectTicketAiButton();
  selectTicketFromQuery();
}

if (typeof document !== 'undefined') {
  const start = () => {
    syncAccountAiEntry();
    const observer = new MutationObserver(syncAccountAiEntry);
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('popstate', syncAccountAiEntry);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
}
