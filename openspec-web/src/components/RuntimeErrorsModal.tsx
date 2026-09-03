import { tr } from '../i18n/config';
import { useEffect, useState } from 'react';
import {
  Activity,
  AlertOctagon,
  AlertTriangle,
  Bug,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock,
  Code2,
  Copy,
  ExternalLink,
  EyeOff,
  Filter,
  Layers,
  Loader2,
  Play,
  RefreshCw,
  Terminal,
  X,
} from 'lucide-react';

export type ErrorGroup = {
  id: string;
  project_id: string;
  fingerprint: string;
  service: string;
  exception_type: string;
  normalized_message: string;
  route?: string | null;
  top_frame?: string | null;
  status: 'open' | 'resolved' | 'ignored';
  occurrences_count: number;
  first_seen_at: string;
  last_seen_at: string;
  ticket_id?: string | null;
  ticket_key?: string | null;
};

export type StackFrame = {
  filename: string;
  lineno: number;
  function: string;
};

export type ErrorOccurrence = {
  id: string;
  request_id?: string | null;
  environment: string;
  release?: string | null;
  method?: string | null;
  route?: string | null;
  status_code: number;
  stack: StackFrame[];
  created_at: string;
};

export type ErrorGroupDetail = ErrorGroup & {
  latest_occurrence?: ErrorOccurrence | null;
  ticket_title?: string | null;
  ticket_status?: string | null;
};

interface RuntimeErrorsModalProps {
  workspaceId: string;
  project: {
    id: string;
    name: string;
    slug: string;
    runtime_error_tracking_enabled?: boolean;
    ingest_key_configured: boolean;
  };
  serverUrl: string;
  isOpen: boolean;
  onClose: () => void;
  onOpenBoard?: () => void;
}

export function RuntimeErrorsModal({
  workspaceId,
  project,
  serverUrl,
  isOpen,
  onClose,
  onOpenBoard,
}: RuntimeErrorsModalProps) {
  const [errors, setErrors] = useState<ErrorGroup[]>([]);
  const [selectedError, setSelectedError] = useState<ErrorGroupDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'all' | 'open' | 'resolved' | 'ignored' | 'sdk'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [triggeringTest, setTriggeringTest] = useState(false);
  const [statusUpdating, setStatusUpdating] = useState(false);

  const fetchErrors = async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await fetch(
        `${serverUrl}/api/workspaces/${workspaceId}/projects/${project.slug}/errors?limit=200`,
        { credentials: 'include' },
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || data.message || tr('v7.runtime.errors.load'));
      }
      const list: ErrorGroup[] = await res.json();
      setErrors(list);
    } catch (err: any) {
      setErrorMsg(err.message || tr('v7.runtime.errors.load_generic'));
    } finally {
      setLoading(false);
    }
  };

  const fetchDetail = async (groupId: string) => {
    setLoadingDetail(true);
    try {
      const res = await fetch(
        `${serverUrl}/api/workspaces/${workspaceId}/projects/${project.slug}/errors/${groupId}`,
        { credentials: 'include' },
      );
      if (!res.ok) throw new Error(tr('v7.runtime.errors.detail'));
      const detail: ErrorGroupDetail = await res.json();
      setSelectedError(detail);
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setLoadingDetail(false);
    }
  };

  const updateStatus = async (groupId: string, newStatus: 'open' | 'resolved' | 'ignored') => {
    setStatusUpdating(true);
    try {
      const res = await fetch(
        `${serverUrl}/api/workspaces/${workspaceId}/projects/${project.slug}/errors/${groupId}`,
        {
          method: 'PATCH',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: newStatus }),
        },
      );
      if (!res.ok) throw new Error(tr('v7.runtime.errors.status'));
      setErrors((prev) =>
        prev.map((err) => (err.id === groupId ? { ...err, status: newStatus } : err)),
      );
      if (selectedError && selectedError.id === groupId) {
        setSelectedError({ ...selectedError, status: newStatus });
      }
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setStatusUpdating(false);
    }
  };

  const triggerTestCrash = async () => {
    setTriggeringTest(true);
    setErrorMsg(null);
    try {
      const res = await fetch(
        `${serverUrl}/api/workspaces/${workspaceId}/projects/${project.slug}/errors/test-event`,
        {
          method: 'POST',
          credentials: 'include',
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.detail || data.message || tr('v7.runtime.errors.test'));
      }
      await fetchErrors();
      if (data.group_id) {
        await fetchDetail(data.group_id);
      }
    } catch (err: any) {
      setErrorMsg(err.message || tr('v7.runtime.errors.test_generic'));
    } finally {
      setTriggeringTest(false);
    }
  };

  const copy = async (text: string, id: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1600);
  };

  useEffect(() => {
    if (isOpen) {
      fetchErrors();
      setSelectedError(null);
      setActiveTab('all');
    }
  }, [isOpen, project.slug]);

  if (!isOpen) return null;

  const filteredErrors = errors.filter((err) => {
    if (activeTab === 'open' && err.status !== 'open') return false;
    if (activeTab === 'resolved' && err.status !== 'resolved') return false;
    if (activeTab === 'ignored' && err.status !== 'ignored') return false;
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      const matchType = err.exception_type.toLowerCase().includes(query);
      const matchMsg = err.normalized_message.toLowerCase().includes(query);
      const matchRoute = (err.route || '').toLowerCase().includes(query);
      const matchFrame = (err.top_frame || '').toLowerCase().includes(query);
      return matchType || matchMsg || matchRoute || matchFrame;
    }
    return true;
  });

  const openCount = errors.filter((e) => e.status === 'open').length;
  const resolvedCount = errors.filter((e) => e.status === 'resolved').length;
  const ignoredCount = errors.filter((e) => e.status === 'ignored').length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 sm:p-6 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="flex h-[92vh] w-full max-w-6xl flex-col rounded-3xl border border-white/10 bg-slate-900 shadow-2xl overflow-hidden">
        {/* Header */}
        <header className="flex flex-wrap items-center justify-between border-b border-white/10 px-6 py-4 bg-slate-950/70">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-rose-500/10 text-rose-400 border border-rose-500/20">
              <Activity className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold text-white">{tr('v7.runtime.title')}</h2>
                <span className="rounded-full bg-slate-800 px-2 py-0.5 text-xs text-slate-400">
                  {project.slug}
                </span>
                {project.runtime_error_tracking_enabled ? (
                  <span className="flex items-center gap-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 text-[10px] font-medium text-emerald-300">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />{tr('v7.runtime.status.active')}</span>
                ) : (
                  <span className="rounded-full bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 text-[10px] font-medium text-amber-300">{tr('v7.runtime.status.disabled')}</span>
                )}
              </div>
              <p className="text-xs text-slate-400 mt-0.5">{tr('v7.runtime.subtitle')}</p>
            </div>
          </div>

          <div className="flex items-center gap-2 mt-3 sm:mt-0">
            <button
              onClick={triggerTestCrash}
              disabled={triggeringTest || !project.runtime_error_tracking_enabled}
              className="inline-flex items-center gap-1.5 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3.5 py-2 text-xs font-semibold text-rose-200 hover:bg-rose-500/20 disabled:opacity-40 transition-colors"
              title={
                !project.runtime_error_tracking_enabled
                  ? tr('v7.runtime.test.enable_first')
                  : tr('v7.runtime.test.send_title')
              }
            >
              {triggeringTest ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Play className="h-3.5 w-3.5" />
              )}
              {tr('v7.runtime.test.button')}
            </button>

            <button
              onClick={fetchErrors}
              disabled={loading}
              className="rounded-xl border border-white/10 p-2 text-slate-400 hover:bg-white/5 hover:text-white transition-colors"
              title={tr('v7.runtime.common.refresh')}
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </button>

            <button
              onClick={onClose}
              className="rounded-xl border border-white/10 p-2 text-slate-400 hover:bg-white/5 hover:text-white transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </header>

        {/* Warning Banner if tracking disabled */}
        {!project.runtime_error_tracking_enabled && (
          <div className="flex items-center justify-between border-b border-amber-500/20 bg-amber-500/10 px-6 py-2.5 text-xs text-amber-200">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" />
              <span>
                {tr('v7.runtime.disabled_notice')}
              </span>
            </div>
            <button
              onClick={() => setActiveTab('sdk')}
              className="ml-4 font-semibold underline hover:text-amber-100"
            >{tr('v7.runtime.sdk.how')}</button>
          </div>
        )}

        {/* Navigation Tabs & Search */}
        <div className="flex flex-wrap items-center justify-between border-b border-white/10 px-6 py-3 bg-slate-900/50">
          <div className="flex flex-wrap gap-1">
            <button
              onClick={() => setActiveTab('all')}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                activeTab === 'all'
                  ? 'bg-white text-slate-950 shadow-sm'
                  : 'text-slate-400 hover:text-white hover:bg-white/5'
              }`}
            >
              {tr('v7.runtime.tabs.all', { count: errors.length })}
            </button>
            <button
              onClick={() => setActiveTab('open')}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                activeTab === 'open'
                  ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                  : 'text-slate-400 hover:text-white hover:bg-white/5'
              }`}
            >
              {tr('v7.runtime.tabs.open', { count: openCount })}
            </button>
            <button
              onClick={() => setActiveTab('resolved')}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                activeTab === 'resolved'
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                  : 'text-slate-400 hover:text-white hover:bg-white/5'
              }`}
            >
              {tr('v7.runtime.tabs.resolved', { count: resolvedCount })}
            </button>
            <button
              onClick={() => setActiveTab('ignored')}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                activeTab === 'ignored'
                  ? 'bg-slate-700 text-slate-200'
                  : 'text-slate-400 hover:text-white hover:bg-white/5'
              }`}
            >
              {tr('v7.runtime.tabs.ignored', { count: ignoredCount })}
            </button>
            <button
              onClick={() => setActiveTab('sdk')}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors flex items-center gap-1.5 ${
                activeTab === 'sdk'
                  ? 'bg-indigo-600 text-white'
                  : 'text-indigo-300 hover:bg-indigo-500/10'
              }`}
            >
              <Code2 className="h-3.5 w-3.5" />{tr('v7.runtime.sdk.title')}</button>
          </div>

          {activeTab !== 'sdk' && (
            <div className="relative mt-2 sm:mt-0 w-full sm:w-64">
              <input
                type="text"
                placeholder={tr('v7.runtime.search')}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-1.5 text-xs text-white placeholder-slate-500 outline-none focus:border-indigo-500"
              />
            </div>
          )}
        </div>

        {/* Content Body */}
        {errorMsg && (
          <div className="mx-6 mt-4 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-200">
            {errorMsg}
          </div>
        )}

        <div className="flex flex-1 overflow-hidden">
          {activeTab === 'sdk' ? (
            /* SDK Integration Guide */
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              <div className="rounded-2xl border border-indigo-500/20 bg-indigo-500/10 p-5">
                <div className="flex items-center gap-2 text-indigo-300 font-bold text-sm">
                  <Terminal className="h-4 w-4" />{tr('v7.runtime.sdk.explainer_title')}</div>
                <p className="mt-2 text-xs text-indigo-200/80 leading-relaxed">
                  {tr('v7.runtime.sdk.explainer')}
                </p>
              </div>

              <div className="space-y-4">
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <Code2 className="h-4 w-4 text-emerald-400" />
                  1. Python (FastAPI / Starlette)
                </h3>
                <div className="relative rounded-2xl border border-white/10 bg-slate-950 p-4 font-mono text-xs text-slate-300">
                  <button
                    onClick={() =>
                      copy(
                        `# ${tr('v7.runtime.sdk.insert_comment')}\nfrom vibeus_sdk import VibeUsMiddleware\n\napp = FastAPI()\n\napp.add_middleware(\n    VibeUsMiddleware,\n    ingest_key="vb_ingest_...", # ${tr('v7.runtime.sdk.key_comment')}\n    server_url="${serverUrl}",\n    service="backend",\n    environment="production",\n)`,
                        'py_sdk',
                      )
                    }
                    className="absolute right-3 top-3 rounded-lg border border-white/10 bg-slate-900 px-2.5 py-1 text-[11px] hover:bg-white/10 flex items-center gap-1"
                  >
                    {copiedId === 'py_sdk' ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                    {copiedId === 'py_sdk' ? tr('v7.runtime.common.copied') : tr('v7.runtime.common.copy')}
                  </button>
                  <pre className="overflow-x-auto text-emerald-300">
{`from fastapi import FastAPI
from vibeus_sdk import VibeUsMiddleware

app = FastAPI()

# ${tr('v7.runtime.sdk.bridge_comment')}
app.add_middleware(
    VibeUsMiddleware,
    ingest_key="vb_ingest_...", # ${tr('v7.runtime.sdk.copy_key_comment')}
    server_url="${serverUrl}",
    service="backend",
    environment="production",
)`}
                  </pre>
                </div>
              </div>

              <div className="space-y-4">
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <Terminal className="h-4 w-4 text-amber-400" />{tr('v7.runtime.sdk.curl')}</h3>
                <div className="relative rounded-2xl border border-white/10 bg-slate-950 p-4 font-mono text-xs text-slate-300">
                  <button
                    onClick={() =>
                      copy(
                        `curl -X POST ${serverUrl}/api/ingest/errors \\\n  -H "Content-Type: application/json" \\\n  -H "X-VibeUs-Ingest-Key: vb_ingest_..." \\\n  -d '{"service":"backend","exception_type":"RuntimeError","message":"Critical database timeout","route":"/api/orders","status_code":500}'`,
                        'curl_test',
                      )
                    }
                    className="absolute right-3 top-3 rounded-lg border border-white/10 bg-slate-900 px-2.5 py-1 text-[11px] hover:bg-white/10 flex items-center gap-1"
                  >
                    {copiedId === 'curl_test' ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                    {copiedId === 'curl_test' ? tr('v7.runtime.common.copied') : tr('v7.runtime.common.copy')}
                  </button>
                  <pre className="overflow-x-auto text-amber-300">
{`curl -X POST ${serverUrl}/api/ingest/errors \\
  -H "Content-Type: application/json" \\
  -H "X-VibeUs-Ingest-Key: vb_ingest_..." \\
  -d '{
    "service": "backend",
    "exception_type": "RuntimeError",
    "message": "Critical database connection timeout",
    "route": "/api/orders",
    "status_code": 500,
    "environment": "production"
  }'`}
                  </pre>
                </div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 text-xs text-slate-400 space-y-2">
                <div className="font-semibold text-white">{tr('v7.runtime.security.title')}</div>
                <p>
                  1. <b>{tr('v7.runtime.security.secret_title')}</b>{tr('v7.runtime.security.secret_copy')}</p>
                <p>
                  2. <b>{tr('v7.runtime.security.sanitize_title')}</b> {tr('v7.runtime.security.sanitize_copy')}
                </p>
                <p>
                  3. <b>{tr('v7.runtime.security.dedupe_title')}</b> {tr('v7.runtime.security.dedupe_copy')}
                </p>
              </div>
            </div>
          ) : (
            /* Error Groups List + Detail Panel */
            <div className="flex flex-1 overflow-hidden">
              {/* Left Column: Error Groups List */}
              <div
                className={`overflow-y-auto border-r border-white/10 p-4 space-y-2.5 transition-all ${
                  selectedError ? 'w-full md:w-5/12 lg:w-4/12' : 'w-full'
                }`}
              >
                {loading ? (
                  <div className="flex h-64 items-center justify-center text-slate-500">
                    <Loader2 className="h-6 w-6 animate-spin" />
                  </div>
                ) : filteredErrors.length === 0 ? (
                  <div className="flex h-64 flex-col items-center justify-center text-center p-6 text-slate-400">
                    <div className="rounded-2xl bg-white/5 p-4 text-slate-500">
                      <CheckCircle2 className="h-8 w-8 text-emerald-400" />
                    </div>
                    <p className="mt-4 font-semibold text-white text-sm">{tr('v7.runtime.empty.title')}</p>
                    <p className="mt-1 text-xs text-slate-500 max-w-sm">
                      {searchQuery
                        ? tr('v7.runtime.empty.filtered')
                        : tr('v7.runtime.empty.stable')}
                    </p>
                    <button
                      onClick={triggerTestCrash}
                      disabled={triggeringTest || !project.runtime_error_tracking_enabled}
                      className="mt-4 inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-3.5 py-2 text-xs font-semibold text-slate-300 hover:bg-white/10 transition-colors"
                    >
                      <Play className="h-3 w-3 text-rose-400" />{tr('v7.runtime.test.send_crash')}</button>
                  </div>
                ) : (
                  filteredErrors.map((err) => {
                    const isSelected = selectedError?.id === err.id;
                    return (
                      <article
                        key={err.id}
                        onClick={() => fetchDetail(err.id)}
                        className={`group cursor-pointer rounded-2xl border p-4 transition-all ${
                          isSelected
                            ? 'border-indigo-500/50 bg-indigo-500/10 shadow-lg'
                            : 'border-white/10 bg-white/[0.025] hover:border-white/20 hover:bg-white/[0.04]'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <span
                              className={`rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                                err.status === 'open'
                                  ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                                  : err.status === 'resolved'
                                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                                  : 'bg-slate-700 text-slate-300'
                              }`}
                            >
                              {err.status === 'open'
                                ? 'Open'
                                : err.status === 'resolved'
                                ? 'Resolved'
                                : 'Ignored'}
                            </span>
                            <span className="rounded bg-black/40 px-1.5 py-0.5 font-mono text-[10px] text-slate-400">
                              {err.service}
                            </span>
                          </div>

                          <span className="rounded-full bg-rose-500/10 border border-rose-500/20 px-2 py-0.5 text-[11px] font-bold text-rose-300">
                            {err.occurrences_count} {err.occurrences_count === 1 ? tr('v7.runtime.count.one') : tr('v7.runtime.count.many')}
                          </span>
                        </div>

                        <h4 className="mt-2 font-mono text-sm font-bold text-white group-hover:text-indigo-300 transition-colors">
                          {err.exception_type}
                        </h4>

                        {err.route && (
                          <p className="mt-1 font-mono text-xs text-slate-400 truncate">
                            {err.route}
                          </p>
                        )}

                        <p className="mt-1.5 text-xs text-slate-300 line-clamp-2 leading-relaxed">
                          {err.normalized_message}
                        </p>

                        {err.top_frame && (
                          <div className="mt-2 text-[11px] font-mono text-slate-400 truncate bg-black/30 rounded-lg p-1.5">
                            📍 {err.top_frame}
                          </div>
                        )}

                        <div className="mt-3 flex items-center justify-between pt-2 border-t border-white/5 text-[11px] text-slate-500">
                          <span className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {new Date(err.last_seen_at).toLocaleTimeString('ru-RU', {
                              hour: '2-digit',
                              minute: '2-digit',
                              day: '2-digit',
                              month: '2-digit',
                            })}
                          </span>
                          {err.ticket_key && (
                            <span className="flex items-center gap-1 font-semibold text-indigo-400">
                              <Bug className="h-3 w-3" />
                              {err.ticket_key}
                            </span>
                          )}
                        </div>
                      </article>
                    );
                  })
                )}
              </div>

              {/* Right Column: Error Details Inspector */}
              {selectedError && (
                <div className="flex flex-1 flex-col overflow-y-auto p-6 bg-slate-950/40">
                  <div className="flex items-start justify-between gap-4 border-b border-white/10 pb-5">
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="font-mono text-lg font-bold text-rose-300">
                          {selectedError.exception_type}
                        </h3>
                        <span
                          className={`rounded px-2 py-0.5 text-xs font-bold ${
                            selectedError.status === 'open'
                              ? 'bg-rose-500/20 text-rose-300'
                              : selectedError.status === 'resolved'
                              ? 'bg-emerald-500/20 text-emerald-300'
                              : 'bg-slate-700 text-slate-300'
                          }`}
                        >
                          {selectedError.status.toUpperCase()}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-slate-400">
                        {selectedError.route ? tr('v7.runtime.route', { route: selectedError.route }) : selectedError.service}
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      {selectedError.status !== 'ignored' ? (
                        <button
                          onClick={() => updateStatus(selectedError.id, 'ignored')}
                          disabled={statusUpdating}
                          className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-300 hover:bg-slate-700 transition-colors"
                        >
                          <EyeOff className="h-3.5 w-3.5" />{tr('v7.runtime.actions.ignore')}</button>
                      ) : (
                        <button
                          onClick={() => updateStatus(selectedError.id, 'open')}
                          disabled={statusUpdating}
                          className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-300 hover:bg-slate-700 transition-colors"
                        >
                          <RefreshCw className="h-3.5 w-3.5" />{tr('v7.runtime.actions.resume')}</button>
                      )}

                      {selectedError.status !== 'resolved' && (
                        <button
                          onClick={() => updateStatus(selectedError.id, 'resolved')}
                          disabled={statusUpdating}
                          className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/20 transition-colors"
                        >
                          <Check className="h-3.5 w-3.5" />{tr('v7.runtime.actions.resolve')}</button>
                      )}
                    </div>
                  </div>

                  {/* Summary & Message */}
                  <div className="mt-5 space-y-4">
                    <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
                      <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">{tr('v7.runtime.detail.message')}</span>
                      <p className="mt-1.5 font-mono text-xs text-white leading-relaxed whitespace-pre-wrap">
                        {selectedError.normalized_message}
                      </p>
                    </div>

                    {/* Linked Ticket Card */}
                    {selectedError.ticket_key && (
                      <div className="flex items-center justify-between rounded-2xl border border-indigo-500/30 bg-indigo-500/10 p-4">
                        <div className="flex items-center gap-3">
                          <div className="rounded-xl bg-indigo-500/20 p-2 text-indigo-300">
                            <Bug className="h-5 w-5" />
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-white text-sm">
                                {selectedError.ticket_key}
                              </span>
                              <span className="rounded bg-indigo-500/20 px-2 py-0.5 text-[10px] font-bold text-indigo-300 uppercase">
                                {selectedError.ticket_status || 'Auto Ticket'}
                              </span>
                            </div>
                            <p className="text-xs text-indigo-200/80 truncate max-w-md mt-0.5">
                              {selectedError.ticket_title || `[CRASH] ${selectedError.exception_type}`}
                            </p>
                          </div>
                        </div>

                        {onOpenBoard && (
                          <button
                            onClick={onOpenBoard}
                            className="inline-flex items-center gap-1 rounded-xl bg-indigo-600 px-3 py-2 text-xs font-semibold text-white hover:bg-indigo-500 transition-colors"
                          >
                            <ExternalLink className="h-3.5 w-3.5" />{tr('v7.runtime.detail.open_board')}</button>
                        )}
                      </div>
                    )}

                    {/* Diagnostics Metadata */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      <div className="rounded-xl bg-black/30 p-3">
                        <span className="text-[10px] text-slate-500 block">{tr('v7.runtime.detail.occurrences')}</span>
                        <b className="text-sm text-white mt-0.5 block">
                          {selectedError.occurrences_count}
                        </b>
                      </div>
                      <div className="rounded-xl bg-black/30 p-3">
                        <span className="text-[10px] text-slate-500 block">{tr('v7.runtime.detail.environment')}</span>
                        <b className="text-sm text-emerald-400 mt-0.5 block">
                          {selectedError.latest_occurrence?.environment || 'production'}
                        </b>
                      </div>
                      <div className="rounded-xl bg-black/30 p-3">
                        <span className="text-[10px] text-slate-500 block">{tr('v7.runtime.detail.http')}</span>
                        <b className="text-sm text-rose-400 mt-0.5 block">
                          {selectedError.latest_occurrence?.status_code || 500}
                        </b>
                      </div>
                      <div className="rounded-xl bg-black/30 p-3">
                        <span className="text-[10px] text-slate-500 block">{tr('v7.runtime.detail.release')}</span>
                        <b className="text-sm text-slate-300 mt-0.5 block truncate">
                          {selectedError.latest_occurrence?.release || 'current'}
                        </b>
                      </div>
                    </div>

                    {/* Request ID */}
                    {selectedError.latest_occurrence?.request_id && (
                      <div className="flex items-center justify-between rounded-xl bg-black/30 px-3 py-2 text-xs">
                        <span className="text-slate-400">Request ID:</span>
                        <div className="flex items-center gap-2">
                          <code className="font-mono text-indigo-300 text-[11px]">
                            {selectedError.latest_occurrence.request_id}
                          </code>
                          <button
                            onClick={() =>
                              copy(selectedError.latest_occurrence!.request_id!, 'req_id')
                            }
                            className="text-slate-400 hover:text-white"
                          >
                            {copiedId === 'req_id' ? (
                              <Check className="h-3 w-3 text-emerald-400" />
                            ) : (
                              <Copy className="h-3 w-3" />
                            )}
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Stack Trace */}
                    <div>
                      <div className="mb-2 flex items-center justify-between">
                        <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                          <Layers className="h-3.5 w-3.5 text-indigo-400" />{tr('v7.runtime.detail.stack')}</h4>
                        <span className="text-[10px] text-slate-500">
                          {tr('v7.runtime.detail.frames', { count: selectedError.latest_occurrence?.stack.length || 0 })}
                        </span>
                      </div>

                      {loadingDetail ? (
                        <div className="flex h-32 items-center justify-center">
                          <Loader2 className="h-5 w-5 animate-spin text-slate-500" />
                        </div>
                      ) : selectedError.latest_occurrence?.stack &&
                        selectedError.latest_occurrence.stack.length > 0 ? (
                        <div className="rounded-2xl border border-white/10 bg-slate-950 p-3 font-mono text-xs divide-y divide-white/5 max-h-72 overflow-y-auto">
                          {selectedError.latest_occurrence.stack.map((frame, index) => (
                            <div key={index} className="py-2 first:pt-0 last:pb-0">
                              <div className="flex items-center justify-between text-slate-400">
                                <span className="text-indigo-300 font-semibold truncate max-w-md">
                                  {frame.filename}
                                </span>
                                <span className="text-slate-500 text-[11px]">{tr('v7.runtime.detail.line', { line: frame.lineno })}</span>
                              </div>
                              <div className="mt-1 text-slate-200 pl-3 border-l-2 border-indigo-500/30">{tr('v7.runtime.detail.in_function')}<span className="text-amber-300">{frame.function}()</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="rounded-2xl border border-white/10 bg-slate-950 p-6 text-center text-xs text-slate-500 font-mono">{tr('v7.runtime.detail.no_stack')}</div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
