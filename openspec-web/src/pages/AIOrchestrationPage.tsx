import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft, Bot, Check, Copy, ExternalLink, GitBranch,
  RefreshCw, Rocket, ShieldCheck, Webhook,
} from 'lucide-react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

type AgentKind = 'web_ai' | 'jules' | 'github_label_agent' | 'external_agent';
type AutonomyMode = 'manual' | 'assisted' | 'autopilot_pr' | 'delivery';

type AutomationState = {
  ticket_id: string;
  provider: string;
  base_sha?: string | null;
  github_pr_number?: number | null;
  github_pr_url?: string | null;
  ci_state: string;
  preview_url?: string | null;
  orchestration_status: string;
  repair_attempts: number;
  last_check_summary?: Record<string, unknown>;
};

type AutomationConfig = {
  autonomy_mode: AutonomyMode;
  agent_kind: AgentKind;
  dispatch_label: string;
  auto_issue_sync: boolean;
  auto_dispatch_on_handoff: boolean;
  create_pr_from_patch: boolean;
  observe_ci: boolean;
  observe_preview: boolean;
  auto_move_to_review: boolean;
  max_repair_attempts: number;
  merge_policy: 'manual' | 'human_accept';
  protected_paths: string[];
  has_webhook_secret: boolean;
  webhook_url?: string | null;
};

type TicketRow = {
  id: string;
  key?: string | null;
  title: string;
  summary?: string;
  status: string;
  priority: string;
  node_title: string;
  github_issue_url?: string | null;
  github_issue_number?: number | null;
  automation?: AutomationState | null;
};

type Overview = {
  project: {
    id: string;
    slug: string;
    name: string;
    github_repo?: string | null;
    github_connected: boolean;
  };
  config: AutomationConfig;
  tickets: TicketRow[];
};

const statusKey: Record<string, string> = {
  idle: 'v7.ai_orchestration.status_idle',
  handoff_ready: 'v7.ai_orchestration.status_handoff',
  agent_dispatched: 'v7.ai_orchestration.status_dispatched',
  pr_created: 'v7.ai_orchestration.status_pr_open',
  pr_linked: 'v7.ai_orchestration.status_pr_open',
  pr_open: 'v7.ai_orchestration.status_pr_open',
  ci_running: 'v7.ai_orchestration.status_ci_running',
  repair_handoff_ready: 'v7.ai_orchestration.status_repair_handoff',
  native_repair_monitoring: 'v7.ai_orchestration.status_native_repair',
  blocked_repair_budget: 'v7.ai_orchestration.status_repair_blocked',
  ci_green_evidence_pending: 'v7.ai_orchestration.status_evidence_pending',
  preview_ready_for_human_review: 'v7.ai_orchestration.status_preview_ready',
  review_gate_ready: 'v7.ai_orchestration.status_review_ready',
  review_ready: 'v7.ai_orchestration.status_review_ready',
  merged_waiting_human_acceptance: 'v7.ai_orchestration.status_merged_waiting',
  pr_closed: 'v7.ai_orchestration.status_pr_closed',
};

function errorMessage(data: any, fallback: string) {
  return typeof data?.detail === 'string' ? data.detail : fallback;
}

export function AIOrchestrationPage() {
  const { projectSlug = '' } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [draft, setDraft] = useState<AutomationConfig | null>(null);
  const [selectedId, setSelectedId] = useState('');
  const [handoff, setHandoff] = useState<{ prompt: string; base_sha: string } | null>(null);
  const [aiAnswer, setAiAnswer] = useState('');
  const [prNumber, setPrNumber] = useState('');
  const [webhookSecret, setWebhookSecret] = useState('');
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [copied, setCopied] = useState('');
  const requestedTicket = useMemo(
    () => new URLSearchParams(location.search).get('ticket')?.trim() || '',
    [location.search],
  );

  const request = async (url: string, init: RequestInit = {}) => {
    const response = await fetch(url, {
      credentials: 'include',
      ...init,
      headers: {
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...(init.headers || {}),
      },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(errorMessage(data, `Request failed (${response.status})`));
    return data;
  };

  const load = async () => {
    setBusy('load');
    try {
      const data = await request(`/api/projects/${encodeURIComponent(projectSlug)}/automation/overview`);
      const tickets = (data.tickets || []) as TicketRow[];
      setOverview(data);
      setDraft(data.config);
      setSelectedId((current) => {
        const requested = requestedTicket
          ? tickets.find((ticket) => (
              ticket.id === requestedTicket
              || (ticket.key || '').toLowerCase() === requestedTicket.toLowerCase()
            ))
          : null;
        if (requested) return requested.id;
        if (current && tickets.some((ticket) => ticket.id === current)) return current;
        return tickets[0]?.id || '';
      });
    } catch (error: any) {
      setNotice({ ok: false, text: error?.message || t('v7.ai_orchestration.load_failed') });
    } finally {
      setBusy('');
    }
  };

  useEffect(() => { void load(); }, [projectSlug, requestedTicket]);

  const selected = useMemo(
    () => overview?.tickets.find((ticket) => ticket.id === selectedId) || overview?.tickets[0] || null,
    [overview, selectedId],
  );
  const state = selected?.automation || null;

  const copy = async (kind: string, text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(kind);
    window.setTimeout(() => setCopied(''), 1500);
  };

  const save = async () => {
    if (!draft) return;
    setBusy('save');
    try {
      const data = await request(`/api/projects/${encodeURIComponent(projectSlug)}/automation`, {
        method: 'PUT', body: JSON.stringify(draft),
      });
      setDraft(data);
      setNotice({ ok: true, text: t('v7.ai_orchestration.saved') });
      await load();
    } catch (error: any) {
      setNotice({ ok: false, text: error?.message || t('v7.ai_orchestration.save_failed') });
    } finally { setBusy(''); }
  };

  const generate = async (dispatch = false) => {
    if (!selected || !draft) return;
    setBusy(dispatch ? 'dispatch' : 'handoff');
    try {
      const data = await request(`/api/projects/${encodeURIComponent(projectSlug)}/tickets/${encodeURIComponent(selected.id)}/ai/handoff`, {
        method: 'POST',
        body: JSON.stringify({ provider: draft.agent_kind, dispatch }),
      });
      setHandoff(data);
      setNotice({ ok: true, text: dispatch ? t('v7.ai_orchestration.dispatched') : t('v7.ai_orchestration.handoff_ready') });
      await load();
    } catch (error: any) {
      setNotice({ ok: false, text: error?.message || t('v7.ai_orchestration.handoff_failed') });
    } finally { setBusy(''); }
  };

  const dispatch = async () => {
    if (!selected) return;
    setBusy('dispatch');
    try {
      await request(`/api/projects/${encodeURIComponent(projectSlug)}/tickets/${encodeURIComponent(selected.id)}/ai/dispatch`, { method: 'POST', body: '{}' });
      setNotice({ ok: true, text: t('v7.ai_orchestration.dispatched') });
      await load();
    } catch (error: any) {
      setNotice({ ok: false, text: error?.message || t('v7.ai_orchestration.handoff_failed') });
    } finally { setBusy(''); }
  };

  const applyPatch = async () => {
    if (!selected || !aiAnswer.trim()) return;
    setBusy('patch');
    try {
      const data = await request(`/api/projects/${encodeURIComponent(projectSlug)}/tickets/${encodeURIComponent(selected.id)}/ai/apply-patch`, {
        method: 'POST',
        body: JSON.stringify({ ai_answer: aiAnswer, base_sha: handoff?.base_sha || state?.base_sha || null }),
      });
      const number = data?.state?.github_pr_number;
      setNotice({ ok: true, text: t('v7.ai_orchestration.pr_created', { number }) });
      setAiAnswer('');
      await load();
    } catch (error: any) {
      setNotice({ ok: false, text: error?.message || t('v7.ai_orchestration.patch_failed') });
    } finally { setBusy(''); }
  };

  const linkPr = async () => {
    if (!selected || !prNumber.trim()) return;
    setBusy('link');
    try {
      await request(`/api/projects/${encodeURIComponent(projectSlug)}/tickets/${encodeURIComponent(selected.id)}/ai/link-pr`, {
        method: 'POST', body: JSON.stringify({ pr_number: Number(prNumber) }),
      });
      setPrNumber('');
      setNotice({ ok: true, text: t('v7.ai_orchestration.pr_linked') });
      await load();
    } catch (error: any) {
      setNotice({ ok: false, text: error?.message || t('v7.ai_orchestration.pr_link_failed') });
    } finally { setBusy(''); }
  };

  const reconcile = async () => {
    if (!selected) return;
    setBusy('reconcile');
    try {
      await request(`/api/projects/${encodeURIComponent(projectSlug)}/tickets/${encodeURIComponent(selected.id)}/ai/reconcile`, { method: 'POST', body: '{}' });
      setNotice({ ok: true, text: t('v7.ai_orchestration.reconciled') });
      await load();
    } catch (error: any) {
      setNotice({ ok: false, text: error?.message || t('v7.ai_orchestration.reconcile_failed') });
    } finally { setBusy(''); }
  };

  const rotateWebhook = async () => {
    setBusy('webhook');
    try {
      const data = await request(`/api/projects/${encodeURIComponent(projectSlug)}/automation/webhook-secret/rotate`, { method: 'POST', body: '{}' });
      setWebhookSecret(data.secret || '');
      setDraft((current) => current ? { ...current, has_webhook_secret: true, webhook_url: data.webhook_url } : current);
      setNotice({ ok: true, text: t('v7.ai_orchestration.webhook_rotated') });
    } catch (error: any) {
      setNotice({ ok: false, text: error?.message || t('v7.ai_orchestration.webhook_failed') });
    } finally { setBusy(''); }
  };

  if (!overview || !draft) {
    return <main className="min-h-screen p-6 text-[var(--vb-text)]"><button onClick={() => navigate('/app')} className="enterprise-icon-button" aria-label={t('v7.ai_orchestration.back')}><ArrowLeft className="h-4 w-4" /></button><p className="mt-8 text-sm text-[var(--vb-muted)]">{busy === 'load' ? t('v7.ai_orchestration.loading') : notice?.text || t('v7.ai_orchestration.load_failed')}</p></main>;
  }

  const providerDispatch = draft.agent_kind === 'jules' || draft.agent_kind === 'github_label_agent';
  const currentStatus = state?.orchestration_status || 'idle';
  const status = t(statusKey[currentStatus] || 'v7.ai_orchestration.status_unknown', { status: currentStatus });

  return (
    <main className="min-h-screen bg-[var(--vb-canvas)] px-4 py-6 text-[var(--vb-text)] sm:px-6">
      <div className="mx-auto max-w-7xl space-y-5">
        <header className="flex flex-col gap-4 border-b border-[var(--vb-border)] pb-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <button onClick={() => navigate('/app')} className="enterprise-icon-button" aria-label={t('v7.ai_orchestration.back')}><ArrowLeft className="h-4 w-4" /></button>
            <div><div className="flex items-center gap-2"><Bot className="h-5 w-5 text-[var(--vb-accent)]" /><h1 className="text-lg font-semibold">{t('v7.ai_orchestration.title')}</h1></div><p className="mt-1 max-w-3xl text-xs text-[var(--vb-muted)]">{t('v7.ai_orchestration.subtitle')}</p></div>
          </div>
          <button type="button" onClick={() => void load()} className="enterprise-icon-button" aria-label={t('v7.ai_orchestration.refresh')}><RefreshCw className="h-4 w-4" /></button>
        </header>

        {!overview.project.github_connected && <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-xs text-amber-200">{t('v7.ai_orchestration.github_required')}</div>}
        {notice && <div className={`rounded-xl border p-3 text-xs ${notice.ok ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300' : 'border-rose-500/25 bg-rose-500/10 text-rose-300'}`}>{notice.text}</div>}

        <section className="rounded-2xl border border-[var(--vb-border)] bg-[var(--vb-surface)] p-4 sm:p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div><h2 className="text-sm font-semibold">{t('v7.ai_orchestration.policy_title')}</h2><p className="mt-1 text-xs text-[var(--vb-muted)]">{t('v7.ai_orchestration.policy_desc')}</p></div>
            <button disabled={busy === 'save'} onClick={() => void save()} className="rounded-lg bg-[var(--vb-text)] px-4 py-2 text-xs font-semibold text-[var(--vb-canvas)] disabled:opacity-50">{t('v7.ai_orchestration.save_policy')}</button>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <label className="space-y-1 text-xs"><span className="text-[var(--vb-muted)]">{t('v7.ai_orchestration.autonomy')}</span><select value={draft.autonomy_mode} onChange={(e) => setDraft({ ...draft, autonomy_mode: e.target.value as AutonomyMode })} className="w-full rounded-lg border border-[var(--vb-border)] bg-[var(--vb-canvas-subtle)] p-2"><option value="manual">{t('v7.ai_orchestration.mode_manual')}</option><option value="assisted">{t('v7.ai_orchestration.mode_assisted')}</option><option value="autopilot_pr">{t('v7.ai_orchestration.mode_autopilot')}</option><option value="delivery">{t('v7.ai_orchestration.mode_delivery')}</option></select></label>
            <label className="space-y-1 text-xs"><span className="text-[var(--vb-muted)]">{t('v7.ai_orchestration.agent')}</span><select value={draft.agent_kind} onChange={(e) => { const kind = e.target.value as AgentKind; setDraft({ ...draft, agent_kind: kind, dispatch_label: kind === 'jules' ? 'jules' : kind === 'web_ai' ? '' : draft.dispatch_label, auto_dispatch_on_handoff: kind === 'web_ai' ? false : draft.auto_dispatch_on_handoff }); }} className="w-full rounded-lg border border-[var(--vb-border)] bg-[var(--vb-canvas-subtle)] p-2"><option value="web_ai">{t('v7.ai_orchestration.agent_web')}</option><option value="jules">{t('v7.ai_orchestration.agent_jules')}</option><option value="github_label_agent">{t('v7.ai_orchestration.agent_label')}</option><option value="external_agent">{t('v7.ai_orchestration.agent_external')}</option></select></label>
            <label className="space-y-1 text-xs"><span className="text-[var(--vb-muted)]">{t('v7.ai_orchestration.repair_budget')}</span><input type="number" min={0} max={5} value={draft.max_repair_attempts} onChange={(e) => setDraft({ ...draft, max_repair_attempts: Math.max(0, Math.min(5, Number(e.target.value))) })} className="w-full rounded-lg border border-[var(--vb-border)] bg-[var(--vb-canvas-subtle)] p-2" /></label>
          </div>
          {draft.agent_kind === 'github_label_agent' && <label className="mt-3 block space-y-1 text-xs"><span className="text-[var(--vb-muted)]">{t('v7.ai_orchestration.dispatch_label')}</span><input value={draft.dispatch_label} onChange={(e) => setDraft({ ...draft, dispatch_label: e.target.value })} className="w-full max-w-md rounded-lg border border-[var(--vb-border)] bg-[var(--vb-canvas-subtle)] p-2 font-mono" /></label>}
          <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {([
              ['auto_issue_sync', 'v7.ai_orchestration.auto_issue'],
              ['auto_dispatch_on_handoff', 'v7.ai_orchestration.auto_dispatch'],
              ['create_pr_from_patch', 'v7.ai_orchestration.create_pr'],
              ['observe_ci', 'v7.ai_orchestration.observe_ci'],
              ['observe_preview', 'v7.ai_orchestration.observe_preview'],
              ['auto_move_to_review', 'v7.ai_orchestration.auto_review'],
            ] as const).map(([field, label]) => <label key={field} className="flex items-center gap-2 rounded-lg border border-[var(--vb-border)] p-2.5 text-xs"><input type="checkbox" checked={draft[field]} disabled={field === 'auto_dispatch_on_handoff' && !providerDispatch} onChange={(e) => setDraft({ ...draft, [field]: e.target.checked })} /><span>{t(label)}</span></label>)}
          </div>
          <div className="mt-4 flex gap-2 rounded-xl border border-[var(--vb-border)] bg-[var(--vb-canvas-subtle)] p-3 text-xs text-[var(--vb-secondary)]"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[var(--vb-accent)]" /><span>{t('v7.ai_orchestration.human_boundary')}</span></div>
        </section>

        <section className="grid gap-4 lg:grid-cols-[300px_1fr]">
          <aside className="rounded-2xl border border-[var(--vb-border)] bg-[var(--vb-surface)] p-3"><h2 className="px-1 text-sm font-semibold">{t('v7.ai_orchestration.tickets')}</h2><div className="mt-3 max-h-[680px] space-y-1 overflow-y-auto">{overview.tickets.length === 0 ? <p className="p-3 text-xs text-[var(--vb-muted)]">{t('v7.ai_orchestration.no_tickets')}</p> : overview.tickets.map((ticket) => { const s = ticket.automation?.orchestration_status || 'idle'; return <button key={ticket.id} onClick={() => { setSelectedId(ticket.id); setHandoff(null); setAiAnswer(''); setPrNumber(''); }} className={`w-full rounded-xl border p-3 text-left ${selected?.id === ticket.id ? 'border-[var(--vb-accent)] bg-[var(--vb-accent-soft)]' : 'border-transparent hover:border-[var(--vb-border)]'}`}><div className="flex justify-between gap-2"><span className="font-mono text-[10px] text-[var(--vb-accent)]">{ticket.key || ticket.id.slice(0, 8)}</span><span className="text-[10px] text-[var(--vb-muted)]">{ticket.status}</span></div><p className="mt-1 line-clamp-2 text-xs font-semibold">{ticket.title}</p><p className="mt-2 text-[10px] text-[var(--vb-muted)]">{t(statusKey[s] || 'v7.ai_orchestration.status_unknown', { status: s })}</p></button>; })}</div></aside>

          <div className="space-y-4">
            {selected ? <>
              <div className="rounded-2xl border border-[var(--vb-border)] bg-[var(--vb-surface)] p-4 sm:p-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:justify-between"><div><span className="font-mono text-xs text-[var(--vb-accent)]">{selected.key || selected.id.slice(0, 8)}</span><h2 className="mt-1 text-base font-semibold">{selected.title}</h2><p className="mt-1 text-xs text-[var(--vb-muted)]">{selected.node_title}</p></div><div className="flex flex-wrap gap-2">{selected.github_issue_url && <a href={selected.github_issue_url} target="_blank" rel="noreferrer" className="rounded-lg border border-[var(--vb-border)] px-3 py-2 text-xs">Issue #{selected.github_issue_number} <ExternalLink className="inline h-3 w-3" /></a>}{state?.github_pr_url && <a href={state.github_pr_url} target="_blank" rel="noreferrer" className="rounded-lg border border-[var(--vb-border)] px-3 py-2 text-xs">PR #{state.github_pr_number} <ExternalLink className="inline h-3 w-3" /></a>}{state?.preview_url && <a href={state.preview_url} target="_blank" rel="noreferrer" className="rounded-lg bg-emerald-500/15 px-3 py-2 text-xs text-emerald-300">{t('v7.ai_orchestration.open_preview')} <ExternalLink className="inline h-3 w-3" /></a>}</div></div>
                <div className="mt-4 grid gap-2 sm:grid-cols-3"><div className="rounded-lg border border-[var(--vb-border)] p-3"><p className="text-[10px] text-[var(--vb-muted)]">{t('v7.ai_orchestration.state')}</p><p className="mt-1 text-xs font-semibold">{status}</p></div><div className="rounded-lg border border-[var(--vb-border)] p-3"><p className="text-[10px] text-[var(--vb-muted)]">CI</p><p className="mt-1 text-xs font-semibold">{state?.ci_state || 'not_started'}</p></div><div className="rounded-lg border border-[var(--vb-border)] p-3"><p className="text-[10px] text-[var(--vb-muted)]">{t('v7.ai_orchestration.repairs')}</p><p className="mt-1 text-xs font-semibold">{state?.repair_attempts || 0}/{draft.max_repair_attempts}</p></div></div>
                <div className="mt-4 flex flex-wrap gap-2"><button disabled={!overview.project.github_connected || busy === 'handoff'} onClick={() => void generate(false)} className="rounded-lg bg-[var(--vb-accent)] px-3 py-2 text-xs font-semibold text-white disabled:opacity-40"><Bot className="mr-1 inline h-3.5 w-3.5" />{t('v7.ai_orchestration.generate_handoff')}</button>{providerDispatch && <button disabled={!overview.project.github_connected || busy === 'dispatch'} onClick={() => void dispatch()} className="rounded-lg border border-[var(--vb-border)] px-3 py-2 text-xs font-semibold"><Rocket className="mr-1 inline h-3.5 w-3.5" />{t('v7.ai_orchestration.dispatch_agent')}</button>}{state?.github_pr_number && <button disabled={busy === 'reconcile'} onClick={() => void reconcile()} className="rounded-lg border border-[var(--vb-border)] px-3 py-2 text-xs font-semibold"><RefreshCw className="mr-1 inline h-3.5 w-3.5" />{t('v7.ai_orchestration.reconcile')}</button>}</div>
              </div>

              {handoff && <div className="rounded-2xl border border-[var(--vb-border)] bg-[var(--vb-surface)] p-4"><div className="flex items-center justify-between"><h3 className="text-sm font-semibold">{t('v7.ai_orchestration.handoff_prompt')}</h3><button onClick={() => void copy('prompt', handoff.prompt)} className="rounded-lg border border-[var(--vb-border)] px-3 py-1.5 text-xs">{copied === 'prompt' ? <Check className="inline h-3.5 w-3.5" /> : <Copy className="inline h-3.5 w-3.5" />} {t(copied === 'prompt' ? 'v7.ai_orchestration.copied' : 'v7.ai_orchestration.copy_prompt')}</button></div><p className="mt-1 text-xs text-[var(--vb-muted)]">{t('v7.ai_orchestration.handoff_prompt_desc')}</p><pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap rounded-xl border border-[var(--vb-border)] bg-[var(--vb-canvas-subtle)] p-3 text-[11px]">{handoff.prompt}</pre></div>}

              <div className="rounded-2xl border border-[var(--vb-border)] bg-[var(--vb-surface)] p-4"><h3 className="text-sm font-semibold">{t('v7.ai_orchestration.paste_answer')}</h3><p className="mt-1 text-xs text-[var(--vb-muted)]">{t('v7.ai_orchestration.paste_answer_desc')}</p><textarea rows={8} value={aiAnswer} onChange={(e) => setAiAnswer(e.target.value)} placeholder="VIBEUS-PATCH v1" className="mt-3 w-full rounded-xl border border-[var(--vb-border)] bg-[var(--vb-canvas-subtle)] p-3 font-mono text-xs" /><button disabled={!aiAnswer.trim() || busy === 'patch'} onClick={() => void applyPatch()} className="mt-3 rounded-lg bg-[var(--vb-text)] px-4 py-2 text-xs font-semibold text-[var(--vb-canvas)] disabled:opacity-40"><GitBranch className="mr-1 inline h-3.5 w-3.5" />{t('v7.ai_orchestration.patch_pr')}</button></div>

              {!state?.github_pr_number && <div className="rounded-2xl border border-[var(--vb-border)] bg-[var(--vb-surface)] p-4"><h3 className="text-sm font-semibold">{t('v7.ai_orchestration.link_pr')}</h3><p className="mt-1 text-xs text-[var(--vb-muted)]">{t('v7.ai_orchestration.link_pr_desc')}</p><div className="mt-3 flex gap-2"><input type="number" min={1} value={prNumber} onChange={(e) => setPrNumber(e.target.value)} className="w-40 rounded-lg border border-[var(--vb-border)] bg-[var(--vb-canvas-subtle)] px-3 py-2 text-xs" /><button disabled={!prNumber || busy === 'link'} onClick={() => void linkPr()} className="rounded-lg border border-[var(--vb-border)] px-3 py-2 text-xs font-semibold">{t('v7.ai_orchestration.link_pr')}</button></div></div>}
            </> : null}
          </div>
        </section>

        <section className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-2xl border border-[var(--vb-border)] bg-[var(--vb-surface)] p-4"><div className="flex items-center gap-2"><Webhook className="h-4 w-4 text-[var(--vb-accent)]" /><h2 className="text-sm font-semibold">{t('v7.ai_orchestration.webhook_title')}</h2></div><p className="mt-1 text-xs text-[var(--vb-muted)]">{t('v7.ai_orchestration.webhook_desc')}</p>{draft.webhook_url && <div className="mt-3 flex gap-2"><code className="min-w-0 flex-1 truncate rounded-lg border border-[var(--vb-border)] bg-[var(--vb-canvas-subtle)] p-2 text-[10px]">{draft.webhook_url}</code><button onClick={() => void copy('webhook', draft.webhook_url || '')} className="enterprise-icon-button"><Copy className="h-3.5 w-3.5" /></button></div>}<button disabled={busy === 'webhook'} onClick={() => void rotateWebhook()} className="mt-3 rounded-lg border border-[var(--vb-border)] px-3 py-2 text-xs font-semibold">{draft.has_webhook_secret ? t('v7.ai_orchestration.rotate_secret') : t('v7.ai_orchestration.create_secret')}</button>{webhookSecret && <div className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3"><p className="text-xs text-amber-200">{t('v7.ai_orchestration.secret_once')}</p><div className="mt-2 flex gap-2"><code className="min-w-0 flex-1 break-all text-[10px]">{webhookSecret}</code><button onClick={() => void copy('secret', webhookSecret)} className="enterprise-icon-button"><Copy className="h-3.5 w-3.5" /></button></div></div>}</div>
          <div className="rounded-2xl border border-[var(--vb-border)] bg-[var(--vb-surface)] p-4"><div className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-[var(--vb-accent)]" /><h2 className="text-sm font-semibold">{t('v7.ai_orchestration.guardrails')}</h2></div><ul className="mt-3 space-y-2 text-xs text-[var(--vb-secondary)]"><li>• {t('v7.ai_orchestration.guardrail_branch')}</li><li>• {t('v7.ai_orchestration.guardrail_sha')}</li><li>• {t('v7.ai_orchestration.guardrail_paths')}</li><li>• {t('v7.ai_orchestration.guardrail_budget')}</li><li>• {t('v7.ai_orchestration.guardrail_evidence')}</li><li>• {t('v7.ai_orchestration.guardrail_review')}</li></ul></div>
        </section>
      </div>
    </main>
  );
}