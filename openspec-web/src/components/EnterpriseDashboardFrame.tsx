import { type ReactNode, useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import { tr } from '../i18n/config';
import { persistUiTheme, resolveInitialUiTheme, subscribeUiTheme, type UiTheme } from '../utils/uiTheme';

export function EnterpriseDashboardFrame({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<UiTheme>(resolveInitialUiTheme);

  useEffect(() => subscribeUiTheme((next) => setTheme(next)), []);

  useEffect(() => {
    persistUiTheme(theme);
  }, [theme]);

  const nextTheme = theme === 'dark' ? 'light' : 'dark';
  const label = theme === 'dark'
    ? tr('v7.project_board.switch_to_light')
    : tr('v7.project_board.switch_to_dark');

  return (
    <div
      className={`enterprise-dashboard-shell vibe-enterprise-shell vibe-theme-${theme}`}
      data-dashboard-theme={theme}
    >
      <div className="enterprise-dashboard-content">{children}</div>
      <button
        type="button"
        onClick={() => setTheme(nextTheme)}
        className="enterprise-dashboard-theme-toggle"
        aria-label={label}
        title={label}
        data-dashboard-theme-toggle
      >
        {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
      </button>
    </div>
  );
}
