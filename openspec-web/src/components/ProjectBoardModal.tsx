import React from 'react';
import { X, KanbanSquare } from 'lucide-react';
import { VibusWidgetUI } from './VibusWidgetUI';
import { tr } from '../i18n/config';

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
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-2 sm:p-4 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="flex h-[95vh] w-full max-w-7xl flex-col rounded-3xl border border-white/10 bg-slate-950 shadow-2xl overflow-hidden">
        <header className="flex items-center justify-between border-b border-white/10 px-6 py-3 bg-slate-900/80">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
              <KanbanSquare className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-white">{project.name}</h3>
                <span className="rounded-full bg-slate-800 px-2 py-0.5 text-xs font-mono text-slate-400">
                  {project.slug}
                </span>
              </div>
              <p className="text-[11px] text-slate-400">
                {tr('v7.project_board.subtitle')}
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="rounded-xl border border-white/10 p-2 text-slate-400 hover:bg-white/5 hover:text-white transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex-1 relative overflow-hidden bg-slate-950">
          <VibusWidgetUI
            projectId={project.slug}
            publicKey={project.public_widget_key || ''}
            serverUrl={serverUrl}
            mode="studio"
            theme="dark"
            accentColor="indigo"
          />
        </div>
      </div>
    </div>
  );
};
