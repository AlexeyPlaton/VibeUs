import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Archive, Edit3, Copy, Check, ArchiveRestore, Trash2, Server, Crosshair, AtSign, AlertTriangle, CheckCircle2, ChevronUp, ChevronDown, Circle, GitBranch } from 'lucide-react';
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
  canReview
}) => {
  const { t: t18n } = useTranslation();

  const isReview = t.status === 'review';
  const isDone = t.status === 'done';
  const isInProgress = t.status === 'in_progress';
  const isPriority = t.priority === 'high' || t.priority === 'critical';
  const hasRework = t.rework_notes && t.rework_notes.trim().length > 0;
  const isBackendBug = t.bug_context?.type === 'backend';
  const isUiBug = t.bug_context?.type === 'ui' || (t.id.startsWith('BUG-') && !isBackendBug);
  const isDoDExpanded = !!expandedTicketDoD[t.id];
  const isArchived = !!t.is_archived;
  
  const totalDoD = Object.keys(t.checklists || {}).length;
  const doneDoD = Object.values(t.checklists || {}).filter(Boolean).length;
  const dodPercent = totalDoD > 0 ? Math.round((doneDoD / totalDoD) * 100) : 0;

  const displayKey = t.key || t.id;

  // Stable role-based persona avatar (consistent per role / assignee throughout session)
  const personaSeed = useMemo(() => {
    if (t.assignee && t.assignee.trim()) {
      return `vibeus_user_${t.assignee.toLowerCase().trim()}`;
    }
    const cat = t.bug_context?.type;
    if (cat === 'ui') return 'vibeus_designer_maria';
    if (cat === 'backend') return 'vibeus_developer_chris';
    if (cat === 'logic') return 'vibeus_analyst_felix';
    if (t.id.startsWith('IDEA-')) return 'vibeus_po_alex';
    if (t.id.startsWith('DISC-')) return 'vibeus_qa_sarah';
    return 'vibeus_developer_chris';
  }, [t.assignee, t.bug_context?.type, t.id]);

  return (
    <div 
      onClick={() => { if (canWrite) setSelectedTicketForEdit(t); }}
      className={"spatial-card stagger-card flex flex-col justify-between group font-['Plus_Jakarta_Sans',sans-serif] " + (canWrite ? 'cursor-pointer ' : 'cursor-default ') + (
        isDone ? 'opacity-70 border-white/[0.04]' :
        isPriority ? 'border-rose-500/30 bg-rose-500/[0.03] shadow-sm' :
        isInProgress ? 'border-indigo-500/30 bg-indigo-500/[0.03] shadow-sm' :
        isReview ? 'border-amber-500/30 bg-amber-500/[0.03]' :
        hasRework ? 'border-orange-500/30 bg-orange-500/[0.03]' :
        isArchived ? 'opacity-40 border-white/[0.04]' :
        'border-white/[0.06]'
      )}
    >
      <div>
        {/* Top Tag Row & Actions */}
        <div className="flex items-center justify-between gap-2 mb-2.5">
          <div className="flex items-center gap-1.5 flex-wrap">
            {isPriority ? (
              <span className="tag-spatial bg-rose-500/15 text-rose-300 border-rose-500/25">
                {t18n('card.important')}
              </span>
            ) : isBackendBug ? (
              <span className="tag-spatial bg-sky-500/15 text-sky-300 border-sky-500/25">
                {t18n('card.backend')}
              </span>
            ) : isUiBug ? (
              <span className="tag-spatial bg-pink-500/15 text-pink-300 border-pink-500/25">
                {t18n('card.ui_bug')}
              </span>
            ) : parentNode ? (
              <span className="tag-spatial truncate max-w-[130px] bg-indigo-500/10 text-indigo-300 border-indigo-500/20">
                {parentNode.title}
              </span>
            ) : (
              <span className="tag-spatial">{isDone ? t18n('card.done') : t18n('card.task')}</span>
            )}
            {isArchived && (
              <span className="tag-spatial bg-amber-500/10 text-amber-300 border-amber-500/20">{t18n('card.in_archive')}</span>
            )}
            {t.github_issue_url && (
              <a
                href={t.github_issue_url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="tag-spatial bg-slate-800 text-slate-300 border-slate-700 hover:text-white hover:border-slate-500 transition-colors flex items-center gap-1"
                title={t18n('v7.kanban.github_issue')}
              >
                <GitBranch className="w-3 h-3 text-indigo-400" />
                <span>#{t.github_issue_number || 'gh'}</span>
              </a>
            )}
          </div>

          {/* Quick Action Icons */}
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
{canWrite && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setSelectedTicketForEdit(t);
              }}
              title={t18n('v7.kanban.edit')}
              className="p-1 hover:bg-white/10 rounded-lg text-slate-400 hover:text-white cursor-pointer transition-colors"
            >
              <Edit3 className="w-3.5 h-3.5" />
            </button>
            )}

            <button
              onClick={(e) => {
                e.stopPropagation();
                copyPromptForAI(t, parentNode?.title || '');
              }}
              title={t18n("legacy.copy_prompt_for_ai")}
              className="p-1 hover:bg-white/10 rounded-lg text-slate-400 hover:text-white cursor-pointer transition-colors"
            >
              {copiedId === t.id ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            </button>

{canWrite && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleToggleArchiveTicket(t.id);
              }}
              title={isArchived ? t18n("legacy.return_from_archive_to_board") : t18n("legacy.move_task_to_archive")}
              className="p-1 hover:bg-white/10 rounded-lg text-slate-400 hover:text-white cursor-pointer transition-colors"
            >
              {isArchived ? <ArchiveRestore className="w-3.5 h-3.5" /> : <Archive className="w-3.5 h-3.5" />}
            </button>
            )}

{canWrite && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setDeletingTicket(t);
              }}
              title={t18n("legacy.delete_task_with_confirmation")}
              className="p-1 hover:bg-rose-500/20 rounded-lg text-slate-400 hover:text-rose-300 cursor-pointer transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
            )}
          </div>
        </div>

        {/* Task Title */}
        <p className={"text-sm font-semibold leading-relaxed mb-3 " + (
          isDone ? 'text-slate-500 line-through' : 'text-slate-100 group-hover:text-white transition-colors'
        )}>
          {t.title}
        </p>

        {/* BACKEND BUG BADGE */}
        {isBackendBug && t.bug_context && (
          <div className="mb-2.5 p-2 bg-sky-500/10 border border-sky-500/20 rounded-xl text-[11px] font-mono text-sky-200 space-y-0.5">
            <div className="flex items-center gap-1 font-sans font-semibold text-sky-300">
              <Server className="w-3 h-3" /> {t18n("legacy.server_endpoint")}:
            </div>
            <div className="truncate text-sky-100">{t.bug_context.apiEndpoint}</div>
          </div>
        )}

        {/* UI BUG SELECTOR BADGE */}
        {isUiBug && t.bug_context?.selector && (
          <div className="mb-2.5 p-2 bg-pink-500/10 border border-pink-500/20 rounded-xl text-[11px] font-mono text-pink-200 space-y-0.5">
            <div className="flex items-center gap-1 font-sans font-semibold text-pink-300">
              <Crosshair className="w-3 h-3" /> {t18n("legacy.element_selector")}
            </div>
            <div className="truncate text-pink-100">{t.bug_context.selector}</div>
          </div>
        )}

        {/* REWORK NOTES BADGE */}
        {hasRework && (
          <div className="mb-2.5 p-2 bg-amber-500/10 border border-amber-500/20 rounded-xl text-[11px] text-amber-200 space-y-1">
            <div className="font-semibold flex items-center gap-1 text-amber-300">
              <AlertTriangle className="w-3 h-3" /> {t18n("legacy.revision_notes")}
            </div>
            <p className="line-clamp-2 italic text-amber-100/90">{t.rework_notes}</p>
          </div>
        )}

        {/* ERGONOMIC COMPACT DoD PROGRESS BAR */}
        {totalDoD > 0 && (
          <div className="space-y-1 mb-2">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setExpandedTicketDoD(prev => ({ ...prev, [t.id]: !prev[t.id] }));
              }}
              className="w-full flex items-center justify-between p-1.5 rounded-xl hover:bg-white/[0.05] text-[11px] text-slate-300 cursor-pointer border border-white/[0.06] transition-colors"
            >
              <div className="flex items-center gap-1.5">
                <CheckCircle2 className={`w-3.5 h-3.5 ${doneDoD === totalDoD ? 'text-emerald-400' : 'text-slate-400'}`} />
                <span className="font-medium">DoD: {doneDoD}/{totalDoD}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-14 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                  <div 
                    className={`h-full transition-all duration-300 ${doneDoD === totalDoD ? 'bg-emerald-400' : 'bg-indigo-500'}`} 
                    style={{ width: `${dodPercent}%` }}
                  />
                </div>
                {isDoDExpanded ? <ChevronUp className="w-3 h-3 text-slate-400" /> : <ChevronDown className="w-3 h-3 text-slate-400" />}
              </div>
            </button>

            {/* EXPANDED INTERACTIVE DoD CHECKLIST */}
            {isDoDExpanded && (
              <div className="bg-slate-900/90 p-2.5 rounded-xl border border-white/[0.08] space-y-1.5 animate-fadeIn" onClick={(e) => e.stopPropagation()}>
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
                      className="text-indigo-400 hover:text-indigo-300 cursor-pointer font-semibold"
                    >
                      {t18n('card.add_dod')}
                    </button>
                  )}
                </div>

                {Object.entries(t.checklists || {}).map(([key, val]) => (
                  <div key={key} className="flex items-center justify-between group/chk">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (canWrite) handleToggleChecklist(t.id, key);
                      }}
                      disabled={!canWrite}
                      className={`flex items-center gap-2 text-left flex-1 truncate ${canWrite ? 'cursor-pointer hover:opacity-80' : 'cursor-default'}`}
                    >
                      {val ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                      ) : (
                        <Circle className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                      )}
                      <span className={"text-[11px] truncate " + (val ? 'text-slate-300 line-through' : 'text-slate-200 font-medium')}>
                        {key}
                      </span>
                    </button>
{canWrite && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteDoDItem(t.id, key);
                      }}
                      className="opacity-0 group-hover/chk:opacity-100 text-slate-500 hover:text-rose-400 text-xs px-1 cursor-pointer"
                    >
                      ×
                    </button>
                    )}
                  </div>
                ))}

                {canWrite && addingDoDTicketId === t.id && (
                  <form 
                    onSubmit={(e) => {
                      e.stopPropagation();
                      handleAddCustomDoD(e, t.id);
                    }} 
                    className="flex items-center gap-1.5 pt-1"
                  >
                    <input
                      type="text"
                      value={newDoDLabel}
                      onChange={(e) => setNewDoDLabel(e.target.value)}
                      placeholder={t18n('card.new_dod_placeholder')}
                      className="flex-1 bg-white/[0.05] border border-white/[0.08] rounded-lg px-2 py-1 text-[11px] text-white outline-none focus:border-indigo-500"
                      autoFocus
                      required
                    />
                    <button type="submit" className="bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-semibold px-2 py-1 rounded-lg cursor-pointer transition-colors">
                      +
                    </button>
                  </form>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Card Footer: Assignee avatar + Key + Action */}
      <div className="flex justify-between items-center mt-3 pt-2.5 border-t border-white/[0.06]">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-full bg-slate-800 border border-slate-700 flex justify-center items-center overflow-hidden shrink-0 shadow-xs" title={t.assignee || t18n('v7.kanban.assignee')}>
            <img 
              src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${personaSeed}&backgroundColor=transparent`} 
              alt="avatar" 
              className="w-full h-full opacity-90" 
            />
          </div>
          <span className="text-xs text-slate-400 font-mono font-medium">#{displayKey}</span>
        </div>

        {/* REVIEW ACTIONS OR STATUS */}
        {isReview && canReview ? (
          <div className="flex items-center gap-1.5">
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleAcceptTicket(t.id);
              }}
              className="flex items-center gap-1 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/30 font-semibold text-[11px] py-1 px-2.5 rounded-lg cursor-pointer transition-colors"
            >
              <Check className="w-3 h-3" /> {t18n("legacy.accept")}
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setReworkTicketId(t.id);
                setReworkComment(t.rework_notes || '');
              }}
              className="flex items-center gap-1 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/30 font-semibold text-[11px] py-1 px-2 rounded-lg cursor-pointer transition-colors"
            >
              <AlertTriangle className="w-3 h-3" />
            </button>
          </div>
        ) : canWrite ? (
          <select
            value={t.status}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => handleStatusChange(t.id, e.target.value)}
            style={{ backgroundColor: '#0f172a', color: '#f8fafc' }}
            className="bg-slate-900 hover:bg-slate-800 border border-slate-700/60 rounded-lg text-[11px] font-semibold text-slate-200 px-2.5 py-1 outline-none cursor-pointer transition-colors shadow-xs"
          >
            {activeColumns.map(c => (
              <option key={c.id} value={c.id} style={{ backgroundColor: '#0f172a', color: '#f8fafc' }} className="bg-slate-900 text-slate-100 font-sans">
                {getColumnLabel(c)}
              </option>
            ))}
          </select>
        ) : (
          <span className="text-[10px] font-semibold text-slate-400 border border-white/[0.08] bg-white/[0.04] rounded-lg px-2 py-1">
            {getColumnLabel(activeColumns.find(c => c.id === t.status) || { id: t.status, label: t.status, color: 'slate' })}
          </span>
        )}
      </div>
    </div>
  );
};
