export type UiTheme = 'light' | 'dark';

export const UI_THEME_STORAGE_KEY = 'vibus_ui_theme';
export const LEGACY_BOARD_THEME_STORAGE_KEY = 'vibus_board_theme';
export const UI_THEME_EVENT = 'vibeus:ui-theme-change';

function isTheme(value: string | null): value is UiTheme {
  return value === 'light' || value === 'dark';
}

export function resolveInitialUiTheme(): UiTheme {
  if (typeof window === 'undefined') return 'dark';
  const saved = window.localStorage.getItem(UI_THEME_STORAGE_KEY);
  if (isTheme(saved)) return saved;
  const legacyBoardTheme = window.localStorage.getItem(LEGACY_BOARD_THEME_STORAGE_KEY);
  if (isTheme(legacyBoardTheme)) return legacyBoardTheme;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function persistUiTheme(theme: UiTheme) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(UI_THEME_STORAGE_KEY, theme);
  // Keep the pre-dashboard board preference compatible with existing releases.
  window.localStorage.setItem(LEGACY_BOARD_THEME_STORAGE_KEY, theme);
  document.documentElement.dataset.vibeusTheme = theme;
  window.dispatchEvent(new CustomEvent<UiTheme>(UI_THEME_EVENT, { detail: theme }));
}

export function subscribeUiTheme(listener: (theme: UiTheme) => void) {
  if (typeof window === 'undefined') return () => undefined;
  const onTheme = (event: Event) => {
    const next = (event as CustomEvent<UiTheme>).detail;
    if (next === 'light' || next === 'dark') listener(next);
  };
  const onStorage = (event: StorageEvent) => {
    if (event.key !== UI_THEME_STORAGE_KEY && event.key !== LEGACY_BOARD_THEME_STORAGE_KEY) return;
    if (isTheme(event.newValue)) listener(event.newValue);
  };
  window.addEventListener(UI_THEME_EVENT, onTheme);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(UI_THEME_EVENT, onTheme);
    window.removeEventListener('storage', onStorage);
  };
}
