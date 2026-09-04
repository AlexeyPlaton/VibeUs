import React, { useEffect, useState } from 'react';
import { X, KanbanSquare, List, Moon, Sun } from 'lucide-react';
import { VibusWidgetUI } from './VibusWidgetUI';
import { tr } from '../i18n/config';

type BoardTheme = 'light' | 'dark';
type BoardDensity = 'comfortable' | 'compact';

const BOARD_THEME_STORAGE_KEY = 'vibus_board_theme';
const BOARD_DENSITY_STORAGE_KEY = 'vibus_board_density';

function resolveInitialTheme(): BoardTheme {
  if (typeof window === 'undefined') return 'dark';
  const saved = window.localStorage.getItem(BOARD_THEME_STORAGE_KEY);
  if (saved === 'light' || saved === 'dark') return saved;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function resolveInitialDensity(): BoardDensity {
  if (typeof window === 'undefined') return 'comfortable';
  return window.localStorage.getItem(BOARD_DENSITY_STORAGE_KEY) === 'compact' ? 'compact' : 'comfortable';
}

interface ProjectBoardModalProps {
  project: {
    id: string;
    name: string;
    slug: string;
    public_widget_key?: string | null;
  };
  serverUrl: string;
  isOpen: boolean;
  onClose: () => void;
}

export const ProjectBoardModal: React.FC<ProjectBoardModalProps> = ({
  project,
  serverUrl,
  isOpen,
  onClose,
}) => {
  const [appearance, setAppearance] = useState<BoardTheme>(resolveInitialTheme);
  const [density, setDensity] = useState<BoardDensity>(resolveInitialDensity);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(BOARD_THEME_STORAGE_KEY, appearance);
    }
  }, [appearance]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(BOARD_DENSITY_STORAGE_KEY, density);
    }
  }, [density]);

  if (!isOpen) return null;

  const toggleAppearance = () => setAppearance((current) => current === 'dark' ? 'light' : 'dark');
  const toggleDensity = () => setDensity((current) => current === 'comfortable' ? 'compact' : 'comfortable');
  const themeButtonLabel = appearance === 'dark'
    ? tr('v7.project_board.switch_to_light')
    : tr('v7.project_board.switch_to_dark');
  const densityButtonLabel = density === 'comfortable'
    ? tr('v7.project_board.switch_to_compact')
    : tr('v7.project_board.switch_to_comfortable');

  return (
    <div className={`enterprise-board-host vibe-enterprise-shell vibe-theme-${appearance} vibe-density-${density} fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-0 sm:p-3 backdrop-blur-[2px] animate-in fade-in duration-150`}>
      <div className="enterprise-board-modal flex flex-col">
        <header className="enterprise-board-modal-header flex items-center justify-between px-4 sm:px-5">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[var(--vb-border)] bg-[var(--vb-accent-soft)] text-[var(--vb-accent)]">
              <KanbanSquare className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-2">
                <h3 className="truncate text-sm font-semibold text-[var(--vb-text)]">{project.name}</h3>
                <span className="enterprise-project-chip hidden max-w-[220px] truncate rounded-md px-2 py-0.5 text-[10px] font-mono sm:inline">
                  {project.slug}
                </span>
              </div>
              <p className="mt-0.5 text-[11px] text-[var(--vb-muted)]">
                {tr('v7.project_board.subtitle')}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={toggleDensity}
              className="enterprise-icon-button"
              title={densityButtonLabel}
              aria-label={densityButtonLabel}
              data-board-density={density}
            >
              <List className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={toggleAppearance}
              className="enterprise-icon-button"
              title={themeButtonLabel}
              aria-label={themeButtonLabel}
            >
              {appearance === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="enterprise-icon-button"
              title={tr('v7.project_board.close')}
              aria-label={tr('v7.project_board.close')}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </header>

        <div className="enterprise-board-stage flex-1 overflow-hidden">
          <VibusWidgetUI
            projectId={project.slug}
            publicKey={project.public_widget_key || ''}
            serverUrl={serverUrl}
            mode="studio"
            theme={appearance}
            accentColor="indigo"
          />
        </div>
      </div>
    </div>
  );
};
