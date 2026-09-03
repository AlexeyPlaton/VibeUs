import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus } from 'lucide-react';
import type { Ticket, NodeItem, BoardColumn, BoardData } from '../types';
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
}

export const KanbanColumn: React.FC<KanbanColumnProps> = ({
  col,
  colTickets,
  showArchivedDone,
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
  handleAddTicket
}) => {
  const { t: t18n } = useTranslation();
  const isDoneCol = col.id === 'done';
  const isInProgressCol = col.id === 'in_progress';
  const isBacklogCol = col.id === 'backlog';

  const [isCreatingTicket, setIsCreatingTicket] = useState(false);
  const [inlineTicketTitle, setInlineTicketTitle] = useState('');
  const [inlinePriority, setInlinePriority] = useState<'high' | 'medium' | 'low'>('medium');

  const handleInlineSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inlineTicketTitle.trim()) return;
    if (handleAddTicket) {
      handleAddTicket(e, inlineTicketTitle.trim(), inlinePriority, col.id);
    }
    setInlineTicketTitle('');
    setIsCreatingTicket(false);
  };

  const handleOpenDetailedCreate = () => {
    const targetNode = boardData.nodes?.[0] || { id: 'general', title: t18n('v7.kanban.general_tasks') };
    const draftTicket: Ticket = {
      id: `TKT-${Math.floor(100 + Math.random() * 900)}`,
      key: `TKT-${(boardData.nodes?.reduce((acc, n) => acc + (n.tickets?.length || 0), 0) || 0) + 1}`,
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
      rework_notes: ''
    };
    if (handleAddTicket) {
      handleAddTicket(undefined, draftTicket.title, draftTicket.priority, draftTicket.status);
    }
    setSelectedTicketForEdit(draftTicket);
    setIsCreatingTicket(false);
    setInlineTicketTitle('');
  };

  return (
    <div className={`w-80 flex flex-col h-full shrink-0 font-['Plus_Jakarta_Sans',sans-serif] ${isDoneCol ? 'opacity-75 hover:opacity-100 transition-opacity' : ''}`}>
      {/* Column Header */}
      <div className={`flex justify-between items-center mb-3 pb-2.5 border-b ${isInProgressCol ? 'border-indigo-500/30' : 'border-white/[0.06]'}`}>
        <div className="flex items-center gap-2">
          {isInProgressCol && (
            <span className="w-2 h-2 rounded-full bg-indigo-400 shadow-[0_0_8px_#818cf8]" />
          )}
          {col.id === 'backlog' && (
            <span className="w-2 h-2 rounded-full bg-slate-400" />
          )}
          {col.id === 'review' && (
            <span className="w-2 h-2 rounded-full bg-amber-400 shadow-[0_0_8px_#fbbf24]" />
          )}
          {col.id === 'done' && (
            <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_8px_#34d399]" />
          )}
          <h3 className="text-xs font-bold text-slate-200 tracking-normal">
            {getColumnLabel(col)}
          </h3>
        </div>

        <div className="flex items-center gap-1.5">
          {isBacklogCol && canWrite && (
            <button
              type="button"
              onClick={() => setIsCreatingTicket(!isCreatingTicket)}
              title={t18n('column.create_task_title')}
              className="w-6 h-6 rounded-lg bg-white/[0.06] hover:bg-indigo-600 hover:text-white border border-white/[0.08] flex items-center justify-center text-slate-300 transition-all cursor-pointer shadow-xs"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          )}

          {isDoneCol && canWrite && colTickets.length > 3 && (
            <button
              type="button"
              onClick={handleArchiveDoneTickets}
              title={t18n('column.archive_all_done')}
              className="text-[10px] font-semibold text-slate-400 hover:text-white bg-white/[0.05] hover:bg-white/[0.1] px-2 py-0.5 rounded-lg border border-white/[0.08] cursor-pointer transition-colors"
            >
              {t18n('column.to_archive')}
            </button>
          )}

          <span className="bg-white/[0.06] text-slate-300 border border-white/[0.08] px-2 py-0.5 rounded-lg text-xs font-semibold">
            {colTickets.length}
          </span>
        </div>
      </div>

      {/* Column Tickets */}
      <div className="flex-1 overflow-y-auto space-y-3 pr-1">
        {/* Inline Creation Form */}
        {canWrite && isCreatingTicket && (
          <form onSubmit={handleInlineSubmit} className="spatial-card border-indigo-500/50 bg-indigo-500/[0.06] p-3 space-y-2.5 animate-fadeIn shadow-lg rounded-2xl">
            <input
              type="text"
              value={inlineTicketTitle}
              onChange={(e) => setInlineTicketTitle(e.target.value)}
              placeholder={t18n('column.quick_placeholder')}
              className="w-full bg-slate-950 border border-slate-700/60 rounded-xl p-2.5 text-xs text-white placeholder:text-slate-500 outline-none focus:border-indigo-500 font-medium"
              autoFocus
              required
            />
            <div className="flex items-center justify-between pt-1">
              <div className="flex items-center gap-2">
                <select
                  value={inlinePriority}
                  onChange={(e) => setInlinePriority(e.target.value as any)}
                  style={{ backgroundColor: '#0f172a', color: '#f8fafc' }}
                  className="bg-slate-950 border border-slate-700/60 rounded-lg px-2 py-1 text-[11px] text-slate-300 outline-none cursor-pointer"
                >
                  <option value="low" style={{ backgroundColor: '#0f172a', color: '#f8fafc' }}>🟢 Low</option>
                  <option value="medium" style={{ backgroundColor: '#0f172a', color: '#f8fafc' }}>🟡 Medium</option>
                  <option value="high" style={{ backgroundColor: '#0f172a', color: '#f8fafc' }}>🔴 High</option>
                </select>
                <button
                  type="button"
                  onClick={handleOpenDetailedCreate}
                  title={t18n('v7.kanban.full_card_title')}
                  className="text-[11px] text-indigo-400 hover:text-indigo-300 font-semibold cursor-pointer underline decoration-indigo-500/40"
                >
                  ↗ {t18n('v7.kanban.full_form')}
                </button>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => { setIsCreatingTicket(false); setInlineTicketTitle(''); }}
                  className="px-2.5 py-1 text-slate-400 hover:text-white text-xs font-semibold rounded-lg cursor-pointer"
                >
                  {t18n('v7.kanban.cancel')}
                </button>
                <button
                  type="submit"
                  className="px-3 py-1 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded-lg cursor-pointer transition-colors shadow-sm shadow-indigo-600/30"
                >
                  {t18n('v7.kanban.create')}
                </button>
              </div>
            </div>
          </form>
        )}

        {colTickets.length === 0 && !isCreatingTicket ? (
          isBacklogCol && canWrite ? (
            <button
              type="button"
              onClick={() => setIsCreatingTicket(true)}
              className="w-full min-h-[110px] border-2 border-dashed border-white/[0.1] hover:border-indigo-500/50 hover:bg-indigo-500/[0.04] rounded-2xl flex flex-col items-center justify-center gap-2 text-xs text-slate-400 hover:text-indigo-300 transition-all cursor-pointer group p-4"
            >
              <div className="w-8 h-8 rounded-xl bg-white/[0.05] group-hover:bg-indigo-500/20 flex items-center justify-center text-slate-400 group-hover:text-indigo-400 transition-colors">
                <Plus className="w-4 h-4" />
              </div>
              <span className="font-semibold text-center">+ {t18n('v7.kanban.create_backlog')}</span>
            </button>
          ) : (
            <div className="h-28 flex items-center justify-center border border-dashed border-white/[0.08] rounded-2xl text-xs text-slate-500 font-medium">
              {t18n("legacy.empty")}
            </div>
          )
        ) : (
          colTickets.map(t => {
            const parentNode = boardData.nodes?.find(n => n.tickets?.some(x => x.id === t.id));
            
            return (
              <KanbanCard
                key={t.id}
                t={t}
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

        {isBacklogCol && canWrite && colTickets.length > 0 && !isCreatingTicket && (
          <button
            type="button"
            onClick={() => setIsCreatingTicket(true)}
            className="w-full py-2.5 border border-dashed border-white/[0.08] hover:border-indigo-500/40 hover:bg-indigo-500/[0.03] rounded-xl flex items-center justify-center gap-1.5 text-xs text-slate-400 hover:text-indigo-300 transition-all cursor-pointer font-semibold"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>{t18n('v7.kanban.create_ticket')}</span>
          </button>
        )}
      </div>
    </div>
  );
};
