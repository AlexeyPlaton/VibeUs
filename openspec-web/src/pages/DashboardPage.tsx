import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import i18n, { tr } from '../i18n/config';
import { LanguageSwitcher } from '../components/LanguageSwitcher';
import {
  Activity,
  AlertTriangle,
  BookOpen,
  Check,
  Copy,
  CreditCard,
  ExternalLink,
  KanbanSquare,
  KeyRound,
  Loader2,
  LogOut,
  Plus,
  RefreshCw,
  Shield,
  Sparkles,
  Trash2,
  Zap,
} from 'lucide-react';
import { RuntimeErrorsModal } from '../components/RuntimeErrorsModal';
import { OnboardingGuideModal } from '../components/OnboardingGuideModal';
import { ProjectBoardModal } from '../components/ProjectBoardModal';
import { chooseInitialMarket, displayPrice, fetchPricing, rememberMarket, type PricingCatalog, type PricingMarket } from '../utils/pricing';

type Tier = 'free' | 'solo' | 'studio' | 'business';

type Workspace = {
  id: string;
  name: string;
  owner_email: string;
  subscription_tier: Tier;
  subscription_status: string;
  current_period_end?: string | null;
  is_lifetime_free?: boolean;
};

type WorkspaceSummary = Workspace & {
  effective_tier: Tier;
  project_count: number;
  project_limit: number;
};

type ProjectItem = {
  id: string;
  workspace_id: string;
  name: string;
  slug: string;
  description: string;
  public_widget_key?: string | null;
  ingest_key_configured: boolean;
  runtime_error_tracking_enabled?: boolean;
  api_token_configured: boolean;
  created_at: string;
};

const PLAN_LABEL: Record<Tier, string> = {
  free: tr('v7.dashboard.plans.free'),
  solo: tr('v7.dashboard.plans.solo'),
  studio: tr('v7.dashboard.plans.studio'),
  business: tr('v7.dashboard.plans.business'),
};

function apiUrl() {
  return window.location.origin.includes('localhost') ? 'http://localhost:8000' : window.location.origin;
}

async function readError(res: Response, fallback: string) {
  const data = await res.json().catch(() => ({}));
  if (typeof data?.detail === 'string') return data.detail;
  if (typeof data?.message === 'string') return data.message;
  return fallback;
}

export function DashboardPage() {
  const [authChecked, setAuthChecked] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [email, setEmail] = useState('');
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceId, setWorkspaceId] = useState('');
  const [summary, setSummary] = useState<WorkspaceSummary | null>(null);
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [newApiToken, setNewApiToken] = useState<{ slug: string; token: string } | null>(null);
  const [newIngestKey, setNewIngestKey] = useState<{ slug: string; key: string } | null>(null);
  const [activeErrorsProject, setActiveErrorsProject] = useState<ProjectItem | null>(null);
  const [activeGuideProject, setActiveGuideProject] = useState<ProjectItem | null>(null);
  const [activeBoardProject, setActiveBoardProject] = useState<ProjectItem | null>(null);
  const [pricing, setPricing] = useState<PricingCatalog | null>(null);
  const [market, setMarket] = useState<PricingMarket>('ru');
  const [promoCode, setPromoCode] = useState('');
  const [promoNotice, setPromoNotice] = useState<string | null>(null);

  const selectedWorkspace = useMemo(
    () => workspaces.find((ws) => ws.id === workspaceId) || null,
    [workspaces, workspaceId],
  );

  const refresh = async (preferredWorkspaceId?: string) => {
    setLoading(true);
    setError(null);
    try {
      const base = apiUrl();
      const wsRes = await fetch(`${base}/api/workspaces`, { credentials: 'include' });
      if (wsRes.status === 401) {
        setAuthenticated(false);
        return;
      }
      if (!wsRes.ok) throw new Error(await readError(wsRes, tr('v7.dashboard.errors.workspace_load')));
      const wsList: Workspace[] = await wsRes.json();
      setWorkspaces(wsList);
      if (!wsList.length) {
        setSummary(null);
        setProjects([]);
        setWorkspaceId('');
        return;
      }
      const saved = preferredWorkspaceId || localStorage.getItem('vibeus_workspace_id') || '';
      const chosen = (wsList.some((ws) => ws.id === saved) ? saved : wsList[0]?.id) || '';
      setWorkspaceId(chosen);
      localStorage.setItem('vibeus_workspace_id', chosen);

      const [summaryRes, projectsRes] = await Promise.all([
        fetch(`${base}/api/workspaces/${chosen}/summary`, { credentials: 'include' }),
        fetch(`${base}/api/workspaces/${chosen}/projects`, { credentials: 'include' }),
      ]);
      if (!summaryRes.ok) throw new Error(await readError(summaryRes, tr('v7.dashboard.errors.tier_load')));
      if (!projectsRes.ok) throw new Error(await readError(projectsRes, tr('v7.dashboard.errors.projects_load')));
      setSummary(await summaryRes.json());
      setProjects(await projectsRes.json());
    } catch (e: any) {
      setError(e?.message || tr('v7.dashboard.errors.dashboard'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPricing(apiUrl())
      .then((catalog) => {
        setPricing(catalog);
        setMarket(chooseInitialMarket(catalog, new URLSearchParams(window.location.search).get('market')));
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    fetch(`${apiUrl()}/api/auth/me`, { credentials: 'include' })
      .then(async (res) => {
        if (!res.ok) return;
        const user = await res.json();
        setAuthenticated(true);
        setEmail(user.email || '');
        await refresh();
      })
      .catch(() => undefined)
      .finally(() => setAuthChecked(true));
  }, []);

  const chooseWorkspace = async (id: string) => {
    localStorage.setItem('vibeus_workspace_id', id);
    setWorkspaceId(id);
    await refresh(id);
  };

  const copy = async (value: string, id: string) => {
    await navigator.clipboard.writeText(value);
    setCopied(id);
    window.setTimeout(() => setCopied(null), 1600);
  };

  const startCheckout = async (tier: 'solo' | 'studio') => {
    if (!workspaceId) return;
    setBusy(`billing:${tier}`);
    setError(null);
    try {
      const activeMarket = market;
      const marketData = pricing?.markets?.[activeMarket];
      if (activeMarket === 'global' && marketData && !marketData.billing_enabled) {
        throw new Error(tr('v7.dashboard.errors.global_disabled'));
      }

      if (activeMarket === 'global') {
        const res = await fetch(`${apiUrl()}/api/billing/create-checkout-session`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            workspace_id: workspaceId,
            tier,
            success_url: `${window.location.origin}/app?payment=return&market=global`,
            cancel_url: `${window.location.origin}/app?payment=cancel&market=global`,
          }),
        });
        if (!res.ok) throw new Error(await readError(res, tr('v7.dashboard.errors.global_payment')));
        const data = await res.json();
        if (!data.checkout_url) throw new Error(tr('v7.dashboard.errors.checkout_url'));
        window.location.assign(data.checkout_url);
        return;
      }

      const res = await fetch(`${apiUrl()}/api/billing/yookassa/create-payment`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspace_id: workspaceId,
          tier,
          return_url: `${window.location.origin}/app?payment=return&market=ru`,
        }),
      });
      if (!res.ok) throw new Error(await readError(res, tr('v7.dashboard.errors.payment_create')));
      const data = await res.json();
      if (!data.confirmation_url) throw new Error(tr('v7.dashboard.errors.confirmation_url'));
      window.location.assign(data.confirmation_url);
    } catch (e: any) {
      setError(e?.message || tr('v7.dashboard.errors.payment'));
      setBusy(null);
    }
  };

  const redeemPromo = async () => {
    if (!workspaceId || !promoCode.trim()) return;
    setBusy('promo');
    setError(null);
    setPromoNotice(null);
    try {
      const res = await fetch(`${apiUrl()}/api/workspaces/${workspaceId}/redeem-promo`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: promoCode.trim() }),
      });
      if (!res.ok) throw new Error(await readError(res, tr('v7.dashboard.errors.promo')));
      const data = await res.json();
      const days = data.promo_duration_days;
      setPromoNotice(days ? tr('v7.dashboard.promo.activated', { tier: data.subscription_tier?.toUpperCase?.() || tr('v7.dashboard.promo.default_tier'), days }) : tr('v7.dashboard.promo.activated_simple'));
      setPromoCode('');
      await refresh(workspaceId);
    } catch (e: any) {
      setError(e?.message || tr('v7.dashboard.errors.promo_generic'));
    } finally {
      setBusy(null);
    }
  };

  const rotateApiToken = async (project: ProjectItem) => {
    if (!workspaceId) return;
    if (!window.confirm(tr('v7.dashboard.confirm.api_rotate', { name: project.name }))) return;
    setBusy(`api:${project.slug}`);
    setError(null);
    try {
      const res = await fetch(`${apiUrl()}/api/workspaces/${workspaceId}/projects/${project.slug}/rotate-api-token`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) throw new Error(await readError(res, tr('v7.dashboard.errors.api_rotate')));
      const data = await res.json();
      setNewApiToken({ slug: project.slug, token: data.token });
    } catch (e: any) {
      setError(e?.message || tr('v7.dashboard.errors.api_rotate_generic'));
    } finally {
      setBusy(null);
    }
  };

  const rotatePublicKey = async (project: ProjectItem) => {
    if (!workspaceId) return;
    const warning = project.public_widget_key
      ? tr('v7.dashboard.confirm.public_rotate', { name: project.name })
      : tr('v7.dashboard.confirm.public_create', { name: project.name });
    if (!window.confirm(warning)) return;
    setBusy(`pub:${project.slug}`);
    setError(null);
    try {
      const res = await fetch(`${apiUrl()}/api/workspaces/${workspaceId}/projects/${project.slug}/rotate-public-key`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) throw new Error(await readError(res, tr('v7.dashboard.errors.public_rotate')));
      const data = await res.json();
      setProjects((current) => current.map((item) => (
        item.slug === project.slug ? { ...item, public_widget_key: data.public_widget_key } : item
      )));
    } catch (e: any) {
      setError(e?.message || tr('v7.dashboard.errors.public_rotate_generic'));
    } finally {
      setBusy(null);
    }
  };

  const rotateIngestKey = async (project: ProjectItem) => {
    if (!workspaceId) return;
    const warning = project.ingest_key_configured
      ? tr('v7.dashboard.confirm.ingest_rotate', { name: project.name })
      : tr('v7.dashboard.confirm.ingest_create', { name: project.name });
    if (!window.confirm(warning)) return;
    setBusy(`ingest:${project.slug}`);
    setError(null);
    try {
      const res = await fetch(`${apiUrl()}/api/workspaces/${workspaceId}/projects/${project.slug}/rotate-ingest-key`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) throw new Error(await readError(res, tr('v7.dashboard.errors.ingest_rotate')));
      const data = await res.json();
      setNewIngestKey({ slug: project.slug, key: data.ingest_key });
      setProjects((current) => current.map((item) => (
        item.slug === project.slug ? { ...item, ingest_key_configured: true } : item
      )));
    } catch (e: any) {
      setError(e?.message || tr('v7.dashboard.errors.ingest_rotate_generic'));
    } finally {
      setBusy(null);
    }
  };

  const setRuntimeTracking = async (project: ProjectItem, enabled: boolean) => {
    if (!workspaceId) return;
    setBusy(`runtime:${project.slug}`);
    setError(null);
    try {
      const res = await fetch(`${apiUrl()}/api/workspaces/${workspaceId}/projects/${project.slug}/settings`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runtime_error_tracking_enabled: enabled }),
      });
      if (!res.ok) throw new Error(await readError(res, tr('v7.dashboard.errors.runtime_toggle')));
      const data = await res.json();
      setProjects((current) => current.map((item) => (
        item.slug === project.slug
          ? { ...item, runtime_error_tracking_enabled: Boolean(data.runtime_error_tracking_enabled) }
          : item
      )));
    } catch (e: any) {
      setError(e?.message || tr('v7.dashboard.errors.runtime_toggle_generic'));
    } finally {
      setBusy(null);
    }
  };

  const deleteProject = async (project: ProjectItem) => {
    if (!workspaceId) return;
    const typed = window.prompt(tr('v7.dashboard.confirm.delete', { name: project.name, slug: project.slug }));
    if (typed !== project.slug) return;
    setBusy(`delete:${project.slug}`);
    setError(null);
    try {
      const res = await fetch(
        `${apiUrl()}/api/workspaces/${workspaceId}/projects/${project.slug}?confirmation_slug=${encodeURIComponent(project.slug)}`,
        { method: 'DELETE', credentials: 'include' },
      );
      if (!res.ok) throw new Error(await readError(res, tr('v7.dashboard.errors.delete_project')));
      await refresh(workspaceId);
    } catch (e: any) {
      setError(e?.message || tr('v7.dashboard.errors.delete_project_generic'));
    } finally {
      setBusy(null);
    }
  };

  const logout = async () => {
    await fetch(`${apiUrl()}/api/auth/logout`, { method: 'POST', credentials: 'include' }).catch(() => undefined);
    window.location.assign('/');
  };

  const soloPrice = tr('v7.common.price_period', { price: displayPrice(pricing, market, 'solo'), days: pricing?.period_days || 30 });
  const studioPrice = tr('v7.common.price_period', { price: displayPrice(pricing, market, 'studio'), days: pricing?.period_days || 30 });
  const globalVisible = Boolean(pricing?.markets.global.visible);
  const changeMarket = (next: PricingMarket) => { setMarket(next); rememberMarket(next); };

  if (!authChecked) {
    return <div className="min-h-screen grid place-items-center bg-slate-950 text-white"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  }

  if (!authenticated) {
    return (
      <div className="min-h-screen grid place-items-center bg-slate-950 px-5 text-white">
        <div className="max-w-md rounded-3xl border border-white/10 bg-white/5 p-8 text-center">
          <h1 className="text-2xl font-bold">{tr('v7.dashboard.auth.title')}</h1>
          <p className="mt-3 text-sm text-slate-400">{tr('v7.dashboard.auth.copy')}</p>
          <Link to="/create?next=app" className="mt-6 inline-flex rounded-xl bg-white px-5 py-3 text-sm font-semibold text-slate-950">{tr('v7.dashboard.auth.sign_in')}</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="border-b border-white/10 bg-slate-950/90">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4">
          <Link to="/" className="font-bold tracking-tight">VibeUs <span className="text-slate-500 font-medium">{tr('v7.dashboard.labels.brand_space')}</span></Link>
          <div className="flex items-center gap-3 text-sm text-slate-400"><LanguageSwitcher compact />
            <span className="hidden sm:inline">{email}</span>
            <button onClick={logout} className="rounded-lg border border-white/10 p-2 hover:bg-white/5" title={tr('v7.dashboard.nav.logout')}><LogOut className="h-4 w-4" /></button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-5 py-8">
        {error && <div className="mb-6 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">{error}</div>}

        <section className="grid gap-5 lg:grid-cols-[1.35fr_.65fr]">
          <div className="rounded-3xl border border-white/10 bg-white/[0.035] p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-[.2em] text-slate-500">{tr('v7.dashboard.labels.workspace')}</p>
                {workspaces.length > 1 ? (
                  <select value={workspaceId} onChange={(e) => chooseWorkspace(e.target.value)} className="mt-2 rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-lg font-semibold">
                    {workspaces.map((ws) => <option key={ws.id} value={ws.id}>{ws.name}</option>)}
                  </select>
                ) : <h1 className="mt-1 text-3xl font-bold">{selectedWorkspace?.name || tr('v7.dashboard.labels.default_workspace')}</h1>}
              </div>
              <Link to="/create" className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-slate-950"><Plus className="h-4 w-4" />{tr('v7.dashboard.workspace.new_project')}</Link>
            </div>

            <div className="mt-6 grid gap-3 sm:grid-cols-3">
              <div className="rounded-2xl bg-black/20 p-4"><span className="text-xs text-slate-500">{tr('v7.dashboard.workspace.plan')}</span><b className="mt-1 block text-xl">{summary ? PLAN_LABEL[summary.effective_tier] : '—'}</b></div>
              <div className="rounded-2xl bg-black/20 p-4"><span className="text-xs text-slate-500">{tr('v7.dashboard.workspace.projects')}</span><b className="mt-1 block text-xl">{summary ? `${summary.project_count} / ${summary.project_limit >= 100000 ? '∞' : summary.project_limit}` : '—'}</b></div>
              <div className="rounded-2xl bg-black/20 p-4"><span className="text-xs text-slate-500">{tr('v7.dashboard.workspace.access_until')}</span><b className="mt-1 block text-base">{summary?.current_period_end ? new Intl.DateTimeFormat(i18n.resolvedLanguage || 'en').format(new Date(summary.current_period_end)) : tr('v7.dashboard.workspace.no_payment')}</b></div>
            </div>
          </div>

          <div className="rounded-3xl border border-indigo-400/20 bg-indigo-500/10 p-6">
            <div className="flex items-center gap-2 text-indigo-200"><CreditCard className="h-5 w-5" /><b>{tr('v7.dashboard.billing.title')}</b></div>
            <p className="mt-2 text-sm text-indigo-100/70">{tr('v7.dashboard.billing.copy')}</p>
            {globalVisible && <div className="mt-4 flex gap-2 text-xs"><button type="button" onClick={() => changeMarket('ru')} className={`rounded-lg px-2.5 py-1.5 ${market === 'ru' ? 'bg-white text-slate-950' : 'border border-white/20 text-white'}`}>{tr('v7.dashboard.market.ru')}</button><button type="button" onClick={() => changeMarket('global')} className={`rounded-lg px-2.5 py-1.5 ${market === 'global' ? 'bg-white text-slate-950' : 'border border-white/20 text-white'}`}>{tr('v7.dashboard.labels.international')}</button></div>}
            <div className="mt-5 grid grid-cols-2 gap-2">
              <button onClick={() => startCheckout('solo')} disabled={busy !== null} className="rounded-xl bg-white px-3 py-2.5 text-sm font-semibold text-slate-950 disabled:opacity-50">{busy === 'billing:solo' ? '...' : `Solo · ${soloPrice}`}</button>
              <button onClick={() => startCheckout('studio')} disabled={busy !== null} className="rounded-xl border border-white/20 px-3 py-2.5 text-sm font-semibold disabled:opacity-50">{busy === 'billing:studio' ? '...' : `Studio · ${studioPrice}`}</button>
            </div>
            <div className="mt-4 border-t border-white/10 pt-4">
              <div className="text-xs font-semibold text-indigo-100">{tr('v7.dashboard.promo.title')}</div>
              <div className="mt-2 flex gap-2"><input value={promoCode} onChange={(e) => setPromoCode(e.target.value.toUpperCase())} placeholder="FOUNDING-SOLO30" className="min-w-0 flex-1 rounded-xl border border-white/15 bg-slate-950/60 px-3 py-2 text-sm text-white outline-none" /><button type="button" onClick={redeemPromo} disabled={busy !== null || !promoCode.trim()} className="rounded-xl border border-white/20 px-3 py-2 text-sm font-semibold disabled:opacity-50">{busy === 'promo' ? '...' : tr('v7.dashboard.promo.activate')}</button></div>
              {promoNotice && <p className="mt-2 text-xs text-emerald-300">{promoNotice}</p>}
            </div>
          </div>
        </section>

        {/* Onboarding Quickstart Banner */}
        <section className="mt-8 rounded-3xl border border-white/10 bg-gradient-to-br from-indigo-950/40 via-slate-900/60 to-slate-950 p-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 text-indigo-400">
                <Sparkles className="h-4 w-4" />
                <span className="text-xs uppercase font-bold tracking-wider">{tr('v7.dashboard.quick.kicker')}</span>
              </div>
              <h2 className="mt-1 text-xl font-bold text-white">{tr('v7.dashboard.quick.title')}</h2>
              <p className="mt-1 text-xs text-slate-400">{tr('v7.dashboard.quick.copy')}</p>
            </div>
            {projects[0] && (
              <button
                onClick={() => setActiveGuideProject(projects[0] || null)}
                className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2 text-xs font-bold text-slate-950 hover:bg-slate-200 transition-colors"
              >
                <Zap className="h-3.5 w-3.5" />{tr('v7.dashboard.quick.guide')}</button>
            )}
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
              <div className="flex items-center justify-between">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500/20 text-xs font-bold text-emerald-300">
                  ✓
                </span>
                <span className="text-[10px] font-mono text-emerald-400">{tr('v7.dashboard.quick.done')}</span>
              </div>
              <b className="mt-2 block text-sm text-white">{tr('v7.dashboard.quick.step1')}</b>
              <p className="mt-1 text-xs text-slate-400">
                {projects.length ? tr('v7.dashboard.quick.active_projects', { count: projects.length }) : tr('v7.dashboard.quick.create_first')}
              </p>
            </div>

            <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
              <div className="flex items-center justify-between">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-indigo-500/20 text-xs font-bold text-indigo-300">
                  2
                </span>
                <span className="text-[10px] font-mono text-indigo-400">{tr('v7.dashboard.quick.widget_badge')}</span>
              </div>
              <b className="mt-2 block text-sm text-white">{tr('v7.dashboard.quick.step2')}</b>
              <p className="mt-1 text-xs text-slate-400">
                {tr('v7.dashboard.quick.step2_copy')}
              </p>
            </div>

            <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
              <div className="flex items-center justify-between">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-rose-500/20 text-xs font-bold text-rose-300">
                  3
                </span>
                <span className="text-[10px] font-mono text-rose-400">{tr('v7.dashboard.quick.crashes')}</span>
              </div>
              <b className="mt-2 block text-sm text-white">{tr('v7.dashboard.labels.runtime_bridge_step')}</b>
              <p className="mt-1 text-xs text-slate-400">{tr('v7.dashboard.quick.crashes_copy')}</p>
            </div>

            <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
              <div className="flex items-center justify-between">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-amber-500/20 text-xs font-bold text-amber-300">
                  4
                </span>
                <span className="text-[10px] font-mono text-amber-400">{tr('v7.dashboard.quick.ai_badge')}</span>
              </div>
              <b className="mt-2 block text-sm text-white">{tr('v7.dashboard.quick.step4')}</b>
              <p className="mt-1 text-xs text-slate-400">
                {tr('v7.dashboard.quick.step4_copy')}
              </p>
            </div>
          </div>
        </section>

        <section className="mt-8">
          <div className="mb-4 flex items-center justify-between">
            <div><p className="text-xs uppercase tracking-[.2em] text-slate-500">{tr('v7.dashboard.labels.projects_kicker')}</p><h2 className="mt-1 text-2xl font-bold">{tr('v7.dashboard.projects.title')}</h2></div>
            <button onClick={() => refresh(workspaceId)} className="rounded-lg border border-white/10 p-2 text-slate-400 hover:bg-white/5" title={tr('v7.dashboard.projects.refresh')}><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /></button>
          </div>

          {!projects.length && !loading ? (
            <div className="rounded-3xl border border-dashed border-white/15 p-10 text-center text-slate-400">
              <p>{tr('v7.dashboard.projects.empty')}</p>
              <Link to="/create" className="mt-4 inline-flex rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-slate-950">{tr('v7.dashboard.projects.create_first')}</Link>
            </div>
          ) : (
            <div className="grid gap-4">
              {projects.map((project) => {
                const embed = project.public_widget_key
                  ? `<script src="${apiUrl()}/static/vibus-widget.umd.cjs" data-project="${project.slug}" data-public-key="${project.public_widget_key}" data-server="${apiUrl()}" data-mode="public_feedback" async></script>`
                  : '';
                return (
                  <article key={project.id} className="rounded-3xl border border-white/10 bg-white/[0.035] p-5">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div><h3 className="text-lg font-bold">{project.name}</h3><code className="text-xs text-slate-500">{project.slug}</code>{project.description && <p className="mt-2 max-w-2xl text-sm text-slate-400">{project.description}</p>}</div>
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          onClick={() => setActiveBoardProject(project)}
                          className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-indigo-500 transition-colors shadow-sm"
                          title={tr('v7.dashboard.projects.board_title')}
                        >
                          <KanbanSquare className="h-3.5 w-3.5" />{tr('v7.dashboard.projects.board')}</button>
                        <button
                          onClick={() => setActiveErrorsProject(project)}
                          className="inline-flex items-center gap-1.5 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3.5 py-2 text-xs font-semibold text-rose-300 hover:bg-rose-500/20 transition-colors"
                          title={tr('v7.dashboard.projects.runtime_title')}
                        >
                          <Activity className="h-3.5 w-3.5" />{tr('v7.dashboard.projects.runtime')}</button>
                        <button
                          onClick={() => setActiveGuideProject(project)}
                          className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-slate-300 hover:bg-white/10 transition-colors"
                          title={tr('v7.dashboard.projects.quickstart_title')}
                        >
                          <BookOpen className="h-3.5 w-3.5" />{tr('v7.dashboard.projects.quickstart')}</button>
                        <button onClick={() => deleteProject(project)} disabled={busy !== null} className="rounded-xl border border-red-400/20 p-2 text-red-300 hover:bg-red-500/10 transition-colors" title={tr('v7.dashboard.projects.delete')}><Trash2 className="h-4 w-4" /></button>
                      </div>
                    </div>


                    <div className="mt-5 grid gap-3 lg:grid-cols-3">
                      <div className="rounded-2xl bg-black/20 p-4">
                        <div className="flex items-center gap-2 text-sm font-semibold"><Shield className="h-4 w-4 text-emerald-400" /> {tr('v7.dashboard.labels.public_widget_key')}</div>
                        {project.public_widget_key ? (
                          <><code className="mt-3 block overflow-hidden text-ellipsis whitespace-nowrap text-xs text-emerald-200">{project.public_widget_key}</code><div className="mt-3 flex flex-wrap gap-2"><button onClick={() => copy(project.public_widget_key!, `pub:${project.slug}`)} className="rounded-lg bg-white px-3 py-2 text-xs font-semibold text-slate-950">{copied === `pub:${project.slug}` ? <Check className="inline h-3 w-3" /> : <Copy className="inline h-3 w-3" />} {tr('v7.dashboard.projects.copy')}</button><button onClick={() => rotatePublicKey(project)} disabled={busy !== null} className="rounded-lg border border-white/10 px-3 py-2 text-xs">{tr('v7.dashboard.projects.rotate')}</button>{embed && <button onClick={() => copy(embed, `embed:${project.slug}`)} className="rounded-lg border border-white/10 px-3 py-2 text-xs">{tr('v7.dashboard.projects.widget_code')}</button>}</div></>
                        ) : (
                          <><div className="mt-3 flex gap-2 rounded-xl border border-amber-400/20 bg-amber-400/10 p-3 text-xs text-amber-100"><AlertTriangle className="h-4 w-4 shrink-0" />{tr('v7.dashboard.projects.old_public_digest')}</div><button onClick={() => rotatePublicKey(project)} disabled={busy !== null} className="mt-3 rounded-lg bg-white px-3 py-2 text-xs font-semibold text-slate-950">{tr('v7.dashboard.projects.create_public')}</button></>
                        )}
                      </div>

                      <div className="rounded-2xl bg-black/20 p-4">
                        <div className="flex items-center gap-2 text-sm font-semibold"><Activity className="h-4 w-4 text-rose-400" /> {tr('v7.dashboard.labels.runtime_ingest_key')}</div>
                        <p className="mt-3 text-xs text-slate-400">{tr('v7.dashboard.projects.secret_once')}</p>
                        <div className="mt-3 flex flex-wrap items-center gap-2">
                          <span className={`rounded px-2 py-1 text-[10px] font-semibold ${project.ingest_key_configured ? 'bg-emerald-500/10 text-emerald-300' : 'bg-amber-500/10 text-amber-200'}`}>{project.ingest_key_configured ? tr('v7.dashboard.projects.key_configured') : tr('v7.dashboard.projects.key_missing')}</span>
                          <span className={`rounded px-2 py-1 text-[10px] font-semibold ${project.runtime_error_tracking_enabled ? 'bg-rose-500/15 text-rose-200' : 'bg-slate-500/15 text-slate-300'}`}>{project.runtime_error_tracking_enabled ? tr('v7.dashboard.projects.collection_on') : tr('v7.dashboard.projects.collection_off')}</span>
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <button onClick={() => rotateIngestKey(project)} disabled={busy !== null} className="rounded-lg border border-white/10 px-3 py-2 text-xs">{project.ingest_key_configured ? tr('v7.dashboard.projects.rotate_ingest') : tr('v7.dashboard.projects.create_ingest')}</button>
                          <button onClick={() => setRuntimeTracking(project, !project.runtime_error_tracking_enabled)} disabled={busy !== null} className="rounded-lg border border-white/10 px-3 py-2 text-xs">{project.runtime_error_tracking_enabled ? tr('v7.dashboard.projects.disable_collection') : tr('v7.dashboard.projects.enable_collection')}</button>
                        </div>
                      </div>

                      <div className="rounded-2xl bg-black/20 p-4">
                        <div className="flex items-center gap-2 text-sm font-semibold"><KeyRound className="h-4 w-4 text-indigo-400" /> {tr('v7.dashboard.labels.api_token')}</div>
                        <p className="mt-3 text-xs text-slate-400">{tr('v7.dashboard.projects.api_digest')}</p>
                        <button onClick={() => rotateApiToken(project)} disabled={busy !== null} className="mt-3 rounded-lg border border-white/10 px-3 py-2 text-xs">{tr('v7.dashboard.projects.rotate_api')}</button>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </main>

      {newApiToken && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/75 p-5">
          <div className="w-full max-w-xl rounded-3xl border border-white/10 bg-slate-900 p-6 shadow-2xl">
            <div className="flex items-center gap-2 text-emerald-300"><KeyRound className="h-5 w-5" /><b>{tr('v7.dashboard.modals.new_api')}</b></div>
            <p className="mt-3 text-sm text-slate-300">{tr('v7.dashboard.modals.new_api_copy')}</p>
            <code className="mt-4 block break-all rounded-xl bg-black/40 p-4 text-sm text-cyan-200">{newApiToken.token}</code>
            <div className="mt-5 flex justify-end gap-2"><button onClick={() => copy(newApiToken.token, 'new-api')} className="rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-slate-950"><Copy className="mr-1 inline h-4 w-4" /> {copied === 'new-api' ? tr('v7.dashboard.common.copied') : tr('v7.dashboard.projects.copy')}</button><button onClick={() => setNewApiToken(null)} className="rounded-xl border border-white/10 px-4 py-2.5 text-sm">{tr('v7.dashboard.common.saved')}</button></div>
          </div>
        </div>
      )}

      {newIngestKey && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/75 p-5">
          <div className="w-full max-w-xl rounded-3xl border border-white/10 bg-slate-900 p-6 shadow-2xl">
            <div className="flex items-center gap-2 text-rose-300"><Activity className="h-5 w-5" /><b>{tr('v7.dashboard.modals.new_ingest')}</b></div>
            <p className="mt-3 text-sm text-slate-300">{tr('v7.dashboard.modals.new_ingest_copy')}</p>
            <code className="mt-4 block break-all rounded-xl bg-black/40 p-4 text-sm text-rose-200">{newIngestKey.key}</code>
            <div className="mt-5 flex justify-end gap-2"><button onClick={() => copy(newIngestKey.key, 'new-ingest')} className="rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-slate-950"><Copy className="mr-1 inline h-4 w-4" /> {copied === 'new-ingest' ? tr('v7.dashboard.common.copied') : tr('v7.dashboard.projects.copy')}</button><button onClick={() => setNewIngestKey(null)} className="rounded-xl border border-white/10 px-4 py-2.5 text-sm">{tr('v7.dashboard.common.saved')}</button></div>
          </div>
        </div>
      )}

      {activeErrorsProject && (
        <RuntimeErrorsModal
          workspaceId={workspaceId}
          project={activeErrorsProject}
          serverUrl={apiUrl()}
          isOpen={Boolean(activeErrorsProject)}
          onClose={() => setActiveErrorsProject(null)}
          onOpenBoard={() => {
            const p = activeErrorsProject;
            setActiveErrorsProject(null);
            setActiveBoardProject(p);
          }}
        />
      )}

      {activeGuideProject && (
        <OnboardingGuideModal
          project={activeGuideProject}
          serverUrl={apiUrl()}
          isOpen={Boolean(activeGuideProject)}
          onClose={() => setActiveGuideProject(null)}
          onOpenBoard={() => {
            const p = activeGuideProject;
            setActiveGuideProject(null);
            setActiveBoardProject(p);
          }}
          onOpenErrors={() => {
            const p = activeGuideProject;
            setActiveGuideProject(null);
            setActiveErrorsProject(p);
          }}
        />
      )}

      {activeBoardProject && (
        <ProjectBoardModal
          project={activeBoardProject}
          serverUrl={apiUrl()}
          isOpen={Boolean(activeBoardProject)}
          onClose={() => setActiveBoardProject(null)}
        />
      )}
    </div>
  );
}
