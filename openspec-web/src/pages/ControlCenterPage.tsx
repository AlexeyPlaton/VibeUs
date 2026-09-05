import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import {
  Activity,
  BadgeDollarSign,
  BookOpenCheck,
  Boxes,
  CheckCircle2,
  CircleDollarSign,
  ClipboardList,
  Database,
  Gift,
  KeyRound,
  LayoutDashboard,
  LockKeyhole,
  RefreshCw,
  Search,
  ShieldCheck,
  Siren,
  Users,
  Wrench,
  XCircle,
} from 'lucide-react';

type Section =
  | 'overview'
  | 'customers'
  | 'billing'
  | 'promos'
  | 'projects'
  | 'audit'
  | 'operations'
  | 'roadmap';

type JsonRecord = Record<string, any>;

type ControlMe = {
  enabled: boolean;
  email: string;
  platform_admin: boolean;
  elevated: boolean;
  elevation_expires_at: string | null;
  elevation_minutes: number;
};

const NAV: Array<{ id: Section; label: string; icon: typeof LayoutDashboard }> = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'customers', label: 'Customers', icon: Users },
  { id: 'billing', label: 'Billing', icon: CircleDollarSign },
  { id: 'promos', label: 'Promo Center', icon: Gift },
  { id: 'projects', label: 'Projects', icon: Boxes },
  { id: 'audit', label: 'Security & Audit', icon: ShieldCheck },
  { id: 'operations', label: 'Operations', icon: Activity },
  { id: 'roadmap', label: 'Post-MVP TODO', icon: ClipboardList },
];

function getApiUrl() {
  return window.location.origin.includes('localhost') ? 'http://localhost:8000' : window.location.origin;
}

async function api(path: string, options: RequestInit = {}): Promise<any> {
  const headers = new Headers(options.headers || {});
  if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const response = await fetch(`${getApiUrl()}${path}`, {
    ...options,
    headers,
    credentials: 'include',
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message =
      (typeof data?.detail === 'string' && data.detail) ||
      (typeof data?.error?.message === 'string' && data.error.message) ||
      `Request failed (${response.status})`;
    throw new Error(message);
  }
  return data;
}

function fmtDate(value: string | null | undefined) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function fmtMoney(minor: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    }).format((minor || 0) / 100);
  } catch {
    return `${((minor || 0) / 100).toFixed(2)} ${currency}`;
  }
}

function Badge({ children, tone = 'slate' }: { children: ReactNode; tone?: 'slate' | 'green' | 'amber' | 'red' | 'indigo' }) {
  const classes: Record<string, string> = {
    slate: 'border-slate-200 bg-slate-50 text-slate-700',
    green: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    amber: 'border-amber-200 bg-amber-50 text-amber-700',
    red: 'border-red-200 bg-red-50 text-red-700',
    indigo: 'border-indigo-200 bg-indigo-50 text-indigo-700',
  };
  return <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold ${classes[tone]}`}>{children}</span>;
}

function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-sm text-slate-500">{children}</div>;
}

function Metric({ label, value, hint, alert = false }: { label: string; value: ReactNode; hint?: string; alert?: boolean }) {
  return (
    <div className={`rounded-2xl border p-5 ${alert ? 'border-amber-200 bg-amber-50' : 'border-slate-200 bg-white'}`}>
      <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">{label}</div>
      <div className={`mt-2 text-3xl font-black tracking-tight ${alert ? 'text-amber-900' : 'text-slate-950'}`}>{value}</div>
      {hint && <div className="mt-2 text-xs text-slate-500">{hint}</div>}
    </div>
  );
}

export function ControlCenterPage() {
  const [section, setSection] = useState<Section>('overview');
  const [me, setMe] = useState<ControlMe | null>(null);
  const [accessError, setAccessError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sectionLoading, setSectionLoading] = useState(false);

  const [elevationPassword, setElevationPassword] = useState('');
  const [overview, setOverview] = useState<JsonRecord | null>(null);
  const [customers, setCustomers] = useState<JsonRecord | null>(null);
  const [customerQuery, setCustomerQuery] = useState('');
  const [selectedUser, setSelectedUser] = useState<JsonRecord | null>(null);
  const [userActionReason, setUserActionReason] = useState('Support action requested by founder');
  const [payments, setPayments] = useState<JsonRecord[]>([]);
  const [promos, setPromos] = useState<JsonRecord[]>([]);
  const [createdPromo, setCreatedPromo] = useState<JsonRecord | null>(null);
  const [projectSearch, setProjectSearch] = useState('');
  const [projectResults, setProjectResults] = useState<JsonRecord[]>([]);
  const [selectedProject, setSelectedProject] = useState<JsonRecord | null>(null);
  const [audit, setAudit] = useState<JsonRecord[]>([]);
  const [operations, setOperations] = useState<JsonRecord | null>(null);
  const [roadmap, setRoadmap] = useState<JsonRecord[]>([]);

  const [grant, setGrant] = useState({
    workspaceId: '',
    tier: 'solo',
    durationDays: 30,
    reason: 'Founder support compensation',
  });
  const [promoForm, setPromoForm] = useState({
    code: '',
    campaign: 'launch',
    tier: 'solo',
    durationDays: 30,
    maxUses: 50,
    lifetime: false,
  });

  const loadMe = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api('/api/control/me');
      setMe(data as ControlMe);
      setAccessError(null);
    } catch (err) {
      setMe(null);
      setAccessError(err instanceof Error ? err.message : 'Control Center is unavailable');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadMe();
  }, [loadMe]);

  const loadOverview = useCallback(async () => {
    setOverview(await api('/api/control/overview'));
  }, []);

  const searchCustomers = useCallback(async (query = customerQuery) => {
    const data = await api(`/api/control/customers?q=${encodeURIComponent(query)}&limit=40`);
    setCustomers(data);
  }, [customerQuery]);

  const loadPayments = useCallback(async () => {
    const data = await api('/api/control/payments?limit=150');
    setPayments(data.payments || []);
  }, []);

  const loadPromos = useCallback(async () => {
    const data = await api('/api/control/promos?limit=200');
    setPromos(data.promos || []);
  }, []);

  const loadAudit = useCallback(async () => {
    const data = await api('/api/control/audit?limit=150');
    setAudit(data.events || []);
  }, []);

  const loadOperations = useCallback(async () => {
    setOperations(await api('/api/control/operations'));
  }, []);

  const loadRoadmap = useCallback(async () => {
    const data = await api('/api/control/roadmap');
    setRoadmap(data.items || []);
  }, []);

  const refreshSection = useCallback(async () => {
    if (!me) return;
    setSectionLoading(true);
    setError(null);
    try {
      if (section === 'overview') await loadOverview();
      if (section === 'customers') await searchCustomers();
      if (section === 'billing') await loadPayments();
      if (section === 'promos') await loadPromos();
      if (section === 'audit') await loadAudit();
      if (section === 'operations') await loadOperations();
      if (section === 'roadmap') await loadRoadmap();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load section');
    } finally {
      setSectionLoading(false);
    }
  }, [loadAudit, loadOperations, loadOverview, loadPayments, loadPromos, loadRoadmap, me, searchCustomers, section]);

  useEffect(() => {
    void refreshSection();
  }, [refreshSection]);

  const elevate = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    try {
      const data = await api('/api/control/elevate', {
        method: 'POST',
        body: JSON.stringify({ password: elevationPassword }),
      });
      setElevationPassword('');
      setMe((current) => current ? { ...current, elevated: true, elevation_expires_at: data.expires_at } : current);
      setNotice(`Sensitive actions unlocked until ${fmtDate(data.expires_at)}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Re-authentication failed');
    }
  };

  const lockAdmin = async () => {
    try {
      await api('/api/control/elevation/revoke', { method: 'POST' });
      setMe((current) => current ? { ...current, elevated: false, elevation_expires_at: null } : current);
      setNotice('Sensitive actions locked.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not lock admin actions');
    }
  };

  const requireElevation = () => {
    if (me?.elevated) return true;
    setError('Unlock sensitive actions with your password first.');
    return false;
  };

  const loadUser = async (id: string) => {
    try {
      setSelectedUser(await api(`/api/control/users/${encodeURIComponent(id)}`));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load user');
    }
  };

  const mutateUser = async (id: string, action: 'block' | 'unblock' | 'sessions/revoke') => {
    if (!requireElevation()) return;
    const label = action === 'block' ? 'block this user' : action === 'unblock' ? 'unblock this user' : 'revoke all user sessions';
    if (!window.confirm(`Really ${label}? This action is audited.`)) return;
    try {
      await api(`/api/control/users/${encodeURIComponent(id)}/${action}`, {
        method: 'POST',
        body: JSON.stringify({ reason: userActionReason }),
      });
      setNotice(`User action completed: ${label}.`);
      await loadUser(id);
      await searchCustomers();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'User action failed');
    }
  };

  const submitGrant = async (event: FormEvent) => {
    event.preventDefault();
    if (!requireElevation()) return;
    try {
      const data = await api(`/api/control/workspaces/${encodeURIComponent(grant.workspaceId)}/grant-access`, {
        method: 'POST',
        body: JSON.stringify({
          tier: grant.tier,
          duration_days: Number(grant.durationDays),
          reason: grant.reason,
        }),
      });
      setNotice(`Granted ${data.effective_tier.toUpperCase()} until ${fmtDate(data.current_period_end)}.`);
      await loadOverview();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Grant failed');
    }
  };

  const createPromo = async (event: FormEvent) => {
    event.preventDefault();
    if (!requireElevation()) return;
    try {
      const payload: JsonRecord = {
        tier: promoForm.tier,
        grants_lifetime: promoForm.lifetime,
        max_uses: Number(promoForm.maxUses),
        campaign: promoForm.campaign.trim() || null,
      };
      if (promoForm.code.trim()) payload.code = promoForm.code.trim();
      if (!promoForm.lifetime) payload.duration_days = Number(promoForm.durationDays);
      const data = await api('/api/control/promos', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      setCreatedPromo(data);
      setNotice('Promo created. Copy the plaintext code now — Control Center will not show it again.');
      setPromoForm((current) => ({ ...current, code: '' }));
      await loadPromos();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Promo creation failed');
    }
  };

  const togglePromo = async (promo: JsonRecord) => {
    if (!requireElevation()) return;
    const action = promo.is_active ? 'deactivate' : 'activate';
    if (!window.confirm(`${action === 'deactivate' ? 'Deactivate' : 'Activate'} this promo?`)) return;
    try {
      await api(`/api/control/promos/${encodeURIComponent(promo.id)}/${action}`, {
        method: 'POST',
        body: JSON.stringify({ reason: 'Founder changed promo availability in Control Center' }),
      });
      await loadPromos();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Promo update failed');
    }
  };

  const searchProjects = async (event?: FormEvent) => {
    event?.preventDefault();
    try {
      const data = await api(`/api/control/customers?q=${encodeURIComponent(projectSearch)}&limit=50`);
      setProjectResults(data.projects || []);
      setSelectedProject(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Project search failed');
    }
  };

  const loadProject = async (id: string) => {
    try {
      setSelectedProject(await api(`/api/control/projects/${encodeURIComponent(id)}`));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load project');
    }
  };

  const revokeProjectCredential = async (projectId: string, kind: 'api-token' | 'ingest-key') => {
    if (!requireElevation()) return;
    if (!window.confirm(`Revoke this project's ${kind === 'api-token' ? 'API token' : 'ingest key'}? Existing integrations will stop working.`)) return;
    try {
      await api(`/api/control/projects/${encodeURIComponent(projectId)}/revoke-${kind}`, {
        method: 'POST',
        body: JSON.stringify({ reason: 'Founder credential revocation from Control Center' }),
      });
      setNotice('Credential revoked. No secret value was exposed to Control Center.');
      await loadProject(projectId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Credential revocation failed');
    }
  };

  const revenueCards = useMemo(() => {
    const revenue = overview?.billing?.revenue_30d_by_currency || {};
    return Object.entries(revenue).map(([currency, value]) => {
      const row = value as JsonRecord;
      return {
        currency,
        text: fmtMoney(Number(row.net_minor || 0), currency),
        hint: `gross ${fmtMoney(Number(row.gross_minor || 0), currency)} · refunds ${fmtMoney(Number(row.refund_minor || 0), currency)}`,
      };
    });
  }, [overview]);

  if (loading) {
    return (
      <div className="grid min-h-screen place-items-center bg-slate-950 text-white">
        <RefreshCw className="h-7 w-7 animate-spin text-indigo-400" />
      </div>
    );
  }

  if (accessError || !me) {
    return (
      <div className="min-h-screen bg-slate-950 px-6 py-16 text-white">
        <div className="mx-auto max-w-xl rounded-3xl border border-slate-800 bg-slate-900 p-8 shadow-2xl">
          <LockKeyhole className="h-10 w-10 text-amber-400" />
          <h1 className="mt-5 text-2xl font-black">VibeUs Founder Control</h1>
          <p className="mt-3 text-sm leading-6 text-slate-400">
            This area is isolated from normal workspace roles. Sign in with a platform-admin account and enable the Control Center on the server.
          </p>
          <div className="mt-5 rounded-xl border border-red-900/50 bg-red-950/40 p-4 text-sm text-red-200">{accessError || 'Access denied'}</div>
          <div className="mt-6 flex gap-3">
            <a href="/create?next=app" className="rounded-xl bg-white px-4 py-2 text-sm font-bold text-slate-950">Sign in</a>
            <a href="/app" className="rounded-xl border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-300">Back to account</a>
          </div>
        </div>
      </div>
    );
  }

  const currentNav = NAV.find((item) => item.id === section);

  return (
    <div className="min-h-screen bg-slate-100 text-slate-950">
      <div className="flex min-h-screen">
        <aside className="hidden w-72 shrink-0 flex-col border-r border-slate-800 bg-slate-950 p-5 text-white lg:flex">
          <div className="rounded-2xl border border-indigo-500/20 bg-indigo-500/10 p-4">
            <div className="flex items-center gap-3">
              <div className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-cyan-400 via-indigo-500 to-fuchsia-500">
                <ShieldCheck className="h-5 w-5 text-white" />
              </div>
              <div>
                <div className="font-black">VibeUs Control</div>
                <div className="text-xs text-slate-400">Founder-only operations</div>
              </div>
            </div>
          </div>

          <nav className="mt-6 space-y-1">
            {NAV.map((item) => {
              const Icon = item.icon;
              const active = section === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setSection(item.id)}
                  className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-semibold transition ${
                    active ? 'bg-white text-slate-950' : 'text-slate-400 hover:bg-slate-900 hover:text-white'
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                </button>
              );
            })}
          </nav>

          <div className="mt-auto rounded-2xl border border-slate-800 bg-slate-900 p-4">
            <div className="truncate text-xs font-semibold text-white">{me.email}</div>
            <div className="mt-2">
              <Badge tone={me.elevated ? 'green' : 'amber'}>{me.elevated ? 'Sensitive actions unlocked' : 'Read-only admin'}</Badge>
            </div>
            {me.elevated && (
              <button type="button" onClick={() => void lockAdmin()} className="mt-3 text-xs font-semibold text-slate-400 hover:text-white">
                Lock sensitive actions
              </button>
            )}
          </div>
        </aside>

        <main className="min-w-0 flex-1">
          <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 px-4 py-4 backdrop-blur md:px-7">
            <div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
              <div>
                <div className="text-xs font-bold uppercase tracking-[0.18em] text-indigo-600">Founder Control</div>
                <h1 className="mt-1 text-xl font-black">{currentNav?.label || 'Control Center'}</h1>
              </div>
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => void refreshSection()} className="rounded-xl border border-slate-200 bg-white p-2.5 text-slate-600 hover:bg-slate-50" title="Refresh">
                  <RefreshCw className={`h-4 w-4 ${sectionLoading ? 'animate-spin' : ''}`} />
                </button>
                <a href="/app" className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50">Account</a>
              </div>
            </div>
            <div className="mx-auto mt-3 flex max-w-7xl gap-2 overflow-x-auto lg:hidden">
              {NAV.map((item) => (
                <button key={item.id} type="button" onClick={() => setSection(item.id)} className={`whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-bold ${section === item.id ? 'bg-slate-950 text-white' : 'bg-slate-100 text-slate-600'}`}>
                  {item.label}
                </button>
              ))}
            </div>
          </header>

          <div className="mx-auto max-w-7xl space-y-5 px-4 py-6 md:px-7">
            {!me.elevated && (
              <form onSubmit={elevate} className="flex flex-col gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 md:flex-row md:items-center">
                <div className="flex min-w-0 flex-1 items-start gap-3">
                  <KeyRound className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
                  <div>
                    <div className="text-sm font-bold text-amber-950">Sensitive actions are locked</div>
                    <div className="mt-1 text-xs leading-5 text-amber-800">
                      Reads are available. Re-enter your password to unlock mutations for {me.elevation_minutes} minutes.
                    </div>
                  </div>
                </div>
                <input
                  type="password"
                  value={elevationPassword}
                  onChange={(event) => setElevationPassword(event.target.value)}
                  placeholder="Current password"
                  required
                  className="rounded-xl border border-amber-300 bg-white px-3 py-2 text-sm outline-none focus:border-amber-500"
                />
                <button type="submit" className="rounded-xl bg-amber-900 px-4 py-2 text-sm font-bold text-white">Unlock</button>
              </form>
            )}

            {me.elevated && (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm">
                <div className="flex items-center gap-2 font-semibold text-emerald-800">
                  <CheckCircle2 className="h-4 w-4" />
                  Sensitive actions unlocked until {fmtDate(me.elevation_expires_at)}
                </div>
                <button type="button" onClick={() => void lockAdmin()} className="font-bold text-emerald-800 underline">Lock now</button>
              </div>
            )}

            {error && (
              <div className="flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
                <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <div className="flex-1">{error}</div>
                <button type="button" onClick={() => setError(null)} className="font-bold">×</button>
              </div>
            )}
            {notice && (
              <div className="flex items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                <div className="flex-1">{notice}</div>
                <button type="button" onClick={() => setNotice(null)} className="font-bold">×</button>
              </div>
            )}

            {section === 'overview' && (
              <section className="space-y-5">
                {!overview ? <Empty>Loading overview…</Empty> : (
                  <>
                    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                      <Metric label="Users" value={overview.users?.total ?? 0} hint={`+${overview.users?.new_24h ?? 0} today · +${overview.users?.new_7d ?? 0} / 7d`} />
                      <Metric label="Workspaces" value={overview.workspaces?.total ?? 0} hint={`${overview.workspaces?.active_paid ?? 0} active paid`} />
                      <Metric label="Projects" value={overview.projects?.total ?? 0} />
                      <Metric label="Open runtime errors" value={overview.runtime?.open_error_groups ?? 0} alert={Number(overview.runtime?.open_error_groups || 0) > 0} />
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                      <Metric label="Payments / 24h" value={overview.billing?.payments_24h ?? 0} />
                      <Metric label="Pending >15m" value={overview.billing?.pending_attention ?? 0} alert={Number(overview.billing?.pending_attention || 0) > 0} />
                      <Metric label="Fiscal attention" value={overview.billing?.fiscal_attention ?? 0} alert={Number(overview.billing?.fiscal_attention || 0) > 0} />
                      <Metric label="Promo uses / 30d" value={overview.growth?.promo_redemptions_30d ?? 0} />
                    </div>
                    {revenueCards.length > 0 && (
                      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                        {revenueCards.map((row) => <Metric key={row.currency} label={`Net revenue · 30d · ${row.currency}`} value={row.text} hint={row.hint} />)}
                      </div>
                    )}
                    <div className="rounded-2xl border border-slate-200 bg-white p-5">
                      <h2 className="font-black">Recent activity</h2>
                      <div className="mt-4 divide-y divide-slate-100">
                        {(overview.recent_activity || []).map((item: JsonRecord) => (
                          <div key={item.id} className="flex flex-col gap-1 py-3 md:flex-row md:items-center md:justify-between">
                            <div>
                              <div className="text-sm font-semibold">{item.event_type}</div>
                              <div className="mt-1 text-xs text-slate-500">{item.workspace_id || item.project_id || 'platform event'}</div>
                            </div>
                            <div className="text-xs text-slate-400">{fmtDate(item.created_at)}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </>
                )}
              </section>
            )}

            {section === 'customers' && (
              <section className="space-y-5">
                <form onSubmit={(event) => { event.preventDefault(); void searchCustomers(); }} className="flex gap-2 rounded-2xl border border-slate-200 bg-white p-4">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                    <input value={customerQuery} onChange={(event) => setCustomerQuery(event.target.value)} placeholder="Email, workspace, project slug or ID" className="w-full rounded-xl border border-slate-200 py-2 pl-9 pr-3 text-sm outline-none focus:border-indigo-400" />
                  </div>
                  <button className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-bold text-white">Search</button>
                </form>
                <div className="grid gap-5 xl:grid-cols-[1fr_1.1fr]">
                  <div className="space-y-4">
                    <div className="rounded-2xl border border-slate-200 bg-white p-5">
                      <h2 className="font-black">Users</h2>
                      <div className="mt-3 space-y-2">
                        {(customers?.users || []).map((item: JsonRecord) => (
                          <button key={item.id} type="button" onClick={() => void loadUser(item.id)} className="flex w-full items-center justify-between rounded-xl border border-slate-100 p-3 text-left hover:border-indigo-200 hover:bg-indigo-50/40">
                            <div className="min-w-0">
                              <div className="truncate text-sm font-semibold">{item.email}</div>
                              <div className="mt-1 text-xs text-slate-400">{fmtDate(item.created_at)}</div>
                            </div>
                            <Badge tone={item.is_active ? 'green' : 'red'}>{item.is_active ? 'active' : 'blocked'}</Badge>
                          </button>
                        ))}
                        {(customers?.users || []).length === 0 && <Empty>No users found.</Empty>}
                      </div>
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-white p-5">
                      <h2 className="font-black">Workspaces</h2>
                      <div className="mt-3 space-y-2">
                        {(customers?.workspaces || []).map((item: JsonRecord) => (
                          <div key={item.id} className="rounded-xl border border-slate-100 p-3">
                            <div className="flex items-center justify-between gap-2">
                              <div className="font-semibold">{item.name}</div>
                              <Badge tone={item.effective_tier === 'free' ? 'slate' : 'indigo'}>{item.effective_tier}</Badge>
                            </div>
                            <div className="mt-1 text-xs text-slate-500">{item.owner_email}</div>
                            <button type="button" onClick={() => { setGrant((current) => ({ ...current, workspaceId: item.id })); setSection('billing'); }} className="mt-2 text-xs font-bold text-indigo-700">Open in Billing →</button>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-slate-200 bg-white p-5">
                    {!selectedUser ? <Empty>Select a user to inspect account, workspace membership and sessions.</Empty> : (
                      <div className="space-y-5">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <h2 className="text-lg font-black">{selectedUser.user.email}</h2>
                            <Badge tone={selectedUser.user.is_active ? 'green' : 'red'}>{selectedUser.user.is_active ? 'active' : 'blocked'}</Badge>
                          </div>
                          <div className="mt-2 text-xs text-slate-500">Created {fmtDate(selectedUser.user.created_at)} · active sessions {selectedUser.user.active_sessions}</div>
                          <div className="mt-2 text-xs text-slate-500">Terms {selectedUser.user.terms_version || '—'} · Privacy {selectedUser.user.privacy_version || '—'}</div>
                        </div>
                        <div>
                          <div className="text-xs font-bold uppercase tracking-wider text-slate-400">Workspaces</div>
                          <div className="mt-2 space-y-2">
                            {(selectedUser.workspaces || []).map((workspace: JsonRecord) => (
                              <div key={workspace.id} className="rounded-xl bg-slate-50 p-3 text-sm">
                                <div className="flex justify-between gap-3">
                                  <span className="font-semibold">{workspace.name}</span>
                                  <Badge tone="indigo">{workspace.effective_tier}</Badge>
                                </div>
                                <div className="mt-1 text-xs text-slate-500">{workspace.role} · until {fmtDate(workspace.period_end)}</div>
                              </div>
                            ))}
                          </div>
                        </div>
                        <div>
                          <label className="text-xs font-bold uppercase tracking-wider text-slate-400">Reason for sensitive action</label>
                          <input value={userActionReason} onChange={(event) => setUserActionReason(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" />
                          <div className="mt-3 flex flex-wrap gap-2">
                            {selectedUser.user.is_active ? (
                              <button type="button" onClick={() => void mutateUser(selectedUser.user.id, 'block')} className="rounded-xl bg-red-600 px-3 py-2 text-xs font-bold text-white">Block + revoke sessions</button>
                            ) : (
                              <button type="button" onClick={() => void mutateUser(selectedUser.user.id, 'unblock')} className="rounded-xl bg-emerald-600 px-3 py-2 text-xs font-bold text-white">Unblock</button>
                            )}
                            <button type="button" onClick={() => void mutateUser(selectedUser.user.id, 'sessions/revoke')} className="rounded-xl border border-slate-300 px-3 py-2 text-xs font-bold">Revoke sessions</button>
                          </div>
                        </div>
                        <div>
                          <div className="text-xs font-bold uppercase tracking-wider text-slate-400">Recent account activity</div>
                          <div className="mt-2 max-h-72 overflow-auto divide-y divide-slate-100">
                            {(selectedUser.recent_activity || []).map((item: JsonRecord) => (
                              <div key={item.id} className="py-2 text-xs">
                                <div className="font-semibold text-slate-700">{item.event_type}</div>
                                <div className="text-slate-400">{fmtDate(item.created_at)}</div>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </section>
            )}

            {section === 'billing' && (
              <section className="space-y-5">
                <div className="grid gap-5 xl:grid-cols-[0.8fr_1.2fr]">
                  <form onSubmit={submitGrant} className="rounded-2xl border border-slate-200 bg-white p-5">
                    <div className="flex items-center gap-2">
                      <BadgeDollarSign className="h-5 w-5 text-indigo-600" />
                      <h2 className="font-black">Grant access safely</h2>
                    </div>
                    <p className="mt-2 text-xs leading-5 text-slate-500">A manual support grant uses the existing one-time entitlement domain flow and writes an admin audit event. It does not forge a payment.</p>
                    <div className="mt-4 space-y-3">
                      <input required value={grant.workspaceId} onChange={(event) => setGrant((current) => ({ ...current, workspaceId: event.target.value }))} placeholder="Workspace ID" className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" />
                      <div className="grid grid-cols-2 gap-2">
                        <select value={grant.tier} onChange={(event) => setGrant((current) => ({ ...current, tier: event.target.value }))} className="rounded-xl border border-slate-200 px-3 py-2 text-sm">
                          <option value="solo">Solo</option>
                          <option value="studio">Studio</option>
                          <option value="business">Business</option>
                        </select>
                        <input type="number" min={1} max={3660} value={grant.durationDays} onChange={(event) => setGrant((current) => ({ ...current, durationDays: Number(event.target.value) }))} className="rounded-xl border border-slate-200 px-3 py-2 text-sm" />
                      </div>
                      <textarea required minLength={5} value={grant.reason} onChange={(event) => setGrant((current) => ({ ...current, reason: event.target.value }))} className="min-h-24 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" />
                      <button className="w-full rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-bold text-white">Grant access</button>
                    </div>
                  </form>

                  <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
                    <div className="flex items-center gap-2 text-amber-900">
                      <Siren className="h-5 w-5" />
                      <h2 className="font-black">Provider mutations are intentionally disabled</h2>
                    </div>
                    <p className="mt-2 text-sm leading-6 text-amber-800">
                      Refund and recurring-cancellation buttons stay disabled until the canonical live provider (currently being moved away from CloudPayments) exposes a verified adapter. Control Center will never simulate a refund by editing the local ledger.
                    </p>
                    <div className="mt-3"><Badge tone="amber">TODO · provider-side refund/cancel adapter</Badge></div>
                  </div>
                </div>

                <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
                  <div className="flex items-center justify-between border-b border-slate-100 p-5">
                    <h2 className="font-black">Payments</h2>
                    <span className="text-xs text-slate-400">{payments.length} loaded</span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-left text-sm">
                      <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-400">
                        <tr><th className="px-4 py-3">Payment</th><th className="px-4 py-3">Workspace</th><th className="px-4 py-3">Amount</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Fiscal</th><th className="px-4 py-3">Created</th></tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {payments.map((payment) => (
                          <tr key={payment.id}>
                            <td className="px-4 py-3"><div className="font-semibold">{payment.provider}</div><div className="max-w-48 truncate text-xs text-slate-400">{payment.provider_payment_id}</div></td>
                            <td className="px-4 py-3 font-mono text-xs">{payment.workspace_id}</td>
                            <td className="px-4 py-3 font-semibold">{fmtMoney(payment.amount_minor, payment.currency)}{payment.refunded_minor > 0 && <div className="text-xs text-red-500">refunded {fmtMoney(payment.refunded_minor, payment.currency)}</div>}</td>
                            <td className="px-4 py-3"><Badge tone={payment.status === 'succeeded' ? 'green' : payment.status === 'pending' ? 'amber' : 'slate'}>{payment.status}</Badge></td>
                            <td className="px-4 py-3"><Badge tone={String(payment.fiscal_status).includes('required') ? 'amber' : 'slate'}>{payment.fiscal_status}</Badge></td>
                            <td className="px-4 py-3 text-xs text-slate-500">{fmtDate(payment.created_at)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </section>
            )}

            {section === 'promos' && (
              <section className="space-y-5">
                {createdPromo && (
                  <div className="rounded-2xl border-2 border-emerald-300 bg-emerald-50 p-5">
                    <div className="text-xs font-black uppercase tracking-[0.16em] text-emerald-700">Visible once</div>
                    <div className="mt-2 break-all font-mono text-2xl font-black text-emerald-950">{createdPromo.plaintext_code}</div>
                    <div className="mt-3 break-all rounded-xl bg-white p-3 font-mono text-xs text-slate-600">{createdPromo.share_url}</div>
                    <button type="button" onClick={() => void navigator.clipboard.writeText(createdPromo.share_url)} className="mt-3 rounded-xl bg-emerald-700 px-3 py-2 text-xs font-bold text-white">Copy share link</button>
                  </div>
                )}
                <div className="grid gap-5 xl:grid-cols-[0.8fr_1.2fr]">
                  <form onSubmit={createPromo} className="rounded-2xl border border-slate-200 bg-white p-5">
                    <div className="flex items-center gap-2"><Gift className="h-5 w-5 text-fuchsia-600" /><h2 className="font-black">Create promo</h2></div>
                    <p className="mt-2 text-xs leading-5 text-slate-500">Plaintext is returned exactly once. The database keeps only its digest.</p>
                    <div className="mt-4 space-y-3">
                      <input value={promoForm.code} onChange={(event) => setPromoForm((current) => ({ ...current, code: event.target.value.toUpperCase() }))} placeholder="Custom code or leave blank" className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm uppercase" />
                      <input value={promoForm.campaign} onChange={(event) => setPromoForm((current) => ({ ...current, campaign: event.target.value }))} placeholder="Campaign" className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" />
                      <div className="grid grid-cols-2 gap-2">
                        <select value={promoForm.tier} onChange={(event) => setPromoForm((current) => ({ ...current, tier: event.target.value }))} className="rounded-xl border border-slate-200 px-3 py-2 text-sm">
                          <option value="solo">Solo</option><option value="studio">Studio</option><option value="business">Business</option>
                        </select>
                        <input type="number" min={1} max={100000} value={promoForm.maxUses} onChange={(event) => setPromoForm((current) => ({ ...current, maxUses: Number(event.target.value) }))} className="rounded-xl border border-slate-200 px-3 py-2 text-sm" title="Maximum uses" />
                      </div>
                      <label className="flex items-center gap-2 text-sm text-slate-600"><input type="checkbox" checked={promoForm.lifetime} onChange={(event) => setPromoForm((current) => ({ ...current, lifetime: event.target.checked }))} />Lifetime grant</label>
                      {!promoForm.lifetime && <input type="number" min={1} max={3660} value={promoForm.durationDays} onChange={(event) => setPromoForm((current) => ({ ...current, durationDays: Number(event.target.value) }))} className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" title="Duration days" />}
                      <button className="w-full rounded-xl bg-fuchsia-600 px-4 py-2.5 text-sm font-bold text-white">Create promo</button>
                    </div>
                  </form>
                  <div className="rounded-2xl border border-slate-200 bg-white p-5">
                    <h2 className="font-black">Promo inventory</h2>
                    <div className="mt-4 space-y-3">
                      {promos.map((promo) => (
                        <div key={promo.id} className="rounded-xl border border-slate-100 p-4">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div>
                              <div className="font-semibold">{promo.campaign || 'Unlabeled campaign'}</div>
                              <div className="mt-1 text-xs text-slate-500">{promo.tier} · {promo.grants_lifetime ? 'lifetime' : `${promo.duration_days} days`} · {promo.times_used}/{promo.max_uses} used</div>
                            </div>
                            <div className="flex items-center gap-2">
                              <Badge tone={promo.is_active ? 'green' : 'slate'}>{promo.is_active ? 'active' : 'inactive'}</Badge>
                              <button type="button" onClick={() => void togglePromo(promo)} className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-bold">{promo.is_active ? 'Deactivate' : 'Activate'}</button>
                            </div>
                          </div>
                          <div className="mt-2 text-[11px] text-slate-400">Code hidden by design · created {fmtDate(promo.created_at)} · expires {fmtDate(promo.expires_at)}</div>
                          {promo.recent_redemptions?.length > 0 && <div className="mt-3 text-xs text-slate-500">Recent: {promo.recent_redemptions.slice(0, 3).map((r: JsonRecord) => r.workspace_id).join(', ')}</div>}
                        </div>
                      ))}
                      {promos.length === 0 && <Empty>No promos yet.</Empty>}
                    </div>
                  </div>
                </div>
              </section>
            )}

            {section === 'projects' && (
              <section className="space-y-5">
                <form onSubmit={searchProjects} className="flex gap-2 rounded-2xl border border-slate-200 bg-white p-4">
                  <input value={projectSearch} onChange={(event) => setProjectSearch(event.target.value)} placeholder="Project slug, name or ID" className="flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm" />
                  <button className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-bold text-white">Find project</button>
                </form>
                <div className="grid gap-5 xl:grid-cols-[0.7fr_1.3fr]">
                  <div className="rounded-2xl border border-slate-200 bg-white p-4">
                    <div className="space-y-2">
                      {projectResults.map((project) => (
                        <button key={project.id} type="button" onClick={() => void loadProject(project.id)} className="w-full rounded-xl border border-slate-100 p-3 text-left hover:border-indigo-200">
                          <div className="font-semibold">{project.name}</div><div className="mt-1 font-mono text-xs text-slate-500">{project.slug}</div>
                        </button>
                      ))}
                      {projectResults.length === 0 && <Empty>Search for a project to inspect it.</Empty>}
                    </div>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-white p-5">
                    {!selectedProject ? <Empty>No project selected.</Empty> : (
                      <div className="space-y-5">
                        <div>
                          <div className="flex flex-wrap items-center gap-2"><h2 className="text-xl font-black">{selectedProject.project.name}</h2><Badge tone="indigo">{selectedProject.project.slug}</Badge></div>
                          <div className="mt-2 font-mono text-xs text-slate-400">{selectedProject.project.id}</div>
                        </div>
                        <div className="grid gap-3 sm:grid-cols-3">
                          <Metric label="Tickets" value={selectedProject.counts.tickets} />
                          <Metric label="Feedback" value={selectedProject.counts.feedback} />
                          <Metric label="Open errors" value={selectedProject.counts.open_error_groups} alert={selectedProject.counts.open_error_groups > 0} />
                        </div>
                        <div className="grid gap-3 md:grid-cols-2">
                          <div className="rounded-xl bg-slate-50 p-4 text-sm">
                            <div className="font-bold">Credentials</div>
                            <div className="mt-2 space-y-1 text-xs text-slate-600">
                              <div>API token: {selectedProject.project.api_token_configured ? 'configured' : 'not configured'}</div>
                              <div>Ingest key: {selectedProject.project.ingest_key_configured ? 'configured' : 'not configured'}</div>
                              <div>Public widget key: <span className="font-mono">{selectedProject.project.public_widget_key || '—'}</span></div>
                            </div>
                            <div className="mt-3 flex flex-wrap gap-2">
                              <button type="button" disabled={!selectedProject.project.api_token_configured} onClick={() => void revokeProjectCredential(selectedProject.project.id, 'api-token')} className="rounded-lg border border-red-200 px-2.5 py-1.5 text-xs font-bold text-red-700 disabled:opacity-40">Revoke API token</button>
                              <button type="button" disabled={!selectedProject.project.ingest_key_configured} onClick={() => void revokeProjectCredential(selectedProject.project.id, 'ingest-key')} className="rounded-lg border border-red-200 px-2.5 py-1.5 text-xs font-bold text-red-700 disabled:opacity-40">Revoke ingest key</button>
                            </div>
                          </div>
                          <div className="rounded-xl bg-slate-50 p-4 text-sm">
                            <div className="font-bold">Integrations</div>
                            <div className="mt-2 space-y-1 text-xs text-slate-600">
                              <div>GitHub: {selectedProject.project.github_repo || 'not connected'}</div>
                              <div>Sync: {selectedProject.project.github_sync_enabled ? 'enabled' : 'disabled'}</div>
                              <div>Legacy PAT fallback: {selectedProject.project.github_pat_fallback_configured ? 'configured' : 'not configured'}</div>
                              <div>Runtime errors: {selectedProject.project.runtime_error_tracking_enabled ? 'enabled' : 'disabled'}</div>
                            </div>
                          </div>
                        </div>
                        <div>
                          <div className="text-xs font-bold uppercase tracking-wider text-slate-400">Recent runtime errors</div>
                          <div className="mt-2 space-y-2">
                            {(selectedProject.recent_errors || []).map((item: JsonRecord) => (
                              <div key={item.id} className="rounded-xl border border-slate-100 p-3 text-sm">
                                <div className="font-semibold">{item.exception_type}</div>
                                <div className="mt-1 truncate text-xs text-slate-500">{item.normalized_message}</div>
                                <div className="mt-1 text-[11px] text-slate-400">{item.occurrences_count} occurrences · {fmtDate(item.last_seen_at)}</div>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </section>
            )}

            {section === 'audit' && (
              <section className="space-y-5">
                <div className="rounded-2xl border border-slate-200 bg-white p-5">
                  <div className="flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-indigo-600" /><h2 className="font-black">Security contract</h2></div>
                  <div className="mt-3 grid gap-3 md:grid-cols-3">
                    <div className="rounded-xl bg-slate-50 p-3 text-xs text-slate-600"><b>Platform isolation:</b> workspace roles never grant `/control` access.</div>
                    <div className="rounded-xl bg-slate-50 p-3 text-xs text-slate-600"><b>Step-up auth:</b> sensitive mutations require a short-lived HttpOnly elevation cookie.</div>
                    <div className="rounded-xl bg-slate-50 p-3 text-xs text-slate-600"><b>Secret policy:</b> API and ingest secrets are never rendered in Control Center.</div>
                  </div>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white p-5">
                  <h2 className="font-black">Audit log</h2>
                  <div className="mt-4 divide-y divide-slate-100">
                    {audit.map((item) => (
                      <div key={item.id} className="grid gap-2 py-3 md:grid-cols-[1fr_180px]">
                        <div>
                          <div className="text-sm font-semibold">{item.event_type}</div>
                          <div className="mt-1 break-all font-mono text-[11px] text-slate-400">{item.workspace_id || item.project_id || item.user_id || 'platform'}</div>
                          {item.details && Object.keys(item.details).length > 0 && <pre className="mt-2 max-h-28 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-2 text-[10px] text-slate-500">{JSON.stringify(item.details, null, 2)}</pre>}
                        </div>
                        <div className="text-xs text-slate-400 md:text-right">{fmtDate(item.created_at)}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </section>
            )}

            {section === 'operations' && (
              <section className="space-y-5">
                {!operations ? <Empty>Loading operations…</Empty> : (
                  <>
                    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                      <Metric label="Database" value={operations.database?.ok ? 'OK' : 'FAIL'} alert={!operations.database?.ok} />
                      <Metric label="Environment" value={operations.environment} hint={`VibeUs ${operations.version}`} />
                      <Metric label="Pending >15m" value={operations.billing?.pending_older_15m ?? 0} alert={operations.billing?.pending_older_15m > 0} />
                      <Metric label="Fiscal attention" value={operations.billing?.fiscal_attention ?? 0} alert={operations.billing?.fiscal_attention > 0} />
                    </div>
                    <div className="grid gap-5 lg:grid-cols-2">
                      <div className="rounded-2xl border border-slate-200 bg-white p-5">
                        <div className="flex items-center gap-2"><Database className="h-5 w-5 text-indigo-600" /><h2 className="font-black">Runtime</h2></div>
                        <pre className="mt-4 overflow-auto rounded-xl bg-slate-950 p-4 text-xs text-slate-300">{JSON.stringify(operations, null, 2)}</pre>
                      </div>
                      <div className="rounded-2xl border border-slate-200 bg-white p-5">
                        <div className="flex items-center gap-2"><Wrench className="h-5 w-5 text-amber-600" /><h2 className="font-black">Billing provider state</h2></div>
                        <p className="mt-3 text-sm leading-6 text-slate-600">The panel intentionally shows enablement flags and health only. Provider credentials and encryption material are never returned.</p>
                        <div className="mt-4 space-y-2">
                          {Object.entries(operations.billing?.providers || {}).map(([name, enabled]) => (
                            <div key={name} className="flex items-center justify-between rounded-xl bg-slate-50 p-3 text-sm"><span className="font-semibold">{name}</span><Badge tone={enabled ? 'green' : 'slate'}>{enabled ? 'enabled' : 'disabled'}</Badge></div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </>
                )}
              </section>
            )}

            {section === 'roadmap' && (
              <section className="space-y-5">
                <div className="rounded-2xl border border-indigo-200 bg-indigo-50 p-5">
                  <div className="flex items-start gap-3">
                    <BookOpenCheck className="mt-0.5 h-5 w-5 text-indigo-700" />
                    <div>
                      <h2 className="font-black text-indigo-950">Post-MVP capabilities are intentionally visible, not fake</h2>
                      <p className="mt-2 text-sm leading-6 text-indigo-800">Every item below is a product placeholder with its intended contract. Buttons that would mutate money, privacy or identity remain absent until the underlying implementation is trustworthy.</p>
                    </div>
                  </div>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  {roadmap.map((item) => (
                    <div key={`${item.area}:${item.title}`} className="rounded-2xl border border-slate-200 bg-white p-5">
                      <div className="flex items-center justify-between gap-2"><Badge tone="indigo">{item.area}</Badge><Badge tone="amber">TODO</Badge></div>
                      <h3 className="mt-4 font-black">{item.title}</h3>
                      <p className="mt-2 text-sm leading-6 text-slate-600">{item.description}</p>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {sectionLoading && <div className="fixed bottom-5 right-5 rounded-full bg-slate-950 p-3 text-white shadow-xl"><RefreshCw className="h-4 w-4 animate-spin" /></div>}
          </div>
        </main>
      </div>
    </div>
  );
}
