import i18n, { type TOptions } from 'i18next';
import { initReactI18next } from 'react-i18next';

import en from './locales/en.json';
import ru from './locales/ru.json';
import { v8En, v8Ru } from './v8';
import { editorialEn, editorialRu } from './editorial';

export const SUPPORTED_UI_LOCALES = ['en', 'ru'] as const;
export type SupportedUiLocale = (typeof SUPPORTED_UI_LOCALES)[number];

export const UI_LOCALE_LABELS: Record<SupportedUiLocale, string> = {
  en: 'English',
  ru: 'Русский',
};

function mergeDeep<T extends Record<string, any>>(base: T, override: Record<string, any>): T {
  const result: Record<string, any> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      result[key] &&
      typeof result[key] === 'object' &&
      !Array.isArray(result[key])
    ) {
      result[key] = mergeDeep(result[key], value as Record<string, any>);
    } else {
      result[key] = value;
    }
  }
  return result as T;
}

const enTranslation = mergeDeep(
  {
    ...en,
    public_feedback: v8En.public_feedback,
    feedback: { ...((en as any).feedback || {}), ...v8En.feedback },
  },
  editorialEn,
);

const ruTranslation = mergeDeep(
  {
    ...ru,
    public_feedback: v8Ru.public_feedback,
    feedback: { ...((ru as any).feedback || {}), ...v8Ru.feedback },
  },
  editorialRu,
);

const resources = {
  en: { translation: enTranslation },
  ru: { translation: ruTranslation },
};

export function normalizeUiLocale(value?: string | null): SupportedUiLocale | null {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === 'ru' || normalized.startsWith('ru-')) return 'ru';
  if (normalized === 'en' || normalized.startsWith('en-')) return 'en';
  return null;
}

export function getSavedOrDetectedLanguage(): SupportedUiLocale {
  if (typeof window !== 'undefined') {
    const saved = normalizeUiLocale(localStorage.getItem('vibus_lang'));
    if (saved) return saved;

    const nav = String(window.navigator?.language || '').toLowerCase();
    if (nav.startsWith('ru')) return 'ru';
  }
  return 'en';
}

i18n
  .use(initReactI18next)
  .init({
    resources,
    lng: getSavedOrDetectedLanguage(),
    fallbackLng: 'en',
    supportedLngs: [...SUPPORTED_UI_LOCALES],
    nonExplicitSupportedLngs: true,
    returnEmptyString: false,
    interpolation: {
      escapeValue: false,
    },
  });

function syncDocumentLanguage(lng: string) {
  if (typeof document !== 'undefined') {
    document.documentElement.lang = normalizeUiLocale(lng) || 'en';
  }
}

syncDocumentLanguage(i18n.language);

i18n.on('languageChanged', (lng) => {
  const normalized = normalizeUiLocale(lng) || 'en';
  if (typeof window !== 'undefined') {
    localStorage.setItem('vibus_lang', normalized);
  }
  syncDocumentLanguage(normalized);
});

export function tr(key: string, options?: TOptions): string {
  return String(options ? i18n.t(key, options) : i18n.t(key));
}

export default i18n;
