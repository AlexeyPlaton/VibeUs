import React, { useState, useMemo, useEffect } from 'react';
import { 
  X, Check, Copy, AlertTriangle, Bug, 
  MessageSquare, Plus, Trash2, Sparkles, User, 
  FolderGit2, CheckSquare, Send, BookOpen,
  GitBranch, ExternalLink, RefreshCw
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { DoDManager } from './widget/ui/DoDManager';
import { getGhostSuggestion, rankChecksByRelevance } from '../utils/aiDoDMatcher';
import { toPersistedCriterion } from '../utils/dodCatalog';
import type { DoDItem, EngineeringQualityMode } from '../utils/dodCatalog';

export interface TicketItem {
  id: string;
  key?: string;
  node_id?: string;
  title: string;
  summary?: string;
  source_quote?: string;
  assignee?: string;
  status: string;
  priority: string;
  order?: number;
  checklists?: Record<string, boolean>;
  criteria_contract?: Record<string, any>;
  criteria_evidence?: Record<string, any>;
  quality_mode?: EngineeringQualityMode;
  rework_notes?: string;
  github_issue_url?: string;
  github_issue_number?: number;
  bug_context?: {
    type?: string;
    selector?: string;
    pageUrl?: string;
    url?: string;
    viewport?: string;
    windowSize?: string;
    screen?: string;
    os?: string;
    browser?: string;
    dpr?: number;
    isTouch?: boolean;
    orientation?: string;
    lang?: string;
    apiEndpoint?: string;
    httpStatus?: string;
    payload?: string;
    traceback?: string;
  };
  comments?: Array<{
    id: string;
    author: string;
    text: string;
    created_at: string;
  }>;
  is_archived?: boolean;
  created_at?: string;
}

export interface NodeItem {
  id: string;
  title: string;
}

export interface ColumnItem {
  id: string;
  label: string;
}

export interface TicketDetailModalProps {
  ticket: TicketItem | null;
  nodes: NodeItem[];
  columns: ColumnItem[];
  accentTheme?: any;
  isOpen: boolean;
  onClose: () => void;
  onUpdateTicket: (id: string, updates: Partial<TicketItem>) => void;
  onDeleteTicket: (ticket: TicketItem) => void;
  onCopyPrompt: (ticket: TicketItem, nodeTitle: string) => void;
  projectId?: string;
  apiToken?: string;
}

export const TicketDetailModal: React.FC<TicketDetailModalProps> = ({
  ticket,
  nodes,
  columns,
  isOpen,
  onClose,
  onUpdateTicket,
  onDeleteTicket,
  onCopyPrompt,
  projectId,
  apiToken
}) => {
  const { t: t18n } = useTranslation();

  const [title, setTitle] = useState(ticket?.title || '');
  const [summary, setSummary] = useState(ticket?.summary || '');
  const [priority, setPriority] = useState(ticket?.priority || 'medium');
  const [status, setStatus] = useState(ticket?.status || 'backlog');
  const [assignee, setAssignee] = useState(ticket?.assignee || '');
  const [nodeId, setNodeId] = useState(ticket?.node_id || '');
  const [checklists, setChecklists] = useState<Record<string, boolean>>(ticket?.checklists || {});
  const [newChecklistKey, setNewChecklistKey] = useState('');
  const [ghostSuggestion, setGhostSuggestion] = useState('');
  const [newCommentText, setNewCommentText] = useState('');
  const [reworkNotes, setReworkNotes] = useState(ticket?.rework_notes || '');
  const [copiedPrompt, setCopiedPrompt] = useState(false);
  const [isDoDManagerOpen, setIsDoDManagerOpen] = useState(false);
  const [manualEvidence, setManualEvidence] = useState<Record<string, any>>(ticket?.criteria_evidence || {});
  const [manualVerifyBusy, setManualVerifyBusy] = useState<string | null>(null);
  const [manualVerifyError, setManualVerifyError] = useState<string | null>(null);
  const [isSyncingGithub, setIsSyncingGithub] = useState(false);
  const [githubSyncError, setGithubSyncError] = useState<string | null>(null);

  const handleSyncToGithub = async () => {
    if (!projectId || !ticket) return;
    setIsSyncingGithub(true);
    setGithubSyncError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/tickets/${ticket.id}/github/sync`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(apiToken ? { 'Authorization': `Bearer ${apiToken}`, 'X-API-Token': apiToken } : {})
        }
      });
      const data = await res.json();
      if (res.ok && data.github_url) {
        onUpdateTicket(ticket.id, {
          github_issue_url: data.github_url,
          github_issue_number: data.github_number
        });
      } else {
        setGithubSyncError(data.detail || t18n('v7.ticket.github.sync_failed'));
      }
    } catch (err: any) {
      setGithubSyncError(err.message || t18n('v7.ticket.github.network_error'));
    } finally {
      setIsSyncingGithub(false);
    }
  };

  const currentNode = nodes.find(n => n.id === nodeId);
  const totalDoD = Object.keys(checklists).length;
  const doneDoD = Object.values(checklists).filter(Boolean).length;
  const dodPercent = totalDoD > 0 ? Math.round((doneDoD / totalDoD) * 100) : 0;

  // Grouped DoD Checklists by Technical Category
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const toggleGroupCollapse = (groupId: string) => {
    setCollapsedGroups(prev => ({ ...prev, [groupId]: !prev[groupId] }));
  };

  const groupedChecklists = useMemo(() => {
    const groups = {
      tests: { id: 'tests', label: t18n('v7.ticket.groups.tests'), icon: '🧪', items: [] as Array<{ key: string; isDone: boolean }> },
      security: { id: 'security', label: t18n('v7.ticket.groups.security'), icon: '🛡️', items: [] as Array<{ key: string; isDone: boolean }> },
      ui: { id: 'ui', label: t18n('v7.ticket.groups.ui'), icon: '🎨', items: [] as Array<{ key: string; isDone: boolean }> },
      backend: { id: 'backend', label: t18n('v7.ticket.groups.backend'), icon: '⚙️', items: [] as Array<{ key: string; isDone: boolean }> },
      spec: { id: 'spec', label: t18n('v7.ticket.groups.spec'), icon: '📐', items: [] as Array<{ key: string; isDone: boolean }> },
      general: { id: 'general', label: t18n('v7.ticket.groups.general'), icon: '📋', items: [] as Array<{ key: string; isDone: boolean }> }
    };

    Object.entries(checklists).forEach(([key, isDone]) => {
      const lower = key.toLowerCase();
      if (/тест|границ|валидац|boundary|null|empty|диапазон|минимум|максимум|e2e|unit|mock|422/i.test(lower)) {
        groups.tests.items.push({ key, isDone: Boolean(isDone) });
      } else if (/безопасн|security|idor|auth|авториз|токен|token|jwt|401|403|rls|cors|права|xss|инъекц|inject|лимит|rate/i.test(lower)) {
        groups.security.items.push({ key, isDone: Boolean(isDone) });
      } else if (/ui|ux|адаптив|мобил|верстк|loading|skeleton|spinner|empty|toast|состояни|клик|кнопк|a11y|клавиатур|focus/i.test(lower)) {
        groups.ui.items.push({ key, isDone: Boolean(isDone) });
      } else if (/бэкенд|backend|баз|db|sql|индекс|orm|query|n\+1|таймаут|retry|сервис|api|webhook|производительн/i.test(lower)) {
        groups.backend.items.push({ key, isDone: Boolean(isDone) });
      } else if (/тз|спека|спецификац|mermaid|диаграмм|dto|схема|тип|контракт|doc|документ/i.test(lower)) {
        groups.spec.items.push({ key, isDone: Boolean(isDone) });
      } else {
        groups.general.items.push({ key, isDone: Boolean(isDone) });
      }
    });

    return Object.values(groups).filter(g => g.items.length > 0);
  }, [checklists, t18n]);

  // Sync state when ticket changes
  useEffect(() => {
    if (ticket) {
      setTitle(ticket.title || '');
      setSummary(ticket.summary || '');
      setPriority(ticket.priority || 'medium');
      setStatus(ticket.status || 'backlog');
      setAssignee(ticket.assignee || '');
      setNodeId(ticket.node_id || '');
      setChecklists(ticket.checklists || {});
      setReworkNotes(ticket.rework_notes || '');
      setManualEvidence(ticket.criteria_evidence || {});
    }
  }, [ticket?.id, ticket?.checklists, ticket?.criteria_evidence]);

  const handleSaveField = (field: keyof TicketItem, value: any) => {
    if (!ticket) return;
    onUpdateTicket(ticket.id, { [field]: value });
  };

  const handleToggleChecklist = (key: string) => {
    const updated = { ...checklists, [key]: !checklists[key] };
    setChecklists(updated);
    handleSaveField('checklists', updated);
  };

  const handleAddChecklistItem = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanKey = (newChecklistKey.trim() || ghostSuggestion || '').trim();
    if (!cleanKey) return;
    const updated = { ...checklists, [cleanKey]: false };
    setChecklists(updated);
    setNewChecklistKey('');
    handleSaveField('checklists', updated);
  };

  const handleAddCriteria = (items: DoDItem[], qualityMode: EngineeringQualityMode) => {
    if (!ticket || !items || items.length === 0) return;
    const updatedChecklists = { ...checklists };
    const updatedContract = { ...(ticket.criteria_contract || {}) };
    items.forEach(item => {
      const title = item.title.trim();
      if (!title) return;
      updatedChecklists[title] = false;
      updatedContract[title] = toPersistedCriterion(item);
    });
    setChecklists(updatedChecklists);
    onUpdateTicket(ticket.id, {
      checklists: updatedChecklists,
      criteria_contract: updatedContract,
      quality_mode: qualityMode,
    });
  };

  const isCriterionVerified = (key: string) => {
    const receipt = manualEvidence[key] || ticket?.criteria_evidence?.[key];
    return receipt?.verified === true && receipt?.result === 'PASS';
  };

  const handleManualVerify = async (key: string) => {
    if (!ticket || !projectId || !checklists[key]) return;
    setManualVerifyBusy(key);
    setManualVerifyError(null);
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/tickets/${encodeURIComponent(ticket.id)}/criteria/manual-verify`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof data.detail === 'string' ? data.detail : (data.detail?.code || 'Manual verification failed'));
      if (data.evidence) setManualEvidence(prev => ({ ...prev, [key]: data.evidence }));
    } catch (err: any) {
      setManualVerifyError(err?.message || 'Manual verification failed');
    } finally {
      setManualVerifyBusy(null);
    }
  };

  const handleDeleteChecklistItem = (key: string) => {
    const updated = { ...checklists };
    delete updated[key];
    setChecklists(updated);
    handleSaveField('checklists', updated);
  };

  const handleAddComment = (e: React.FormEvent) => {
    e.preventDefault();
    if (!ticket || !newCommentText.trim()) return;
    const newComment = {
      id: `c_${Date.now()}`,
      author: 'QA / Lead',
      text: newCommentText.trim(),
      created_at: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };
    const updatedComments = [...(ticket.comments || []), newComment];
    handleSaveField('comments', updatedComments);
    setNewCommentText('');
  };

  const handleAcceptTicket = () => {
    if (!ticket) return;
    setStatus('done');
    onUpdateTicket(ticket.id, { status: 'done', rework_notes: '' });
  };

  const handleReturnToRework = () => {
    if (!ticket || !reworkNotes.trim()) return;
    setStatus('in_progress');
    const noteComment = {
      id: `c_${Date.now()}`,
      author: t18n('ticket_modal.qa_author'),
      text: `${t18n('ticket_modal.rework_return_prefix')}${reworkNotes.trim()}`,
      created_at: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };
    const updatedComments = [...(ticket.comments || []), noteComment];
    onUpdateTicket(ticket.id, { 
      status: 'in_progress', 
      rework_notes: reworkNotes.trim(),
      comments: updatedComments
    });
    setReworkNotes('');
  };

  if (!isOpen || !ticket) return null;

  return (
    <div 
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
      className="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-[99999999] flex items-center justify-center p-3 sm:p-6 font-['Plus_Jakarta_Sans',sans-serif] animate-fadeIn"
    >
      <div className="bg-slate-900/95 backdrop-blur-2xl text-slate-100 rounded-3xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh] border border-slate-700/60 animate-scaleIn">
        
        {/* MODAL HEADER */}
        <div className="flex items-center justify-between p-4 sm:p-5 border-b border-white/[0.08] bg-slate-900/80 shrink-0">
          <div className="flex items-center gap-3">
            <span className="font-mono text-xs font-bold px-2.5 py-1 rounded-xl bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
              {ticket.key || ticket.id.slice(0, 6)}
            </span>
            <div className="flex items-center gap-2">
              <select
                value={status}
                onChange={(e) => {
                  setStatus(e.target.value);
                  handleSaveField('status', e.target.value);
                }}
                style={{ backgroundColor: '#0f172a', color: '#f8fafc' }}
                className="bg-slate-900 border border-slate-700/80 rounded-xl px-3 py-1.5 text-xs font-semibold text-slate-100 outline-none cursor-pointer hover:bg-slate-800 transition-colors shadow-xs"
              >
                {columns.map(c => (
                  <option key={c.id} value={c.id} style={{ backgroundColor: '#0f172a', color: '#f8fafc' }} className="bg-slate-900 text-slate-100">{c.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {ticket.github_issue_url ? (
              <a
                href={ticket.github_issue_url}
                target="_blank"
                rel="noopener noreferrer"
                title={t18n('v7.ticket.github.open_issue')}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 hover:text-white rounded-xl transition-all border border-slate-600 shadow-xs"
              >
                <GitBranch className="w-3.5 h-3.5 text-indigo-400" />
                <span>GitHub #{ticket.github_issue_number || 'Issue'}</span>
                <ExternalLink className="w-3 h-3 opacity-60" />
              </a>
            ) : projectId ? (
              <button
                type="button"
                onClick={handleSyncToGithub}
                disabled={isSyncingGithub}
                title={t18n('v7.ticket.github.send_issue')}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-300 hover:text-white rounded-xl transition-all cursor-pointer border border-slate-700 disabled:opacity-40"
              >
                {isSyncingGithub ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <GitBranch className="w-3.5 h-3.5 text-indigo-400" />}
                <span>{t18n('v7.ticket.github.button')}</span>
              </button>
            ) : null}

            <button
              onClick={() => {
                onCopyPrompt(ticket, currentNode?.title || '');
                setCopiedPrompt(true);
                setTimeout(() => setCopiedPrompt(false), 2000);
              }}
              title={t18n('ticket_modal.copy_prompt_title')}
              className="flex items-center gap-1.5 px-3.5 py-1.5 bg-indigo-600/20 hover:bg-indigo-600/30 text-xs font-semibold text-indigo-300 rounded-xl transition-all cursor-pointer border border-indigo-500/30"
            >
              {copiedPrompt ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copiedPrompt ? t18n('ticket_modal.copied') : t18n('ticket_modal.copy_prompt')}</span>
            </button>

            <button
              onClick={onClose}
              className="w-8 h-8 rounded-full bg-white/[0.05] border border-white/[0.08] flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/[0.1] transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* MODAL BODY */}
        <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-4 bg-transparent">
          
          {/* TITLE & SECTION BAR */}
          <div className="spatial-card space-y-3">
            <div className="flex items-center justify-between gap-3 flex-wrap sm:flex-nowrap">
              <div className="flex items-center gap-2 flex-1">
                <FolderGit2 className="w-4 h-4 text-indigo-400 shrink-0" />
                <span className="text-xs font-semibold text-slate-400">{t18n('ticket_modal.section_tz')}</span>
                <select
                  value={nodeId}
                  onChange={(e) => {
                    setNodeId(e.target.value);
                    handleSaveField('node_id', e.target.value);
                  }}
                  style={{ backgroundColor: '#0f172a', color: '#f8fafc' }}
                  className="bg-slate-900 border border-slate-700/80 rounded-xl px-2.5 py-1 text-xs font-medium text-slate-100 outline-none cursor-pointer"
                >
                  {nodes.map(n => (
                    <option key={n.id} value={n.id} style={{ backgroundColor: '#0f172a', color: '#f8fafc' }} className="bg-slate-900 text-slate-100">{n.title}</option>
                  ))}
                </select>
              </div>

              {/* PRIORITY & ASSIGNEE */}
              <div className="flex items-center gap-2">
                <select
                  value={priority}
                  onChange={(e) => {
                    setPriority(e.target.value);
                    handleSaveField('priority', e.target.value);
                  }}
                  style={{ backgroundColor: '#0f172a', color: '#f8fafc' }}
                  className={`text-xs font-semibold px-2.5 py-1 rounded-xl border outline-none cursor-pointer ${
                    priority === 'critical' ? 'bg-rose-500/20 text-rose-300 border-rose-500/30' :
                    priority === 'high' ? 'bg-amber-500/20 text-amber-300 border-amber-500/30' :
                    priority === 'low' ? 'bg-slate-800 text-slate-400 border-slate-700' :
                    'bg-indigo-500/20 text-indigo-300 border-indigo-500/30'
                  }`}
                >
                  <option value="low" style={{ backgroundColor: '#0f172a', color: '#f8fafc' }} className="bg-slate-900 text-white">{t18n('modal.priority_low')}</option>
                  <option value="medium" style={{ backgroundColor: '#0f172a', color: '#f8fafc' }} className="bg-slate-900 text-white">{t18n('modal.priority_medium')}</option>
                  <option value="high" style={{ backgroundColor: '#0f172a', color: '#f8fafc' }} className="bg-slate-900 text-white">{t18n('modal.priority_high')}</option>
                  <option value="critical" style={{ backgroundColor: '#0f172a', color: '#f8fafc' }} className="bg-slate-900 text-white">⚡ Critical</option>
                </select>

                <div className="flex items-center gap-1.5 bg-slate-900/80 px-2.5 py-1 rounded-xl border border-slate-700/60 text-xs">
                  <User className="w-3.5 h-3.5 text-slate-400" />
                  <input
                    type="text"
                    value={assignee}
                    onChange={(e) => setAssignee(e.target.value)}
                    onBlur={() => handleSaveField('assignee', assignee)}
                    placeholder={t18n('ticket_modal.assignee_placeholder')}
                    className="bg-transparent border-none outline-none text-xs font-medium text-slate-200 w-32 placeholder:text-slate-500"
                  />
                </div>
              </div>
            </div>

            {/* EDITABLE TITLE */}
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={() => handleSaveField('title', title)}
              placeholder={t18n('ticket_modal.title_placeholder')}
              className="w-full text-base font-bold text-slate-100 bg-transparent border-b border-white/[0.08] hover:border-white/[0.2] focus:border-indigo-500 outline-none pb-2 transition-colors"
            />
          </div>

          {/* QA / REWORK ACTION BOX (WHEN IN REVIEW) */}
          {status === 'review' && (
            <div className="spatial-card border-indigo-500/30 bg-indigo-500/10 space-y-3 animate-fadeIn">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-indigo-400" />
                  <span className="text-xs font-bold text-indigo-300">{t18n('ticket_modal.qa_review_title')}</span>
                </div>
                <span className="tag-spatial bg-indigo-500/20 text-indigo-300 border-indigo-500/30 text-[10px]">
                  {t18n('ticket_modal.all_criteria_met')}
                </span>
              </div>
              <p className="text-xs text-indigo-200/90 leading-relaxed">
                {t18n('ticket_modal.qa_review_desc')}
              </p>
              <div className="space-y-2">
                <textarea
                  value={reworkNotes}
                  onChange={(e) => setReworkNotes(e.target.value)}
                  placeholder={t18n('ticket_modal.rework_placeholder')}
                  rows={2}
                  className="w-full bg-slate-900 border border-slate-700/60 rounded-xl p-3 text-xs outline-none focus:border-indigo-500 text-slate-100 placeholder:text-slate-500"
                />
                <div className="flex items-center justify-end gap-2">
                  <button
                    onClick={handleReturnToRework}
                    className="flex items-center gap-1.5 px-3.5 py-1.5 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/30 text-xs font-semibold rounded-xl cursor-pointer transition-colors"
                  >
                    <AlertTriangle className="w-3.5 h-3.5" />
                    <span>{t18n('ticket_modal.return_to_rework')}</span>
                  </button>
                  <button
                    onClick={handleAcceptTicket}
                    className="flex items-center gap-1.5 px-4 py-1.5 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/30 text-xs font-semibold rounded-xl cursor-pointer transition-colors"
                  >
                    <Check className="w-3.5 h-3.5" />
                    <span>{t18n('ticket_modal.accept_ticket')}</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* DESCRIPTION / SUMMARY */}
          <div className="spatial-card space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-400">{t18n('ticket_modal.description_label')}</span>
            </div>
            <textarea
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              onBlur={() => handleSaveField('summary', summary)}
              rows={3}
              placeholder={t18n('ticket_modal.description_placeholder')}
              className="w-full bg-slate-900 border border-slate-700/60 rounded-xl p-3 text-xs text-slate-200 outline-none focus:border-indigo-500 leading-relaxed font-sans placeholder:text-slate-500"
            />
          </div>

            {/* DEFINITION OF DONE (DOD) CHECKLISTS */}
            <div className="spatial-card space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CheckSquare className="w-4 h-4 text-indigo-400" />
                  <span className="text-xs font-bold text-slate-200">Definition of Done (DoD)</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-medium text-slate-400">
                    {doneDoD} {t18n('ticket_modal.of')} {totalDoD} ({dodPercent}%)
                  </span>
                  <div className="w-20 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                    <div className="h-full bg-emerald-400 transition-all duration-300" style={{ width: `${dodPercent}%` }} />
                  </div>
                </div>
              </div>

              {/* Grouped DoD Checklist Items */}
              <div className="space-y-3">
                {Object.keys(checklists).length === 0 ? (
                  <div className="p-3 text-center border border-dashed border-white/[0.08] rounded-xl text-xs text-slate-500">
                    {t18n('ticket_modal.dod_empty')}
                  </div>
                ) : groupedChecklists.length === 1 && groupedChecklists[0] && groupedChecklists[0].items.length <= 2 ? (
                  // Simple flat list when very few items
                  <div className="space-y-1.5">
                    {groupedChecklists[0]?.items.map(({ key, isDone }) => (
                      <div 
                        key={key} 
                        onClick={() => handleToggleChecklist(key)}
                        className={`flex items-center justify-between p-2.5 rounded-xl border transition-all cursor-pointer group ${
                          isDone ? 'bg-emerald-500/10 border-emerald-500/20 text-slate-300' : 'bg-slate-900/60 hover:bg-slate-900 border-white/[0.05] text-slate-200'
                        }`}
                      >
                        <div className="flex items-center gap-2.5 min-w-0 flex-1 pr-2">
                          <input
                            type="checkbox"
                            checked={isDone}
                            onChange={() => {}}
                            className="w-4 h-4 rounded cursor-pointer accent-indigo-500 shrink-0"
                          />
                          <span className={`text-xs ${isDone ? 'line-through text-slate-400' : 'font-medium'} break-words`}>
                            {key}
                          </span>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          {isCriterionVerified(key) ? (
                            <span className="px-2 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-[10px] font-bold text-emerald-300">VERIFIED</span>
                          ) : (isDone && ticket?.criteria_contract?.[key]) ? (
                            <button
                              type="button"
                              disabled={manualVerifyBusy === key}
                              onClick={(e) => { e.stopPropagation(); void handleManualVerify(key); }}
                              className="px-2 py-1 rounded-lg bg-amber-500/10 border border-amber-500/20 text-[10px] font-bold text-amber-200 hover:bg-amber-500/20 disabled:opacity-50"
                            >
                              {manualVerifyBusy === key ? 'VERIFYING…' : 'HUMAN VERIFY'}
                            </button>
                          ) : null}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteChecklistItem(key);
                            }}
                            className="opacity-0 group-hover:opacity-100 p-1 hover:bg-rose-500/20 text-slate-400 hover:text-rose-300 rounded transition-opacity"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  // Structured grouped cards by category
                  groupedChecklists.map((group) => {
                    const groupDone = group.items.filter(i => i.isDone).length;
                    const groupTotal = group.items.length;
                    const isCollapsed = !!collapsedGroups[group.id];

                    return (
                      <div 
                        key={group.id} 
                        className="bg-slate-950/80 rounded-2xl border border-white/[0.06] overflow-hidden transition-all shadow-xs"
                      >
                        {/* Group Header */}
                        <div 
                          onClick={() => toggleGroupCollapse(group.id)}
                          className="flex items-center justify-between p-2.5 sm:px-3 bg-white/[0.02] hover:bg-white/[0.05] cursor-pointer transition-colors select-none"
                        >
                          <div className="flex items-center gap-2">
                            <span className="text-sm">{group.icon}</span>
                            <span className="text-xs font-bold text-slate-200">{group.label}</span>
                            <span className={`text-[10px] font-mono font-semibold px-2 py-0.2 rounded-full border ${
                              groupDone === groupTotal 
                                ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30' 
                                : 'bg-white/[0.06] text-slate-300 border-white/[0.08]'
                            }`}>
                              {groupDone}/{groupTotal}
                            </span>
                          </div>
                          <span className="text-[11px] text-slate-400 font-mono">
                            {isCollapsed ? t18n('v7.ticket.group.expand') : t18n('v7.ticket.group.collapse')}
                          </span>
                        </div>

                        {/* Group Items */}
                        {!isCollapsed && (
                          <div className="p-2 space-y-1.5 border-t border-white/[0.04]">
                            {group.items.map(({ key, isDone }) => (
                              <div 
                                key={key} 
                                onClick={() => handleToggleChecklist(key)}
                                className={`flex items-center justify-between p-2 rounded-xl border transition-all cursor-pointer group ${
                                  isDone ? 'bg-emerald-500/10 border-emerald-500/20 text-slate-300' : 'bg-slate-900/60 hover:bg-slate-900 border-white/[0.04] text-slate-200'
                                }`}
                              >
                                <div className="flex items-center gap-2.5 min-w-0 flex-1 pr-2">
                                  <input
                                    type="checkbox"
                                    checked={isDone}
                                    onChange={() => {}}
                                    className="w-4 h-4 rounded cursor-pointer accent-indigo-500 shrink-0"
                                  />
                                  <span className={`text-xs ${isDone ? 'line-through text-slate-400' : 'font-medium'} break-words leading-relaxed`}>
                                    {key}
                                  </span>
                                </div>
                                <div className="flex items-center gap-1 shrink-0">
                                  {isCriterionVerified(key) ? (
                                    <span className="px-2 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-[10px] font-bold text-emerald-300">VERIFIED</span>
                                  ) : (isDone && ticket?.criteria_contract?.[key]) ? (
                                    <button
                                      type="button"
                                      disabled={manualVerifyBusy === key}
                                      onClick={(e) => { e.stopPropagation(); void handleManualVerify(key); }}
                                      className="px-2 py-1 rounded-lg bg-amber-500/10 border border-amber-500/20 text-[10px] font-bold text-amber-200 hover:bg-amber-500/20 disabled:opacity-50"
                                    >
                                      {manualVerifyBusy === key ? 'VERIFYING…' : 'HUMAN VERIFY'}
                                    </button>
                                  ) : null}
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleDeleteChecklistItem(key);
                                    }}
                                    className="opacity-0 group-hover:opacity-100 p-1 hover:bg-rose-500/20 text-slate-400 hover:text-rose-300 rounded transition-opacity"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>

              {manualVerifyError && (
                <div className="text-[11px] text-rose-300 bg-rose-500/10 border border-rose-500/20 rounded-xl px-3 py-2">{manualVerifyError}</div>
              )}

              {/* Add DoD Item Form with Ghost Auto-Suggestion */}
              <div className="space-y-2 pt-1">
                <form onSubmit={handleAddChecklistItem} className="flex items-center gap-2">
                  <input
                    type="text"
                    value={newChecklistKey}
                    onChange={(e) => setNewChecklistKey(e.target.value)}
                    placeholder={t18n('ticket_modal.dod_placeholder')}
                    className="flex-1 bg-slate-900 border border-slate-700/80 rounded-xl px-3.5 py-2 text-xs text-white placeholder:text-slate-500 outline-none focus:border-indigo-500 shadow-inner"
                  />

                  <button
                    type="submit"
                    className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-semibold cursor-pointer transition-colors shrink-0 shadow-xs"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>{t18n('ticket_modal.add_btn')}</span>
                  </button>
                </form>

                {/* Quick Action Tools: Presets / Catalog & AI Generator */}
                <div className="flex items-center justify-between gap-2 flex-wrap pt-1">
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setIsDoDManagerOpen(true)}
                      className="flex items-center gap-1.5 px-2.5 py-1 bg-white/[0.05] hover:bg-white/[0.1] text-indigo-300 border border-indigo-500/20 rounded-lg text-[11px] font-semibold cursor-pointer transition-colors"
                    >
                      <BookOpen className="w-3 h-3" />
                      <span>{t18n('v7.ticket.dod.catalog')}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setIsDoDManagerOpen(true)}
                      className="flex items-center gap-1.5 px-2.5 py-1 bg-gradient-to-r from-indigo-500/20 to-purple-500/20 hover:from-indigo-500/30 hover:to-purple-500/30 text-purple-200 border border-purple-500/30 rounded-lg text-[11px] font-semibold cursor-pointer transition-colors"
                    >
                      <Sparkles className="w-3 h-3 text-purple-300" />
                      <span>{t18n('v7.ticket.dod.ai')}</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* DoD Manager Modal */}
            <DoDManager
              isOpen={isDoDManagerOpen}
              onClose={() => setIsDoDManagerOpen(false)}
              ticketTitle={title}
              ticketSummary={summary}
              category={ticket.bug_context?.type || ''}
              currentChecklists={checklists}
              onAddCriteria={handleAddCriteria}
              t18n={t18n}
            />

          {/* BUG CONTEXT (IF BUG REPORT) */}
          {ticket.bug_context && (ticket.bug_context.selector || ticket.bug_context.apiEndpoint || ticket.bug_context.os || ticket.bug_context.browser) && (
            <div className="spatial-card border-rose-500/20 bg-rose-500/10 space-y-2.5">
              <div className="flex items-center gap-2">
                <Bug className="w-4 h-4 text-rose-400" />
                <span className="text-xs font-bold text-rose-300">{t18n('ticket_modal.bug_context_title')}</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px] font-mono text-slate-300">
                {ticket.bug_context.selector && (
                  <div className="p-2.5 bg-slate-900 rounded-xl border border-white/[0.08]">
                    <span className="text-slate-500 font-sans font-semibold block text-[10px]">{t18n('ticket_modal.css_selector')}</span>
                    <code className="text-pink-300 break-all">{ticket.bug_context.selector}</code>
                  </div>
                )}
                {(ticket.bug_context.url || ticket.bug_context.pageUrl) && (
                  <div className="p-2.5 bg-slate-900 rounded-xl border border-white/[0.08]">
                    <span className="text-slate-500 font-sans font-semibold block text-[10px]">{t18n('ticket_modal.page')}</span>
                    <span className="text-slate-300 truncate block">{ticket.bug_context.url || ticket.bug_context.pageUrl}</span>
                  </div>
                )}
                {(ticket.bug_context.os || ticket.bug_context.browser) && (
                  <div className="p-2.5 bg-slate-900 rounded-xl border border-white/[0.08]">
                    <span className="text-slate-500 font-sans font-semibold block text-[10px]">{t18n('ticket_modal.device_os_browser')}</span>
                    <span className="text-indigo-300 font-semibold">{ticket.bug_context.browser || 'Browser'} • {ticket.bug_context.os || 'OS'}</span>
                  </div>
                )}
                {(ticket.bug_context.viewport || ticket.bug_context.windowSize) && (
                  <div className="p-2.5 bg-slate-900 rounded-xl border border-white/[0.08]">
                    <span className="text-slate-500 font-sans font-semibold block text-[10px]">{t18n('ticket_modal.screen_viewport')}</span>
                    <span className="text-slate-300 font-semibold">{ticket.bug_context.viewport || ticket.bug_context.windowSize}</span>
                  </div>
                )}
                {ticket.bug_context.apiEndpoint && (
                  <div className="p-2.5 bg-slate-900 rounded-xl border border-white/[0.08] sm:col-span-2">
                    <span className="text-slate-500 font-sans font-semibold block text-[10px]">{t18n('ticket_modal.server_endpoint')} ({ticket.bug_context.httpStatus}):</span>
                    <code className="text-sky-300">{ticket.bug_context.apiEndpoint}</code>
                  </div>
                )}
                {ticket.bug_context.traceback && (
                  <div className="p-2.5 bg-slate-950 text-slate-300 rounded-xl sm:col-span-2 overflow-x-auto text-[10px] border border-white/[0.05]">
                    <pre className="font-mono">{ticket.bug_context.traceback}</pre>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* COMMENTS & DISCUSSIONS */}
          <div className="spatial-card space-y-3">
            <div className="flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-slate-400" />
              <span className="text-xs font-bold text-slate-200">{t18n('ticket_modal.comments_title')} ({ticket.comments?.length || 0})</span>
            </div>

            {/* Comment Thread */}
            <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
              {(ticket.comments || []).length === 0 ? (
                <div className="p-3 text-center text-xs text-slate-500 italic">
                  {t18n('ticket_modal.comments_empty')}
                </div>
              ) : (
                ticket.comments?.map(c => (
                  <div key={c.id} className="p-3 bg-slate-900 border border-white/[0.06] rounded-xl space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-slate-200">{c.author}</span>
                      <span className="text-[10px] text-slate-500">{c.created_at}</span>
                    </div>
                    <p className="text-xs text-slate-300 leading-relaxed font-sans">{c.text}</p>
                  </div>
                ))
              )}
            </div>

            {/* Add Comment Input */}
            <form onSubmit={handleAddComment} className="flex items-center gap-2 pt-1">
              <input
                type="text"
                value={newCommentText}
                onChange={(e) => setNewCommentText(e.target.value)}
                placeholder={t18n('ticket_modal.comment_placeholder')}
                className="flex-1 bg-slate-900 border border-slate-700/60 rounded-xl px-3 py-2 text-xs text-white placeholder:text-slate-500 outline-none focus:border-indigo-500"
              />
              <button
                type="submit"
                className="p-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl cursor-pointer transition-all shadow-xs"
              >
                <Send className="w-4 h-4" />
              </button>
            </form>
          </div>

        </div>

        {/* MODAL FOOTER */}
        <div className="p-4 bg-slate-900/90 border-t border-white/[0.08] flex items-center justify-between">
          <button
            onClick={() => onDeleteTicket(ticket)}
            className="flex items-center gap-1.5 px-3.5 py-2 text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 rounded-xl text-xs font-semibold cursor-pointer transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>{t18n('ticket_modal.delete_ticket')}</span>
          </button>

          <button
            onClick={onClose}
            className="px-5 py-2 bg-white/[0.08] hover:bg-white/[0.12] text-white font-semibold text-xs rounded-xl cursor-pointer transition-colors"
          >
            {t18n('ticket_modal.close')}
          </button>
        </div>

      </div>
    </div>
  );
};
