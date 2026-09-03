import { Languages } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { SUPPORTED_UI_LOCALES, UI_LOCALE_LABELS, normalizeUiLocale } from '../i18n/config';

export function LanguageSwitcher({ compact = false }: { compact?: boolean }) {
  const { i18n, t } = useTranslation();
  const current = normalizeUiLocale(i18n.resolvedLanguage || i18n.language) || 'en';

  const changeLanguage = async (lng: 'en' | 'ru') => {
    if (lng === current) return;
    await i18n.changeLanguage(lng);
    // Several copy tables are intentionally created at module scope via tr().
    // Reloading keeps them deterministic and avoids stale mixed-language UI.
    window.location.reload();
  };

  return (
    <div className={`vibe-language-switcher ${compact ? 'is-compact' : ''}`} role="group" aria-label={t('v7.common.language_switcher')}>
      {!compact && <Languages size={14} aria-hidden="true" />}
      {SUPPORTED_UI_LOCALES.map((lng) => (
        <button
          type="button"
          key={lng}
          className={current === lng ? 'active' : ''}
          aria-pressed={current === lng}
          onClick={() => changeLanguage(lng)}
          title={UI_LOCALE_LABELS[lng]}
        >
          {lng.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
