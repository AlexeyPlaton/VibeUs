import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { tr } from '../i18n/config';
import { LanguageSwitcher } from '../components/LanguageSwitcher';
import {
  Activity,
  ArrowRight,
  CheckCircle2,
  Copy,
  CreditCard,
  Key,
  Loader2,
  LogIn,
  LogOut,
  Shield,
  Terminal,
  User,
  UserPlus,
} from 'lucide-react';
import { chooseInitialMarket, displayPrice, fetchPricing, rememberMarket, type PricingCatalog, type PricingMarket } from '../utils/pricing';

type Plan = 'free' | 'solo' | 'studio';

type Workspace = {
  id: string;
  name: string;
  subscription_tier: Plan | 'business';
  subscription_status: string;
  current_period_end?: string | null;
};

type WorkspaceSummary = Workspace & {
  effective_tier: Plan | 'business';
  project_count: number;
  project_limit: number;
};

type ProjectResult = {
  token: string;
  public_widget_key: string;
  ingest_key: string;
  slug: string;
  name: string;
};

type ProjectDraft = {
  name: string;
  slug: string;
  description: string;
  selectedPlan: Plan;
  workspaceId?: string;
  market?: PricingMarket;
};

const DRAFT_KEY = 'vibeus_project_draft_v2';
const PLAN_RANK: Record<string, number> = { free: 0, solo: 1, studio: 2, business: 3 };
const PLAN_INFO: Record<Plan, { title: string; projects: string }> = {
  free: { title: tr('v7.create.plan.free_title'), projects: tr('v7.create.plan.free_projects') },
  solo: { title: 'Solo', projects: tr('v7.create.plan.solo_projects') },
  studio: { title: 'Studio', projects: tr('v7.create.plan.studio_projects') },
};

function getApiUrl() {
  return window.location.origin.includes('localhost') ? 'http://localhost:8000' : window.location.origin;
}

function extractErrorMessage(data: any, fallback: string): string {
  if (!data) return fallback;
  if (typeof data === 'string') return data;
  if (typeof data.detail === 'string') return data.detail;
  if (Array.isArray(data.detail)) return data.detail.map((d: any) => d?.msg || d?.message || JSON.stringify(d)).join(', ');
  if (typeof data.error === 'string') return data.error;
  if (data.error && typeof data.error === 'object' && typeof data.error.message === 'string') return data.error.message;
  if (typeof data.message === 'string') return data.message;
  return fallback;
}

export function CreateProjectPage() {
  const navigate = useNavigate();
  const configuredLegalVersion = import.meta.env.VITE_LEGAL_VERSION as string | undefined;
  const legalVersion = configuredLegalVersion || 'dev-draft';
  const legalVersionReady = !import.meta.env.PROD || Boolean(configuredLegalVersion);
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const planParam = params.get('plan');
  const initialPlan: Plan = planParam === 'solo' || planParam === 'studio' ? planParam : 'free';
  const nextParam = params.get('next');
  const requestedMarket = params.get('market');

  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);
  const [userEmail, setUserEmail] = useState('');
  const [workspaceId, setWorkspaceId] = useState('');
  const [workspaceSummary, setWorkspaceSummary] = useState<WorkspaceSummary | null>(null);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [authEmailInput, setAuthEmailInput] = useState('');
  const [authPasswordInput, setAuthPasswordInput] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [legalAccepted, setLegalAccepted] = useState(false);

  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [description, setDescription] = useState('');
  const [selectedPlan, setSelectedPlan] = useState<Plan>(initialPlan);
  const [loading, setLoading] = useState(false);
  const [paymentChecking, setPaymentChecking] = useState(false);
  const [paymentNotice, setPaymentNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ProjectResult | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [showToken, setShowToken] = useState(false);
  const [pricing, setPricing] = useState<PricingCatalog | null>(null);
  const [market, setMarket] = useState<PricingMarket>('ru');
  const [promoInput, setPromoInput] = useState(() => {
    return params.get('promo')?.trim().toUpperCase() || '';
  });
  const [promoAppliedNotice, setPromoAppliedNotice] = useState<string | null>(null);
  const [promoRedeeming, setPromoRedeeming] = useState(false);

  useEffect(() => {
    try {
      const src = params.get('src') || params.get('utm_source');
      if (src) sessionStorage.setItem('vibeus_attribution_src', src);
      const pendingPromo = sessionStorage.getItem('vibeus_pending_promo');
      if (!promoInput && pendingPromo) {
        setPromoInput(pendingPromo);
      }
    } catch {}
  }, []);

  const tryRedeemPromo = async (wsId: string, codeToRedeem?: string) => {
    const code = (codeToRedeem || promoInput).trim().toUpperCase();
    if (!wsId || !code) return;
    setPromoRedeeming(true);
    try {
      const res = await fetch(`${getApiUrl()}/api/workspaces/${wsId}/redeem-promo`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        const days = data.promo_duration_days || 30;
        setPromoAppliedNotice(tr('v7.create.promo.activated', { tier: data.subscription_tier?.toUpperCase() || '', days }));
        sessionStorage.removeItem('vibeus_pending_promo');
        await fetchSummary(wsId);
      } else {
        setError(extractErrorMessage(data, tr('v7.create.errors.promo_apply')));
      }
    } catch (e: any) {
      setError(e?.message || tr('v7.create.errors.promo_activate'));
    } finally {
      setPromoRedeeming(false);
    }
  };

  const saveDraft = (override?: Partial<ProjectDraft>) => {
    const draft: ProjectDraft = {
      name,
      slug,
      description,
      selectedPlan,
      ...(workspaceId ? { workspaceId } : {}),
      market,
      ...override,
    };
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  };

  const loadDraft = () => {
    try {
      const raw = sessionStorage.getItem(DRAFT_KEY);
      if (!raw) return null;
      const draft = JSON.parse(raw) as ProjectDraft;
      if (draft.name) setName(draft.name);
      if (draft.slug) setSlug(draft.slug);
      if (typeof draft.description === 'string') setDescription(draft.description);
      if (draft.selectedPlan === 'free' || draft.selectedPlan === 'solo' || draft.selectedPlan === 'studio') setSelectedPlan(draft.selectedPlan);
      if (draft.workspaceId) setWorkspaceId(draft.workspaceId);
      if (draft.market === 'ru' || draft.market === 'global') setMarket(draft.market);
      return draft;
    } catch {
      return null;
    }
  };

  const fetchSummary = async (id: string): Promise<WorkspaceSummary> => {
    const res = await fetch(`${getApiUrl()}/api/workspaces/${id}/summary`, { credentials: 'include' });
    if (!res.ok) throw new Error(extractErrorMessage(await res.json().catch(() => ({})), tr('v7.create.errors.workspace_tier')));
    const summary = await res.json();
    setWorkspaceSummary(summary);
    return summary;
  };

  const ensureWorkspace = async (): Promise<string> => {
    if (workspaceId) return workspaceId;
    const listRes = await fetch(`${getApiUrl()}/api/workspaces`, { credentials: 'include' });
    if (!listRes.ok) throw new Error(tr('v7.create.errors.workspace_load'));
    const workspaces: Workspace[] = await listRes.json();
    if (workspaces[0]?.id) {
      setWorkspaceId(workspaces[0].id);
      localStorage.setItem('vibeus_workspace_id', workspaces[0].id);
      if (promoInput.trim() && !promoAppliedNotice) {
        await tryRedeemPromo(workspaces[0].id, promoInput.trim());
      } else {
        await fetchSummary(workspaces[0].id);
      }
      return workspaces[0].id;
    }

    let firstTouchSource: string | undefined;
    try {
      firstTouchSource = sessionStorage.getItem('vibeus_attribution_src') || undefined;
    } catch {}

    const createRes = await fetch(`${getApiUrl()}/api/workspaces`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: tr('v7.create.workspace.default_name'),
        ...(firstTouchSource ? { first_touch_source: firstTouchSource } : {}),
      }),
    });
    if (!createRes.ok) throw new Error(extractErrorMessage(await createRes.json().catch(() => ({})), tr('v7.create.errors.workspace_create')));
    const created = await createRes.json();
    setWorkspaceId(created.id);
    localStorage.setItem('vibeus_workspace_id', created.id);
    if (promoInput.trim() && !promoAppliedNotice) {
      await tryRedeemPromo(created.id, promoInput.trim());
    } else {
      await fetchSummary(created.id);
    }
    return created.id;
  };

  const createProject = async (draft?: ProjectDraft) => {
    const source = draft || { name, slug, description, selectedPlan, workspaceId, market };
    const id = source.workspaceId || await ensureWorkspace();
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`${getApiUrl()}/api/projects`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: source.name.trim(),
          slug: source.slug.trim(),
          description: source.description.trim(),
          workspace_id: id,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (response.status === 402) {
          setPaymentNotice(tr('v7.create.errors.limit_reached'));
        }
        if (response.status === 409) throw new Error(tr('v7.create.errors.slug_exists'));
        throw new Error(extractErrorMessage(data, tr('v7.create.errors.project_create')));
      }
      setResult({ token: data.token || '', public_widget_key: data.public_widget_key || '', ingest_key: data.ingest_key || '', slug: data.slug, name: data.name });
      sessionStorage.removeItem(DRAFT_KEY);
      await fetchSummary(id);
    } finally {
      setLoading(false);
    }
  };

  const startCheckout = async (plan: 'solo' | 'studio', draft?: ProjectDraft) => {
    setLoading(true);
    setError(null);
    setPaymentNotice(null);
    try {
      const id = draft?.workspaceId || await ensureWorkspace();
      const activeMarket = draft?.market || market;
      const source: ProjectDraft = draft || { name, slug, description, selectedPlan: plan, workspaceId: id, market: activeMarket };
      source.selectedPlan = plan;
      source.workspaceId = id;
      source.market = activeMarket;
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify(source));

      const marketData = pricing?.markets?.[activeMarket];
      if (activeMarket === 'global' && marketData && !marketData.billing_enabled) {
        throw new Error(tr('v7.create.errors.global_disabled'));
      }

      const returnUrl = `${window.location.origin}/create?payment=return&plan=${plan}&market=${activeMarket}`;
      if (activeMarket === 'global') {
        const res = await fetch(`${getApiUrl()}/api/billing/create-checkout-session`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            workspace_id: id,
            tier: plan,
            success_url: returnUrl,
            cancel_url: `${window.location.origin}/create?plan=${plan}&market=${activeMarket}&payment=cancel`,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(extractErrorMessage(data, tr('v7.create.errors.global_payment')));
        if (!data.checkout_url) throw new Error(tr('v7.create.errors.checkout_url'));
        window.location.assign(data.checkout_url);
        return;
      }

      const res = await fetch(`${getApiUrl()}/api/billing/yookassa/create-payment`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspace_id: id, tier: plan, return_url: returnUrl }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(extractErrorMessage(data, tr('v7.create.errors.payment_create')));
      if (!data.confirmation_url) throw new Error(tr('v7.create.errors.confirmation_url'));
      window.location.assign(data.confirmation_url);
    } catch (e: any) {
      setError(e?.message || tr('v7.create.errors.payment'));
      setLoading(false);
    }
  };

  const continueSubmit = async () => {
    const id = await ensureWorkspace();
    const summary = workspaceSummary || await fetchSummary(id);
    const draft: ProjectDraft = { name, slug, description, selectedPlan, workspaceId: id, market };
    saveDraft({ workspaceId: id });

    const currentRank = PLAN_RANK[summary.effective_tier] ?? 0;
    const requestedRank = PLAN_RANK[selectedPlan] ?? 0;
    if (requestedRank > currentRank && selectedPlan !== 'free') {
      await startCheckout(selectedPlan, draft);
      return;
    }
    await createProject(draft);
  };

  const verifyPaymentAndCreate = async (draft: ProjectDraft) => {
    if (!draft.workspaceId || draft.selectedPlan === 'free') return;
    setPaymentChecking(true);
    setPaymentNotice(tr('v7.create.payment.checking'));
    try {
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const summary = await fetchSummary(draft.workspaceId);
        if (summary && (PLAN_RANK[summary.effective_tier] ?? 0) >= (PLAN_RANK[draft.selectedPlan] ?? 0)) {
          setPaymentNotice(tr('v7.create.payment.confirmed'));
          await createProject(draft);
          window.history.replaceState({}, document.title, '/create');
          setPaymentNotice(null);
          return;
        }
        await new Promise((resolve) => window.setTimeout(resolve, 1200));
      }
      setPaymentNotice(tr('v7.create.payment.pending'));
    } catch (e: any) {
      setError(e?.message || tr('v7.create.errors.payment_verify'));
    } finally {
      setPaymentChecking(false);
    }
  };

  useEffect(() => {
    fetchPricing(getApiUrl())
      .then((catalog) => {
        setPricing(catalog);
        const chosen = chooseInitialMarket(catalog, requestedMarket);
        setMarket(chosen);
        rememberMarket(chosen);
      })
      .catch(() => undefined);
  }, [requestedMarket]);

  useEffect(() => {
    const draft = loadDraft();
    fetch(`${getApiUrl()}/api/auth/me`, { credentials: 'include' })
      .then(async (res) => {
        if (!res.ok) return;
        const data = await res.json();
        setIsAuthenticated(true);
        setUserEmail(data.email || '');
        const id = draft?.workspaceId || localStorage.getItem('vibeus_workspace_id') || '';
        if (id) {
          setWorkspaceId(id);
          await fetchSummary(id).catch(() => undefined);
        }
        if (nextParam === 'app') navigate('/app', { replace: true });
        if (params.get('payment') === 'return' && draft) await verifyPaymentAndCreate(draft);
      })
      .catch(() => undefined)
      .finally(() => setAuthChecked(true));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleAuthSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setAuthLoading(true);
    setAuthError(null);
    try {
      if (authMode === 'register') {
        if (!legalVersionReady) throw new Error(tr('v7.create.errors.legal_version'));
        const regRes = await fetch(`${getApiUrl()}/api/auth/register`, {
          method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: authEmailInput.trim(), password: authPasswordInput, accept_terms: legalAccepted, terms_version: legalVersion, privacy_version: legalVersion }),
        });
        if (!regRes.ok) throw new Error(extractErrorMessage(await regRes.json().catch(() => ({})), tr('v7.create.errors.registration')));
      }
      const loginRes = await fetch(`${getApiUrl()}/api/auth/browser-login`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: authEmailInput.trim(), password: authPasswordInput }),
      });
      if (!loginRes.ok) throw new Error(extractErrorMessage(await loginRes.json().catch(() => ({})), tr('v7.create.errors.credentials')));
      setIsAuthenticated(true);
      setUserEmail(authEmailInput.trim());
      setAuthPasswordInput('');
      if (nextParam === 'app') navigate('/app');
      else await ensureWorkspace();
    } catch (err: any) {
      setAuthError(err?.message || tr('v7.create.errors.auth'));
    } finally {
      setAuthLoading(false);
    }
  };

  const logout = async () => {
    await fetch(`${getApiUrl()}/api/auth/logout`, { method: 'POST', credentials: 'include' }).catch(() => undefined);
    setIsAuthenticated(false);
    setUserEmail('');
    setWorkspaceId('');
    setWorkspaceSummary(null);
  };

  const handleName = (value: string) => {
    setName(value);
    if (!result) setSlug(value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''));
  };

  const copy = async (value: string, id: string) => {
    await navigator.clipboard.writeText(value);
    setCopied(id);
    window.setTimeout(() => setCopied(null), 1600);
  };

  const widgetCode = result ? `<script src="${getApiUrl()}/static/vibus-widget.umd.cjs" data-project="${result.slug}" data-public-key="${result.public_widget_key}" data-server="${getApiUrl()}" data-mode="public_feedback" async></script>` : '';
  const cliCommand = result ? `npx vibus listen --project ${result.slug} --token ${result.token}` : '';
  const priceFor = (plan: Plan) => plan === 'free' ? '0' : tr('v7.common.price_period', { price: displayPrice(pricing, market, plan), days: pricing?.period_days || 30 });
  const globalVisible = Boolean(pricing?.markets.global.visible);

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-10 text-slate-900 sm:px-6">
      <div className="mx-auto max-w-3xl">
        <div className="mb-7 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3"><Link to="/" className="text-sm font-medium text-slate-500 hover:text-slate-900">{tr('v7.create.nav.home')}</Link><LanguageSwitcher compact /></div>
          {isAuthenticated && <div className="flex items-center gap-3"><Link to="/app" className="text-sm font-semibold text-indigo-700">{tr('v7.create.nav.dashboard')}</Link><span className="hidden text-xs text-slate-500 sm:inline">{userEmail}</span><button onClick={logout} title={tr('v7.create.nav.logout')}><LogOut className="h-4 w-4 text-slate-400" /></button></div>}
        </div>

        <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
          <header className="bg-slate-950 px-7 py-6 text-white">
            <h1 className="text-2xl font-bold">{tr('v7.create.header.title')}</h1>
            <p className="mt-2 text-sm text-slate-400">{tr('v7.create.header.subtitle')}</p>
          </header>

          {!authChecked ? (
            <div className="grid min-h-72 place-items-center"><Loader2 className="h-6 w-6 animate-spin text-indigo-600" /></div>
          ) : !isAuthenticated ? (
            <div className="p-7">
              <div className="mb-6 rounded-xl border border-indigo-100 bg-indigo-50 p-4 text-sm text-indigo-900"><Shield className="mr-2 inline h-4 w-4" />{tr('v7.create.auth.notice')}</div>
              <div className="mb-6 flex border-b border-slate-200">
                <button onClick={() => setAuthMode('login')} className={`mr-6 border-b-2 pb-3 text-sm font-semibold ${authMode === 'login' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-500'}`}><LogIn className="mr-1 inline h-4 w-4" />{tr('v7.create.auth.login')}</button>
                <button onClick={() => setAuthMode('register')} className={`border-b-2 pb-3 text-sm font-semibold ${authMode === 'register' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-500'}`}><UserPlus className="mr-1 inline h-4 w-4" />{tr('v7.create.auth.register')}</button>
              </div>
              {authError && <div className="mb-5 rounded-xl border border-red-100 bg-red-50 p-4 text-sm text-red-700">{authError}</div>}
              <form onSubmit={handleAuthSubmit} className="space-y-4">
                <input type="email" required value={authEmailInput} onChange={(e) => setAuthEmailInput(e.target.value)} placeholder="developer@example.com" className="w-full rounded-xl border border-slate-300 px-4 py-3 outline-none focus:border-indigo-500" />
                <input type="password" required minLength={authMode === 'register' ? 12 : 1} value={authPasswordInput} onChange={(e) => setAuthPasswordInput(e.target.value)} placeholder={authMode === 'register' ? tr('v7.create.auth.password_new') : tr('v7.create.auth.password')} className="w-full rounded-xl border border-slate-300 px-4 py-3 outline-none focus:border-indigo-500" />
                {authMode === 'register' && <label className="flex gap-3 rounded-xl bg-slate-50 p-3 text-xs leading-relaxed text-slate-600"><input type="checkbox" required checked={legalAccepted} onChange={(e) => setLegalAccepted(e.target.checked)} className="mt-1" /><span>{tr('v7.create.auth.accept_prefix')}<Link to="/legal/offer" target="_blank" className="text-indigo-700 underline">{tr('v7.create.auth.offer')}</Link>{tr('v7.create.auth.privacy_prefix')}<Link to="/legal/privacy" target="_blank" className="text-indigo-700 underline">{tr('v7.create.auth.privacy')}</Link>.</span></label>}
                <button disabled={authLoading || (authMode === 'register' && (!legalAccepted || !legalVersionReady))} className="flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-3 font-semibold text-white disabled:opacity-50">{authLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : authMode === 'login' ? tr('v7.create.auth.login_continue') : tr('v7.create.auth.register_action')}</button>
              </form>
            </div>
          ) : result ? (
            <div className="space-y-6 p-7">
              <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-4 text-emerald-900"><CheckCircle2 className="mr-2 inline h-5 w-5" /><b>{tr('v7.create.success.created', { name: result.name })}</b><p className="mt-1 text-sm text-emerald-700">{tr('v7.create.success.secret_notice')}</p></div>

              <section><div className="mb-2 flex items-center justify-between"><b className="text-sm"><Key className="mr-1 inline h-4 w-4 text-indigo-600" />{tr('v7.create.labels.api_token')}</b><span className="rounded bg-amber-50 px-2 py-1 text-[11px] font-semibold text-amber-700">{tr('v7.create.labels.one_time_secret')}</span></div><div className="flex gap-2 rounded-xl border bg-slate-50 p-2"><input readOnly type={showToken ? 'text' : 'password'} value={result.token} className="min-w-0 flex-1 bg-transparent px-2 font-mono text-sm outline-none" /><button onClick={() => setShowToken(!showToken)} className="rounded-lg border bg-white px-3 text-xs">{showToken ? tr('v7.create.success.hide') : tr('v7.create.success.show')}</button><button onClick={() => copy(result.token, 'api')} className="rounded-lg bg-slate-900 px-3 text-xs text-white">{copied === 'api' ? tr('v7.create.common.copied') : tr('v7.create.common.copy')}</button></div></section>

              <section><div className="mb-2 flex items-center justify-between"><b className="text-sm"><Shield className="mr-1 inline h-4 w-4 text-emerald-600" />{tr('v7.create.labels.public_widget_key')}</b><span className="rounded bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-700">{tr('v7.create.success.public_badge')}</span></div><div className="flex gap-2 rounded-xl border bg-slate-50 p-2"><input readOnly value={result.public_widget_key} className="min-w-0 flex-1 bg-transparent px-2 font-mono text-sm outline-none" /><button onClick={() => copy(result.public_widget_key, 'pub')} className="rounded-lg bg-white px-3 text-xs shadow-sm">{copied === 'pub' ? tr('v7.create.common.copied') : tr('v7.create.common.copy')}</button></div></section>

              <section><div className="mb-2 flex items-center justify-between"><b className="text-sm"><Activity className="mr-1 inline h-4 w-4 text-rose-600" />{tr('v7.create.labels.runtime_ingest_key')}</b><span className="rounded bg-amber-50 px-2 py-1 text-[11px] font-semibold text-amber-700">{tr('v7.create.labels.one_time_secret')}</span></div><div className="flex gap-2 rounded-xl border bg-slate-50 p-2"><input readOnly type="password" value={result.ingest_key} className="min-w-0 flex-1 bg-transparent px-2 font-mono text-sm outline-none" /><button onClick={() => copy(result.ingest_key, 'ingest')} className="rounded-lg bg-slate-900 px-3 text-xs text-white">{copied === 'ingest' ? tr('v7.create.common.copied') : tr('v7.create.common.copy')}</button></div><p className="mt-2 text-[11px] text-slate-500">{tr('v7.create.success.ingest_help')}</p></section>

              <section><b className="text-sm">{tr('v7.create.success.widget_code')}</b><pre className="mt-2 overflow-x-auto rounded-xl bg-slate-950 p-4 text-xs text-cyan-300">{widgetCode}</pre><button onClick={() => copy(widgetCode, 'widget')} className="mt-2 text-xs font-semibold text-indigo-700"><Copy className="mr-1 inline h-3 w-3" />{copied === 'widget' ? tr('v7.create.common.copied') : tr('v7.create.common.copy_code')}</button></section>
              <section><b className="text-sm">{tr('v7.create.labels.command_line')}</b><pre className="mt-2 overflow-x-auto rounded-xl bg-indigo-50 p-4 text-xs text-indigo-900"><Terminal className="mr-1 inline h-4 w-4" />{cliCommand}</pre></section>

              <div className="flex flex-col gap-2 border-t pt-5 sm:flex-row"><Link to="/app" className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white">{tr('v7.create.success.open_dashboard')}<ArrowRight className="h-4 w-4" /></Link><button onClick={() => { setResult(null); setName(''); setSlug(''); setDescription(''); }} className="rounded-xl border px-4 py-3 text-sm font-semibold">{tr('v7.create.success.create_another')}</button></div>
            </div>
          ) : (
            <form onSubmit={(e) => { e.preventDefault(); continueSubmit().catch((err) => setError(err?.message || tr('v7.create.common.error'))); }} className="space-y-6 p-7">
              {error && <div className="rounded-xl border border-red-100 bg-red-50 p-4 text-sm text-red-700">{error}</div>}
              {paymentNotice && <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">{paymentNotice}{paymentChecking && <Loader2 className="ml-2 inline h-4 w-4 animate-spin" />}</div>}

              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4"><div className="flex flex-wrap items-center justify-between gap-2"><div><span className="text-xs text-slate-500">{tr('v7.create.workspace.current')}</span><p className="font-semibold">{workspaceSummary ? `${workspaceSummary.effective_tier.toUpperCase()} · ${workspaceSummary.project_count}/${workspaceSummary.project_limit}` : tr('v7.create.workspace.loading')}</p></div><Link to="/app" className="text-xs font-semibold text-indigo-700">{tr('v7.create.workspace.manage')}</Link></div></div>

              <div><label className="mb-1 block text-sm font-medium">{tr('v7.create.form.name')}</label><input required value={name} onChange={(e) => handleName(e.target.value)} placeholder={tr('v7.create.form.name_placeholder')} className="w-full rounded-xl border border-slate-300 px-4 py-3 outline-none focus:border-indigo-500" /></div>
              <div><label className="mb-1 block text-sm font-medium">{tr('v7.create.labels.project_address')}</label><input required minLength={3} value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="frontend-redesign" className="w-full rounded-xl border border-slate-300 px-4 py-3 font-mono text-sm outline-none focus:border-indigo-500" /><p className="mt-1 text-[11px] text-slate-500">{tr('v7.create.form.address_help')}</p></div>
              <div><label className="mb-1 block text-sm font-medium">{tr('v7.create.form.description')}<span className="font-normal text-slate-400">{tr('v7.create.form.optional')}</span></label><textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} className="w-full resize-y rounded-xl border border-slate-300 px-4 py-3 outline-none focus:border-indigo-500" /></div>

              {globalVisible && <section><div className="mb-2"><b className="text-sm">{tr('v7.create.market.title')}</b><p className="mt-1 text-xs text-slate-500">{tr('v7.create.market.help')}</p></div><div className="flex gap-2"><button type="button" onClick={() => { setMarket('ru'); rememberMarket('ru'); saveDraft({ market: 'ru' }); }} className={`rounded-xl border px-3 py-2 text-sm font-semibold ${market === 'ru' ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-slate-200'}`}>{tr('v7.create.market.ru')}</button><button type="button" onClick={() => { setMarket('global'); rememberMarket('global'); saveDraft({ market: 'global' }); }} className={`rounded-xl border px-3 py-2 text-sm font-semibold ${market === 'global' ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-slate-200'}`}>{tr('v7.create.labels.international')}</button></div></section>}

              <section><div className="mb-3"><b className="text-sm">{tr('v7.create.plan.title')}</b><p className="mt-1 text-xs text-slate-500">{tr('v7.create.plan.help')}</p></div><div className="grid gap-3 md:grid-cols-3">{(['free', 'solo', 'studio'] as Plan[]).map((plan) => { const info = PLAN_INFO[plan]; const active = selectedPlan === plan; return <button key={plan} type="button" onClick={() => { setSelectedPlan(plan); saveDraft({ selectedPlan: plan }); }} className={`rounded-2xl border p-4 text-left transition ${active ? 'border-indigo-500 bg-indigo-50 ring-2 ring-indigo-100' : 'border-slate-200 hover:border-slate-300'}`}><span className="text-xs font-bold uppercase tracking-wider text-slate-500">{info.title}</span><strong className="mt-2 block text-lg">{priceFor(plan)}</strong><span className="mt-1 block text-xs text-slate-500">{info.projects}</span>{active && <CheckCircle2 className="mt-3 h-4 w-4 text-indigo-600" />}</button>; })}</div></section>

              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-indigo-900">{tr('v7.create.promo.title')}</span>
                  {promoAppliedNotice && <span className="text-xs font-semibold text-emerald-600">{promoAppliedNotice}</span>}
                </div>
                <div className="mt-2 flex gap-2">
                  <input
                    type="text"
                    value={promoInput}
                    onChange={(e) => setPromoInput(e.target.value.toUpperCase())}
                    placeholder="FOUNDING-SOLO30"
                    className="flex-1 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm uppercase placeholder:normal-case focus:border-indigo-500 focus:outline-none"
                  />
                  {workspaceId && !promoAppliedNotice && (
                    <button
                      type="button"
                      onClick={() => tryRedeemPromo(workspaceId)}
                      disabled={promoRedeeming || !promoInput.trim()}
                      className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold hover:bg-slate-50 transition-colors disabled:opacity-50"
                    >
                      {promoRedeeming ? '...' : tr('v7.create.promo.apply')}
                    </button>
                  )}
                </div>
                <p className="mt-1.5 text-[11px] text-slate-500">{tr('v7.create.promo.help')}</p>
              </div>

              <button type="submit" disabled={loading || paymentChecking || !name || !slug} className="flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-3 font-semibold text-white disabled:opacity-50">{loading || paymentChecking ? <Loader2 className="h-5 w-5 animate-spin" /> : selectedPlan === 'free' ? tr('v7.create.submit.free') : <><CreditCard className="h-4 w-4" />{tr('v7.create.submit.continue')} · {priceFor(selectedPlan)}</>}</button>
              {selectedPlan !== 'free' && <p className="text-center text-[11px] leading-relaxed text-slate-500">{tr('v7.create.payment.safety')}</p>}
              {params.get('payment') === 'return' && !paymentChecking && paymentNotice && <div className="flex justify-center gap-3"><button type="button" onClick={() => { const draft = loadDraft(); if (draft) verifyPaymentAndCreate(draft); }} className="text-sm font-semibold text-indigo-700">{tr('v7.create.payment.check_again')}</button><Link to="/app" className="text-sm font-semibold text-slate-600">{tr('v7.create.payment.dashboard')}</Link></div>}
            </form>
          )}
        </div>
      </div>
    </div>
  );
}