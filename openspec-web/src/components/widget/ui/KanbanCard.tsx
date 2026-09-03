import React from 'react';
import { useTranslation } from 'react-i18next';
import {
  Archive, Edit3, Copy, Check, ArchiveRestore, Trash2, Server, Crosshair,
  AlertTriangle, CheckCircle2, ChevronUp, ChevronDown, Circle, GitBranch,
} from 'lucide-react';
import type { Ticket, NodeItem, BoardColumn } from '../types';

export interface KanbanCardProps {
  t: Ticket;
  parentNode?: NodeItem | undefined;
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
  canWrite: boolean;
  canReview: boolean;
}

function getInitials(name?: string | null): string {
  const value = String(name || '').trim();
  if (!value) return '—';
  const parts = value.split(/\s+/).filter(Boolean);
  return parts.slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || '—';
}

export const KanbanCard: React.FC<KanbanCardProps> = ({
  t,
  parentNode,
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
  canWrite,
  canReview,
}) => {
  const { t: t18n } = useTranslation();

  const isReview = t.status === 'review';
  const isDone = t.status === 'done';
  const isInProgress = t.status === 'in_progress';
  const isPriority = t.priority === 'high' || t.priority === 'critical';
  const hasRework = Boolean(t.rework_notes?.trim());
  const isBackendBug = t.bug_context?.type === 'backend';
  const isUiBug = t.bug_context?.type === 'ui' || (t.id.startsWith('BUG-') && !isBackendBug);
  const isDoDExpanded = Boolean(expandedTicketDoD[t.id]);
  const isArchived = Boolean(t.is_archived);

  const totalDoD = Object.keys(t.checklists || {}).length;
  const doneDoD = Object.values(t.checklists || {}).filter(Boolean).length;
  const dodPercent = totalDoD > 0 ? Math.round((doneDoD / totalDoD) * 100) : 0;
  const displayKey = t.key || t.id;
  const assigneeInitials = getInitials(t.assignee);

  return (
    <article
      onClick={() => { if (canWrite) setSelectedTicketForEdit(t); }}
      className={"spatial-card stagger-card flex flex-col justify-between group font-['Plus_Jakarta_Sans',sans-serif] " + (canWrite ? 'cursor-pointer ' : 'cursor-default ') + (
        isDone ? 'opacity-70 border-white/[0.04]' :
        isPriority ? 'border-rose-500/30' :
        isInProgress ? 'border-indigo-500/30' :
        isReview ? 'border-amber-500/30' :
        hasRework ? 'border-orange-500/30' :
        isArchived ? 'opacity-45 border-white/[0.04]' :
        'border-white/[0.06]'
      )}
    >
      <div>
        <div className="mb-2.5 flex items-start justify-between gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <span className="text-[10px] font-mono font-semibold text-slate-500">{displayKey}</span>
            {isPriority ? (
              <span className="tag-spatial bg-rose-500/10 text-rose-300 border-rose-500/20">{t18n('card.important')}</span>
            ) : isBackendBug ? (
              <span className="tag-spatial bg-sky-500/10 text-sky-300 border-sky-500/20">{t18n('card.backend')}</span>
            ) : isUiBug ? (
              <span className="tag-spatial bg-pink-500/10 text-pink-300 border-pink-500/20">{t18n('card.ui_bug')}</span>
            ) : parentNode ? (
              <span className="tag-spatial max-w-[130px] truncate bg-indigo-500/10 text-indigo-300 border-indigo-500/20">{parentNode.title}</span>
            ) : null}
            {isArchived && <span className="tag-spatial bg-amber-500/10 text-amber-300 border-amber-500/20">{t18n('card.in_archive')}</span>}
            {t.github_issue_url && (
              <a
                href={t.github_issue_url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="tag-spatial flex items-center gap-1 transition-colors"
                title={t18n('v7.kanban.github_issue')}
              >
                <GitBranch className="h-3 w-3" />
                <span>#{t.github_issue_number || 'gh'}</span>
              </a>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
            {canWrite && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setSelectedTicketForEdit(t); }}
                title={t18n('v7.kanban.edit')}
                className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-white/[0.06] hover:text-white"
              >
                <Edit3 className="h-3.5 w-3.5" />
              </button>
            )}
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); copyPromptForAI(t, parentNode?.title || ''); }}
              title={t18n('legacy.copy_prompt_for_ai')}
              className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-white/[0.06] hover:text-white"
            >
              {copiedId === t.id ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
            </button>
            {canWrite && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); handleToggleArchiveTicket(t.id); }}
                title={isArchived ? t18n('legacy.return_from_archive_to_board') : t18n('legacy.move_task_to_archive')}
                className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-white/[0.06] hover:text-white"
              >
                {isArchived ? <ArchiveRestore className="h-3.5 w-3.5" /> : <Archive className="h-3.5 w-3.5" />}
              </button>
            )}
            {canWrite && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setDeletingTicket(t); }}
                title={t18n('legacy.delete_task_with_confirmation')}
                className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-rose-500/10 hover:text-rose-400"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>

        <p className={"mb-3 text-sm font-semibold leading-relaxed " + (isDone ? 'text-slate-500 line-through' : 'text-slate-100')}>
          {t.title}
        </p>

        {isBackendBug && t.bug_context && (
          <div className="mb-2.5 space-y-0.5 rounded-lg border border-sky-500/15 bg-sky-500/[0.06] p-2 text-[10px] font-mono text-sky-200">
            <div className="flex items-center gap-1 font-sans font-semibold text-sky-300">
              <Server className="h-3 w-3" /> {t18n('legacy.server_endpoint')}:
            </div>
            <div className="truncate">{t.bug_context.apiEndpoint}</div>
          </div>
        )}

        {isUiBug && t.bug_context?.selector && (
          <div className="mb-2.5 space-y-0.5 rounded-lg border border-pink-500/15 bg-pink-500/[0.06] p-2 text-[10px] font-mono text-pink-200">
            <div className="flex items-center gap-1 font-sans font-semibold text-pink-300">
              <Crosshair className="h-3 w-3" /> {t18n('legacy.element_selector')}
            </div>
            <div className="truncate">{t.bug_context.selector}</div>
          </div>
        )}

        {hasRework && (
          <div className="mb-2.5 space-y-1 rounded-lg border border-amber-500/15 bg-amber-500/[0.06] p-2 text-[10px] text-amber-200">
            <div className="flex items-center gap-1 font-semibold text-amber-300">
              <AlertTriangle className="h-3 w-3" /> {t18n('legacy.revision_notes')}
            </div>
            <p className="line-clamp-2 italic">{t.rework_notes}</p>
          </div>
        )}

        {totalDoD > 0 && (
          <div className="mb-2 space-y-1">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setExpandedTicketDoD((previous) => ({ ...previous, [t.id]: !previous[t.id] }));
              }}
              className="flex w-full items-center justify-between rounded-lg border border-white/[0.06] px-2 py-1.5 text-[10px] text-slate-400 transition-colors hover:bg-white/[0.04]"
            >
              <div className="flex min-w-0 items-center gap-1.5">
                <CheckCircle2 className={`h-3.5 w-3.5 shrink-0 ${doneDoD === totalDoD ? 'text-emerald-400' : 'text-slate-500'}`} />
                <span className="truncate font-medium">{t18n('v7.ticket.dod.title')} · {doneDoD}/{totalDoD}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="h-1 w-12 overflow-hidden rounded-full bg-slate-800">
                  <div
                    className={`h-full transition-[width] duration-200 ${doneDoD === totalDoD ? 'bg-emerald-400' : 'bg-indigo-500'}`}
                    style={{ width: `${dodPercent}%` }}
                  />
                </div>
                {isDoDExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              </div>
            </button>

            {isDoDExpanded && (
              <div className="animate-fadeIn space-y-1.5 rounded-lg border border-white/[0.08] bg-slate-900/70 p-2.5" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between text-[10px] font-semibold text-slate-400">
                  <span>{t18n('card.dod_title')}</span>
                  {canWrite && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setAddingDoDTicketId(addingDoDTicketId === t.id ? null : t.id);
                        setNewDoDLabel('');
                      }}
                      className="font-semibold text-indigo-400 hover:text-indigo-300"
                    >
                      {t18n('card.add_dod')}
                    </button>
                  )}
                </div>

                {Object.entries(t.checklists || {}).map(([key, value]) => (
                  <div key={key} className="group/chk flex items-center justify-between">
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); if (canWrite) handleToggleChecklist(t.id, key); }}
                      disabled={!canWrite}
                      className={`flex min-w-0 flex-1 items-center gap-2 text-left ${canWrite ? 'cursor-pointer' : 'cursor-default'}`}
                    >
                      {value ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-400" /> : <Circle className="h-3.5 w-3.5 shrink-0 text-slate-500" />}
                      <span className={"truncate text-[11px] " + (value ? 'text-slate-400 line-through' : 'font-medium text-slate-200')}>{key}</span>
                    </button>
                    {canWrite && (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); handleDeleteDoDItem(t.id, key); }}
                        className="px-1 text-xs text-slate-500 opacity-0 transition-opacity hover:text-rose-400 group-hover/chk:opacity-100 group-focus-within/chk:opacity-100"
                      >
                        ×
                      </button>
                    )}
                  </div>
                ))}

                {canWrite && addingDoDTicketId === t.id && (
                  <form
                    onSubmit={(e) => { e.stopPropagation(); handleAddCustomDoD(e, t.id); }}
                    className="flex items-center gap-1.5 pt-1"
                  >
                    <input
                      type="text"
                      value={newDoDLabel}
                      onChange={(e) => setNewDoDLabel(e.target.value)}
                      placeholder={t18n('card.new_dod_placeholder')}
                      className="flex-1 rounded-md border border-white/[0.08] bg-white/[0.04] px-2 py-1 text-[11px] text-white outline-none focus:border-indigo-500"
                      autoFocus
                      required
                    />
                    <button type="submit" className="rounded-md bg-indigo-600 px-2 py-1 text-[11px] font-semibold text-white transition-colors hover:bg-indigo-500">+</button>
                  </form>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <footer className="mt-3 flex items-center justify-between border-t border-white/[0.06] pt-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <div
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-white/[0.08] bg-white/[0.05] text-[9px] font-bold text-slate-300"
            title={t.assignee || t18n('v7.kanban.assignee')}
            aria-label={t.assignee || t18n('v7.kanban.assignee')}
          >
            {assigneeInitials}
          </div>
          {t.assignee && <span className="max-w-[96px] truncate text-[10px] text-slate-500">{t.assignee}</span>}
        </div>

        {isReview && canReview ? (
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); handleAcceptTicket(t.id); }}
              className="flex items-center gap-1 rounded-md border border-emerald-500/25 bg-emerald-500/10 px-2.5 py-1 text-[10px] font-semibold text-emerald-300 transition-colors hover:bg-emerald-500/15"
            >
              <Check className="h-3 w-3" /> {t18n('legacy.accept')}
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setReworkTicketId(t.id);
                setReworkComment(t.rework_notes || '');
              }}
              className="rounded-md border border-amber-500/25 bg-amber-500/10 p-1 text-amber-300 transition-colors hover:bg-amber-500/15"
              title={t18n('legacy.revision_notes')}
            >
              <AlertTriangle className="h-3 w-3" />
            </button>
          </div>
        ) : canWrite ? (
          <select
            value={t.status}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => handleStatusChange(t.id, e.target.value)}
            className="rounded-md border border-white/[0.08] bg-slate-900 px-2 py-1 text-[10px] font-semibold text-slate-300 outline-none transition-colors"
            aria-label={t18n('v7.kanban.status')}
          >
            {activeColumns.map((column) => (
              <option key={column.id} value={column.id}>{getColumnLabel(column)}</option>
            ))}
          </select>
        ) : (
          <span className="rounded-md border border-white/[0.08] bg-white/[0.03] px-2 py-1 text-[10px] font-semibold text-slate-400">
            {getColumnLabel(activeColumns.find((column) => column.id === t.status) || { id: t.status, label: t.status, color: 'slate' })}
          </span>
        )}
      </footer>
    </article>
  );
};
