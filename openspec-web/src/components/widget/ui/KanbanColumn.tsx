import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Search } from 'lucide-react';
import type { Ticket, BoardColumn, BoardData } from '../types';
import { KanbanCard } from './KanbanCard';

export interface KanbanColumnProps {
  col: BoardColumn;
  colTickets: Ticket[];
  showArchivedDone: boolean;
  boardData: BoardData;
  activeColumns: BoardColumn[];
  expandedTicketDoD: Record<string, boolean>;
  setExpandedTicketDoD: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  copiedId: string | null;
  addingDoDTicketId: string | null;
  setAddingDoDTicketId: (id: string | null) => void;
  newDoDLabel: string;
  setNewDoDLabel: (val: string) => void;
  setSelectedTicketForEdit: (t: Ticket) => void;
  copyPromptForAI: (t: Ticket, nodeTitle: string) => void;
  handleToggleArchiveTicket: (id: string) => void;
  setDeletingTicket: (t: Ticket) => void;
  handleToggleChecklist: (ticketId: string, key: string) => void;
  handleDeleteDoDItem: (ticketId: string, key: string) => void;
  handleAddCustomDoD: (e: React.FormEvent, ticketId: string) => void;
  handleAcceptTicket: (id: string) => void;
  setReworkTicketId: (id: string) => void;
  setReworkComment: (comment: string) => void;
  handleStatusChange: (id: string, newStatus: string) => void;
  getColumnLabel: (col: BoardColumn) => string;
  handleArchiveDoneTickets: () => void;
  canWrite: boolean;
  canReview: boolean;
  handleAddTicket?: (e?: React.FormEvent, customTitle?: string, customPriority?: any, colId?: string) => void;
  isFiltering?: boolean;
}

export const KanbanColumn: React.FC<KanbanColumnProps> = ({
  col,
  colTickets,
  boardData,
  activeColumns,
  expandedTicketDoD,
  setExpandedTicketDoD,
  copiedId,
  addingDoDTicketId,
  setAddingDoDTicketId,
  newDoDLabel,
  setNewDoDLabel,
  setSelectedTicketForEdit,
  copyPromptForAI,
  handleToggleArchiveTicket,
  setDeletingTicket,
  handleToggleChecklist,
  handleDeleteDoDItem,
  handleAddCustomDoD,
  handleAcceptTicket,
  setReworkTicketId,
  setReworkComment,
  handleStatusChange,
  getColumnLabel,
  handleArchiveDoneTickets,
  canWrite,
  canReview,
  handleAddTicket,
  isFiltering = false,
}) => {
  const { t: t18n } = useTranslation();
  const isDoneCol = col.id === 'done';
  const canCreateInColumn = canWrite && !isDoneCol;

  const [isCreatingTicket, setIsCreatingTicket] = useState(false);
  const [inlineTicketTitle, setInlineTicketTitle] = useState('');
  const [inlinePriority, setInlinePriority] = useState<'high' | 'medium' | 'low'>('medium');

  const resetCreate = () => {
    setInlineTicketTitle('');
    setIsCreatingTicket(false);
  };

  const handleInlineSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inlineTicketTitle.trim()) return;
    handleAddTicket?.(e, inlineTicketTitle.trim(), inlinePriority, col.id);
    resetCreate();
  };

  const handleOpenDetailedCreate = () => {
    const targetNode = boardData.nodes?.[0] || { id: 'general', title: t18n('v7.kanban.general_tasks') };
    const draftTicket: Ticket = {
      id: `TKT-${Math.floor(100 + Math.random() * 900)}`,
      key: `TKT-${(boardData.nodes?.reduce((acc, node) => acc + (node.tickets?.length || 0), 0) || 0) + 1}`,
      node_id: targetNode.id,
      title: inlineTicketTitle.trim() || t18n('v7.kanban.new_task'),
      summary: '',
      status: col.id || 'backlog',
      priority: inlinePriority || 'medium',
      order: 0,
      checklists: {
        [t18n('v7.kanban.spec_described')]: true,
        [t18n('v7.kanban.backend_ready')]: false,
        [t18n('v7.kanban.frontend_ready')]: false,
        [t18n('v7.kanban.autotests')]: false,
      },
      rework_notes: '',
    };
    handleAddTicket?.(undefined, draftTicket.title, draftTicket.priority, draftTicket.status);
    setSelectedTicketForEdit(draftTicket);
    resetCreate();
  };

  const statusDotClass = col.id === 'in_progress'
    ? 'bg-indigo-400'
    : col.id === 'review'
      ? 'bg-amber-400'
      : col.id === 'done'
        ? 'bg-emerald-400'
        : 'bg-slate-400';

  return (
    <section
      data-board-column={col.id}
      aria-label={`${getColumnLabel(col)} · ${colTickets.length}`}
      className={`enterprise-kanban-column w-80 flex flex-col h-full shrink-0 font-['Plus_Jakarta_Sans',sans-serif] ${isDoneCol ? 'opacity-90' : ''}`}
    >
      <header className="enterprise-column-header flex items-center justify-between border-b border-white/[0.06] pb-2.5 mb-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${statusDotClass}`} aria-hidden="true" />
          <h3 className="truncate text-xs font-bold text-slate-200">{getColumnLabel(col)}</h3>
        </div>

        <div className="flex items-center gap-1.5">
          {canCreateInColumn && (
            <button
              type="button"
              onClick={() => setIsCreatingTicket((value) => !value)}
              title={t18n('column.create_task_title')}
              aria-label={t18n('column.create_task_title')}
              className="flex h-6 w-6 items-center justify-center rounded-md border border-white/[0.08] bg-white/[0.04] text-slate-400 transition-colors hover:bg-white/[0.08] hover:text-white"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          )}

          {isDoneCol && canWrite && colTickets.length > 3 && (
            <button
              type="button"
              onClick={handleArchiveDoneTickets}
              title={t18n('column.archive_all_done')}
              className="rounded-md border border-white/[0.08] bg-white/[0.03] px-2 py-1 text-[10px] font-semibold text-slate-400 transition-colors hover:bg-white/[0.07] hover:text-white"
            >
              {t18n('column.to_archive')}
            </button>
          )}

          <span className="min-w-6 rounded-md border border-white/[0.06] bg-white/[0.04] px-1.5 py-0.5 text-center text-[10px] font-semibold text-slate-400">
            {colTickets.length}
          </span>
        </div>
      </header>

      <div className="enterprise-column-scroll flex-1 space-y-2.5 overflow-y-auto pr-1">
        {canCreateInColumn && isCreatingTicket && (
          <form onSubmit={handleInlineSubmit} className="spatial-card enterprise-quick-create space-y-2.5 border-indigo-500/30 p-3 animate-fadeIn">
            <input
              type="text"
              value={inlineTicketTitle}
              onChange={(e) => setInlineTicketTitle(e.target.value)}
              placeholder={t18n('column.quick_placeholder')}
              className="w-full rounded-lg border border-white/[0.08] bg-slate-950 p-2.5 text-xs font-medium text-white outline-none placeholder:text-slate-500 focus:border-indigo-500"
              autoFocus
              required
            />
            <div className="flex items-center justify-between gap-2 pt-0.5">
              <div className="flex min-w-0 items-center gap-2">
                <select
                  value={inlinePriority}
                  onChange={(e) => setInlinePriority(e.target.value as 'high' | 'medium' | 'low')}
                  className="min-w-0 rounded-md border border-white/[0.08] bg-slate-950 px-2 py-1 text-[10px] text-slate-300 outline-none"
                >
                  <option value="low">{t18n('bug.priority_low')}</option>
                  <option value="medium">{t18n('bug.priority_medium')}</option>
                  <option value="high">{t18n('bug.priority_high')}</option>
                </select>
                <button
                  type="button"
                  onClick={handleOpenDetailedCreate}
                  title={t18n('v7.kanban.full_card_title')}
                  className="truncate text-[10px] font-semibold text-indigo-400 hover:text-indigo-300"
                >
                  {t18n('v7.kanban.full_form')}
                </button>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={resetCreate}
                  className="rounded-md px-2 py-1 text-[10px] font-semibold text-slate-400 hover:bg-white/[0.04] hover:text-white"
                >
                  {t18n('v7.kanban.cancel')}
                </button>
                <button
                  type="submit"
                  className="rounded-md bg-indigo-600 px-2.5 py-1 text-[10px] font-semibold text-white transition-colors hover:bg-indigo-500"
                >
                  {t18n('v7.kanban.create')}
                </button>
              </div>
            </div>
          </form>
        )}

        {colTickets.length === 0 && !isCreatingTicket ? (
          isFiltering ? (
            <div className="enterprise-filter-empty flex min-h-[92px] w-full flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-white/[0.08] p-4 text-center text-xs text-slate-500">
              <Search className="h-4 w-4" />
              <span className="font-medium">{t18n('v7.kanban.no_matches')}</span>
            </div>
          ) : canCreateInColumn ? (
            <button
              type="button"
              onClick={() => setIsCreatingTicket(true)}
              className="flex min-h-[92px] w-full flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-white/[0.1] p-4 text-xs text-slate-500 transition-colors hover:border-indigo-500/30 hover:bg-indigo-500/[0.03] hover:text-indigo-400"
            >
              <Plus className="h-4 w-4" />
              <span className="font-medium">{t18n('v7.kanban.create_ticket')}</span>
            </button>
          ) : (
            <div className="flex h-24 items-center justify-center rounded-xl border border-dashed border-white/[0.08] text-xs font-medium text-slate-500">
              {t18n('legacy.empty')}
            </div>
          )
        ) : (
          colTickets.map((ticket) => {
            const parentNode = boardData.nodes?.find((node) => node.tickets?.some((item) => item.id === ticket.id));
            return (
              <KanbanCard
                key={ticket.id}
                t={ticket}
                parentNode={parentNode}
                activeColumns={activeColumns}
                expandedTicketDoD={expandedTicketDoD}
                setExpandedTicketDoD={setExpandedTicketDoD}
                copiedId={copiedId}
                addingDoDTicketId={addingDoDTicketId}
                setAddingDoDTicketId={setAddingDoDTicketId}
                newDoDLabel={newDoDLabel}
                setNewDoDLabel={setNewDoDLabel}
                setSelectedTicketForEdit={setSelectedTicketForEdit}
                copyPromptForAI={copyPromptForAI}
                handleToggleArchiveTicket={handleToggleArchiveTicket}
                setDeletingTicket={setDeletingTicket}
                handleToggleChecklist={handleToggleChecklist}
                handleDeleteDoDItem={handleDeleteDoDItem}
                handleAddCustomDoD={handleAddCustomDoD}
                handleAcceptTicket={handleAcceptTicket}
                setReworkTicketId={setReworkTicketId}
                setReworkComment={setReworkComment}
                handleStatusChange={handleStatusChange}
                getColumnLabel={getColumnLabel}
                canWrite={canWrite}
                canReview={canReview}
              />
            );
          })
        )}

        {canCreateInColumn && colTickets.length > 0 && !isCreatingTicket && (
          <button
            type="button"
            onClick={() => setIsCreatingTicket(true)}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-transparent py-2 text-[11px] font-medium text-slate-500 transition-colors hover:border-white/[0.08] hover:bg-white/[0.03] hover:text-slate-300"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>{t18n('v7.kanban.create_ticket')}</span>
          </button>
        )}
      </div>
    </section>
  );
};
