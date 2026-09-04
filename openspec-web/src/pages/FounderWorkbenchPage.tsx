import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Bell,
  Check,
  ClipboardCheck,
  Copy,
  ExternalLink,
  Eye,
  FileText,
  Flag,
  Gauge,
  LifeBuoy,
  Loader2,
  LockKeyhole,
  Megaphone,
  RefreshCw,
  Save,
  ShieldCheck,
  Users,
  WalletCards,
} from 'lucide-react';

type JsonRecord = Record<string, any>;
type Section = 'launch' | 'ai' | 'customers' | 'errors' | 'revenue' | 'privacy' | 'growth' | 'flags' | 'announcements' | 'diagnostic' | 'capabilities';

const NAV: Array<{ id: Section; label: string; icon: any }> = [
  { id: 'launch', label: 'Launch checklist', icon: ClipboardCheck },
  { id: 'ai', label: 'AI brief', icon: FileText },
  { id: 'customers', label: 'Customer 360', icon: Users },
  { id: 'errors', label: 'Error Center', icon: AlertTriangle },
  { id: 'revenue', label: 'Reconciliation', icon: WalletCards },
  { id: 'privacy', label: 'Privacy requests', icon: ShieldCheck },
  { id: 'growth', label: 'Cohorts & funnel', icon: BarChart3 },
  { id: 'flags', label: 'Feature flags', icon: Flag },
  { id: 'announcements', label: 'Announcements', icon: Bell },
  { id: 'diagnostic', label: 'Customer diagnostic', icon: Eye },
  { id: 'capabilities', label: 'Capability status', icon: Gauge },
];

function apiBase() {
  return window.location.origin.includes('localhost') ? 'http://localhost:8000' : window.location.origin;
}

async function api(path: string, init?: RequestInit): Promise<any> {
  const response = await fetch(`${apiBase()}${path}`, {
    credentials: 'include',
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof data?.detail === 'string' ? data.detail : `Request failed (${response.status})`);
  return data;
}

async function apiText(path: string): Promise<string> {
  const response = await fetch(`${apiBase()}${path}`, { credentials: 'include', cache: 'no-store' });
  const text = await response.text();
  if (!response.ok) throw new Error(text || `Request failed (${response.status})`);
  return text;
}

function Card({ title, icon: Icon, children, right }: { title: string; icon?: any; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {Icon && <Icon className="h-5 w-5 text-indigo-600" />}
          <h2 className="font-black text-slate-950">{title}</h2>
        </div>
        {right}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Pill({ children, tone = 'slate' }: { children: React.ReactNode; tone?: 'slate' | 'green' | 'amber' | 'red' | 'indigo' }) {
  const classes = {
    slate: 'border-slate-200 bg-slate-50 text-slate-600',
    green: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    amber: 'border-amber-200 bg-amber-50 text-amber-800',
    red: 'border-red-200 bg-red-50 text-red-700',
    indigo: 'border-indigo-200 bg-indigo-50 text-indigo-700',
  };
  return <span className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-bold ${classes[tone]}`}>{children}</span>;
}

function statusTone(value: string): 'slate' | 'green' | 'amber' | 'red' | 'indigo' {
  if (value === 'published' || value === 'implemented' || value === 'implemented_safe' || value === 'implemented_local' || value === 'implemented_case_management') return 'green';
  if (value === 'preparing') return 'amber';
  if (value.startsWith('blocked')) return 'red';
  return 'slate';
}

export function FounderWorkbenchPage() {
  const [section, setSection] = useState<Section>('launch');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [me, setMe] = useState<JsonRecord>({});
  const [checklist, setChecklist] = useState<JsonRecord>({ items: [], counts: {} });
  const [customers, setCustomers] = useState<JsonRecord[]>([]);
  const [errors, setErrors] = useState<JsonRecord>({ errors: [], counts: {} });
  const [reconciliation, setReconciliation] = useState<JsonRecord>({ issues: [], summary: {} });
  const [cohorts, setCohorts] = useState<JsonRecord>({ cohorts: [], funnel_30d: {} });
  const [privacy, setPrivacy] = useState<JsonRecord[]>([]);
  const [flags, setFlags] = useState<JsonRecord[]>([]);
  const [announcements, setAnnouncements] = useState<JsonRecord[]>([]);
  const [capabilities, setCapabilities] = useState<JsonRecord[]>([]);
  const [shortcuts, setShortcuts] = useState<JsonRecord[]>([]);
  const [password, setPassword] = useState('');
  const [selectedUserId, setSelectedUserId] = useState('');
  const [timeline, setTimeline] = useState<JsonRecord | null>(null);
  const [support, setSupport] = useState<JsonRecord[]>([]);
  const [diagnostic, setDiagnostic] = useState<JsonRecord | null>(null);
  const [supportNote, setSupportNote] = useState('');
  const [supportTags, setSupportTags] = useState('');
  const [privacyType, setPrivacyType] = useState('export');
  const [privacyReason, setPrivacyReason] = useState('');
  const [flagForm, setFlagForm] = useState({ key: '', description: '', enabled: false, rollout_pct: 0, workspace_ids: '' });
  const [announcementForm, setAnnouncementForm] = useState({ title: '', body: '', active: false, tiers: '' });
  const [briefPreview, setBriefPreview] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [meData, checklistData, customerData, errorData, revenueData, cohortData, privacyData, flagData, announcementData, capabilityData, shortcutData] = await Promise.all([
        api('/api/control/me'),
        api('/api/control/launch-checklist'),
        api('/api/control/founder/customers?limit=75'),
        api('/api/control/founder/errors?limit=150'),
        api('/api/control/founder/reconciliation'),
        api('/api/control/founder/cohorts?weeks=8'),
        api('/api/control/founder/privacy-requests'),
        api('/api/control/founder/feature-flags'),
        api('/api/control/founder/announcements'),
        api('/api/control/founder/capabilities'),
        api('/api/control/founder/shortcuts'),
      ]);
      setMe(meData);
      setChecklist(checklistData);
      setCustomers(customerData.customers || []);
      setErrors(errorData);
      setReconciliation(revenueData);
      setCohorts(cohortData);
      setPrivacy(privacyData.requests || []);
      setFlags(flagData.flags || []);
      setAnnouncements(announcementData.announcements || []);
      setCapabilities(capabilityData.capabilities || []);
      setShortcuts(shortcutData.shortcuts || []);
      if (!selectedUserId && customerData.customers?.length) setSelectedUserId(customerData.customers[0].id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Founder Workbench unavailable');
    } finally {
      setLoading(false);
    }
  }, [selectedUserId]);

  useEffect(() => { void load(); }, [load]);

  const unlock = async () => {
    try {
      setError(null);
      const result = await api('/api/control/elevate', { method: 'POST', body: JSON.stringify({ password }) });
      setPassword('');
      setMe((old: JsonRecord) => ({ ...old, ...result, elevated: true }));
      setNotice('Sensitive founder writes unlocked for the configured short window.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not unlock');
    }
  };

  const mutate = async (path: string, init: RequestInit, success: string) => {
    try {
      setError(null);
      await api(path, init);
      setNotice(success);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed');
    }
  };

  const loadCustomer = useCallback(async (userId: string) => {
    if (!userId) return;
    try {
      const [timelineData, supportData, diagnosticData] = await Promise.all([
        api(`/api/control/founder/customers/${encodeURIComponent(userId)}/timeline`),
        api(`/api/control/founder/customers/${encodeURIComponent(userId)}/support`),
        api(`/api/control/founder/diagnostic/customers/${encodeURIComponent(userId)}`),
      ]);
      setTimeline(timelineData);
      setSupport(supportData.notes || []);
      setDiagnostic(diagnosticData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Customer data unavailable');
    }
  }, []);

  useEffect(() => { if (selectedUserId) void loadCustomer(selectedUserId); }, [selectedUserId, loadCustomer]);

  const checklistPublished = Number(checklist?.counts?.published || 0);
  const checklistTotal = Number(checklist?.total || 0);
  const activeFlags = flags.filter((item) => item.enabled).length;
  const activeAnnouncements = announcements.filter((item) => item.active).length;
  const selectedCustomer = customers.find((item) => item.id === selectedUserId);

  const groupedChecklist = useMemo(() => {
    const groups: Record<string, JsonRecord[]> = {};
    for (const item of checklist.items || []) (groups[item.group] ||= []).push(item);
    return groups;
  }, [checklist]);

  const patchChecklistLocal = (key: string, patch: JsonRecord) => {
    setChecklist((old: JsonRecord) => ({ ...old, items: (old.items || []).map((item: JsonRecord) => item.key === key ? { ...item, ...patch } : item) }));
  };

  const saveChecklist = async (item: JsonRecord) => {
    await mutate(`/api/control/launch-checklist/${encodeURIComponent(item.key)}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: item.status, link: item.link || '', notes: item.notes || '' }),
    }, `Saved ${item.channel}`);
  };

  const copyBrief = async () => {
    try {
      const text = await apiText('/api/control/briefing.md');
      await navigator.clipboard.writeText(text);
      setBriefPreview(text);
      setNotice('Live founder AI brief copied.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not copy AI brief');
    }
  };

  const previewBrief = async () => {
    try { setBriefPreview(await apiText('/api/control/briefing.md')); }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not load AI brief'); }
  };

  if (loading) {
    return <div className="grid min-h-[70vh] place-items-center bg-slate-100"><Loader2 className="h-8 w-8 animate-spin text-indigo-600" /></div>;
  }

  if (error && !checklistTotal) {
    return (
      <div className="min-h-screen bg-slate-100 px-4 py-12">
        <div className="mx-auto max-w-xl rounded-3xl border border-red-200 bg-white p-8">
          <LockKeyhole className="h-10 w-10 text-red-500" />
          <h1 className="mt-4 text-2xl font-black">Founder Workbench unavailable</h1>
          <p className="mt-3 text-sm text-slate-600">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100 text-slate-950">
      <header className="border-b border-slate-200 bg-white px-4 py-5 md:px-7">
        <div className="mx-auto flex max-w-7xl flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-xs font-black uppercase tracking-[0.2em] text-indigo-600">Founder Workbench</div>
            <h1 className="mt-1 text-2xl font-black tracking-tight">Launch, learning and product control</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">A private operating layer around the Product Radar: launch distribution, AI-readable live context and the safe first-party admin capabilities that used to be Post-MVP placeholders.</p>
          </div>
          <button type="button" onClick={() => void load()} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold hover:bg-slate-50"><RefreshCw className="h-4 w-4" /> Refresh all</button>
        </div>
      </header>

      <div className="mx-auto grid max-w-7xl gap-5 px-4 py-6 md:px-7 xl:grid-cols-[250px_minmax(0,1fr)]">
        <aside className="space-y-4">
          <div className="rounded-3xl bg-slate-950 p-3 text-white">
            <div className="grid gap-1">
              {NAV.map(({ id, label, icon: Icon }) => (
                <button key={id} type="button" onClick={() => setSection(id)} className={`flex items-center gap-2 rounded-xl px-3 py-2.5 text-left text-sm font-bold ${section === id ? 'bg-white text-slate-950' : 'text-slate-300 hover:bg-slate-900'}`}>
                  <Icon className="h-4 w-4" /> {label}
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-4">
            <div className="flex items-center justify-between"><span className="text-xs font-black uppercase tracking-wider text-slate-500">Founder writes</span><Pill tone={me.elevated ? 'green' : 'amber'}>{me.elevated ? 'unlocked' : 'locked'}</Pill></div>
            {!me.elevated && (
              <div className="mt-3 space-y-2">
                <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Password for step-up" className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400" />
                <button type="button" onClick={() => void unlock()} disabled={!password} className="w-full rounded-xl bg-slate-950 px-3 py-2 text-sm font-bold text-white disabled:opacity-40">Unlock sensitive writes</button>
              </div>
            )}
            <p className="mt-3 text-[11px] leading-5 text-slate-400">Checklist, support notes, privacy cases, flags and announcements require the same short-lived founder step-up as other sensitive control mutations.</p>
          </div>

          <div className="grid gap-2">
            {shortcuts.map((item) => <a key={item.label} href={item.href} target={String(item.href).startsWith('http') ? '_blank' : undefined} rel="noreferrer" className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-600 hover:border-indigo-200 hover:text-indigo-700"><span>{item.label}</span><ExternalLink className="h-3.5 w-3.5" /></a>)}
          </div>
        </aside>

        <main className="min-w-0 space-y-5">
          {error && <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
          {notice && <div className="flex items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"><Check className="h-4 w-4" /> {notice}</div>}

          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-2xl bg-slate-950 p-4 text-white"><div className="text-xs text-slate-400">Launch published</div><div className="mt-2 text-3xl font-black">{checklistPublished}/{checklistTotal}</div></div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4"><div className="text-xs text-slate-400">Local money issues</div><div className="mt-2 text-3xl font-black">{Number(reconciliation?.summary?.high || 0) + Number(reconciliation?.summary?.medium || 0)}</div></div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4"><div className="text-xs text-slate-400">Runtime flags on</div><div className="mt-2 text-3xl font-black">{activeFlags}</div></div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4"><div className="text-xs text-slate-400">Active announcements</div><div className="mt-2 text-3xl font-black">{activeAnnouncements}</div></div>
          </section>

          {section === 'launch' && (
            <Card title="Where and how to publish VibeUs" icon={Megaphone} right={<Pill tone={checklistPublished === checklistTotal && checklistTotal > 0 ? 'green' : 'indigo'}>{checklistPublished}/{checklistTotal} published</Pill>}>
              <p className="text-sm leading-6 text-slate-500">This is your private launch runbook. The strategy text comes from the server catalog; your state, publication link and notes persist in the founder audit ledger. Community rules are deliberately marked for re-check before posting.</p>
              <div className="mt-5 space-y-6">
                {Object.entries(groupedChecklist).map(([group, items]) => (
                  <div key={group}>
                    <div className="mb-2 text-xs font-black uppercase tracking-[0.18em] text-slate-400">{group}</div>
                    <div className="grid gap-3">
                      {items.map((item) => (
                        <div key={item.key} className="rounded-2xl border border-slate-200 p-4">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2"><h3 className="font-black">{item.channel}</h3><Pill>{item.market}</Pill><Pill tone={statusTone(item.status)}>{item.status}</Pill></div>
                              <p className="mt-2 text-sm leading-6 text-slate-600">{item.goal}</p>
                              <div className="mt-3 grid gap-3 lg:grid-cols-2">
                                <div className="rounded-xl bg-slate-50 p-3 text-xs leading-5"><span className="font-black">How:</span> {item.format}</div>
                                <div className="rounded-xl bg-slate-50 p-3 text-xs leading-5"><span className="font-black">Success:</span> {item.success_signal}</div>
                              </div>
                              <div className="mt-3 flex flex-wrap gap-1.5">{(item.preflight || []).map((value: string) => <span key={value} className="rounded-lg border border-slate-200 px-2 py-1 text-[11px] text-slate-500">{value}</span>)}</div>
                              <p className="mt-3 text-[11px] leading-5 text-amber-700">{item.rules_note}</p>
                            </div>
                          </div>
                          <div className="mt-4 grid gap-2 md:grid-cols-[150px_minmax(0,1fr)]">
                            <select value={item.status} onChange={(event) => patchChecklistLocal(item.key, { status: event.target.value })} className="rounded-xl border border-slate-200 px-3 py-2 text-sm">
                              <option value="todo">todo</option><option value="preparing">preparing</option><option value="published">published</option><option value="skipped">skipped</option>
                            </select>
                            <input value={item.link || ''} onChange={(event) => patchChecklistLocal(item.key, { link: event.target.value })} placeholder={item.destination || 'Published URL'} className="rounded-xl border border-slate-200 px-3 py-2 text-sm" />
                          </div>
                          <textarea value={item.notes || ''} onChange={(event) => patchChecklistLocal(item.key, { notes: event.target.value })} placeholder="Private note: angle, result, what to change next time…" rows={2} className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" />
                          <div className="mt-2 flex justify-end"><button type="button" disabled={!me.elevated} onClick={() => void saveChecklist(item)} className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-3 py-2 text-xs font-bold text-white disabled:opacity-40"><Save className="h-3.5 w-3.5" /> Save progress</button></div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {section === 'ai' && (
            <Card title="Always-current Markdown for AI strategy" icon={FileText} right={<Pill tone="green">live · no-store</Pill>}>
              <p className="text-sm leading-6 text-slate-600">The Markdown is generated on request from the same live Product Radar data. It includes every radar dimension, confidence/sample, Steering Queue, guardrails, instrumentation gaps, launch checklist progress and local money reconciliation — but excludes customer free-form content and secrets.</p>
              <div className="mt-4 flex flex-wrap gap-2">
                <button type="button" onClick={() => void copyBrief()} className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2 text-sm font-bold text-white"><Copy className="h-4 w-4" /> Copy live AI brief</button>
                <button type="button" onClick={() => void previewBrief()} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-2 text-sm font-bold"><Eye className="h-4 w-4" /> Preview</button>
                <a href="/api/control/briefing.md" target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-2 text-sm font-bold"><ExternalLink className="h-4 w-4" /> Open .md</a>
              </div>
              <div className="mt-4 rounded-2xl border border-indigo-100 bg-indigo-50 p-4 text-sm leading-6 text-indigo-900"><span className="font-black">Use it like this:</span> paste the brief into ChatGPT/another AI and ask it to diagnose the product, choose the highest-leverage steering decision, propose one experiment, and name what should not be optimized yet.</div>
              {briefPreview && <pre className="mt-4 max-h-[680px] overflow-auto whitespace-pre-wrap rounded-2xl bg-slate-950 p-4 text-xs leading-5 text-slate-200">{briefPreview}</pre>}
            </Card>
          )}

          {section === 'customers' && (
            <div className="space-y-5">
              <Card title="Customer 360" icon={Users} right={<Pill tone="green">read-only timeline</Pill>}>
                <select value={selectedUserId} onChange={(event) => setSelectedUserId(event.target.value)} className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm">
                  {customers.map((item) => <option key={item.id} value={item.id}>{item.email} · {item.id}</option>)}
                </select>
                {timeline && <div className="mt-4 grid gap-3 lg:grid-cols-[0.35fr_0.65fr]">
                  <div className="space-y-3">
                    <div className="rounded-2xl bg-slate-50 p-4 text-sm"><div className="font-black">{timeline.customer?.email}</div><div className="mt-1 text-xs text-slate-500">{timeline.workspaces?.length || 0} workspaces · {timeline.projects?.length || 0} projects</div></div>
                    {(timeline.workspaces || []).map((workspace: JsonRecord) => <div key={workspace.id} className="rounded-xl border border-slate-200 p-3 text-xs"><div className="font-black">{workspace.name}</div><div className="mt-1 text-slate-500">{workspace.tier} · {workspace.subscription_status} · {workspace.billing_provider}</div></div>)}
                  </div>
                  <div className="max-h-[520px] space-y-2 overflow-auto pr-1">{(timeline.timeline || []).map((item: JsonRecord, index: number) => <div key={`${item.at}-${item.kind}-${index}`} className="rounded-xl border border-slate-100 bg-slate-50 p-3"><div className="flex justify-between gap-3"><span className="text-xs font-black">{item.title}</span><span className="text-[10px] text-slate-400">{item.at}</span></div><div className="mt-1 text-[11px] text-slate-500">{item.kind}</div></div>)}</div>
                </div>}
              </Card>
              <Card title="Internal support notes & tags" icon={LifeBuoy} right={<Pill tone={me.elevated ? 'green' : 'amber'}>{me.elevated ? 'write enabled' : 'step-up required'}</Pill>}>
                <textarea value={supportNote} onChange={(event) => setSupportNote(event.target.value)} rows={3} placeholder="Internal note. Do not paste credentials or unnecessary sensitive data." className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" />
                <input value={supportTags} onChange={(event) => setSupportTags(event.target.value)} placeholder="tags, comma, separated" className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" />
                <div className="mt-2 flex justify-end"><button type="button" disabled={!me.elevated || !supportNote.trim() || !selectedUserId} onClick={() => void mutate(`/api/control/founder/customers/${encodeURIComponent(selectedUserId)}/support`, { method: 'POST', body: JSON.stringify({ note: supportNote, tags: supportTags.split(',').map((x) => x.trim()).filter(Boolean) }) }, 'Support note saved').then(() => { setSupportNote(''); setSupportTags(''); void loadCustomer(selectedUserId); })} className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-bold text-white disabled:opacity-40">Save note</button></div>
                <div className="mt-4 space-y-2">{support.map((item) => <div key={item.id} className="rounded-xl border border-slate-200 p-3"><div className="text-sm leading-6">{item.note}</div><div className="mt-2 flex flex-wrap gap-1">{(item.tags || []).map((tag: string) => <Pill key={tag}>{tag}</Pill>)}</div><div className="mt-2 text-[10px] text-slate-400">{item.created_at}</div></div>)}</div>
              </Card>
            </div>
          )}

          {section === 'errors' && (
            <Card title="Cross-project Error Center" icon={AlertTriangle} right={<Pill tone={Number(errors?.counts?.open || 0) > 0 ? 'amber' : 'green'}>{errors?.counts?.open || 0} open</Pill>}>
              <p className="mb-4 text-xs leading-5 text-slate-500">Founder-wide triage is read-only here. Resolving a customer runtime error still happens in the project flow and never silently accepts its linked ticket.</p>
              <div className="overflow-x-auto"><table className="w-full min-w-[850px] text-left text-xs"><thead><tr className="border-b border-slate-200 text-slate-400"><th className="py-2">Project</th><th>Status</th><th>Type</th><th>Route</th><th>Occurrences</th><th>Last seen</th><th>Ticket</th></tr></thead><tbody>{(errors.errors || []).map((item: JsonRecord) => <tr key={item.id} className="border-b border-slate-100"><td className="py-3 font-bold">{item.project_slug}</td><td><Pill tone={item.status === 'open' ? 'amber' : 'slate'}>{item.status}</Pill></td><td>{item.exception_type}<div className="max-w-xs truncate text-[10px] text-slate-400">{item.message}</div></td><td>{item.route || '—'}</td><td>{item.occurrences}</td><td>{item.last_seen_at || '—'}</td><td>{item.ticket_id || '—'}</td></tr>)}</tbody></table></div>
            </Card>
          )}

          {section === 'revenue' && (
            <Card title="Payment reconciliation" icon={WalletCards} right={<Pill tone={Number(reconciliation?.summary?.high || 0) ? 'red' : Number(reconciliation?.summary?.medium || 0) ? 'amber' : 'green'}>{Number(reconciliation?.summary?.high || 0)} high · {Number(reconciliation?.summary?.medium || 0)} medium</Pill>}>
              <div className="rounded-2xl border border-amber-100 bg-amber-50 p-4 text-xs leading-5 text-amber-900">{reconciliation.note}</div>
              <div className="mt-4 space-y-2">{(reconciliation.issues || []).length === 0 && <div className="rounded-xl bg-emerald-50 p-4 text-sm font-bold text-emerald-700">No local ledger/entitlement/fiscal invariant mismatch detected.</div>}{(reconciliation.issues || []).map((item: JsonRecord, index: number) => <div key={`${item.workspace_id}-${item.kind}-${index}`} className="rounded-xl border border-slate-200 p-3"><div className="flex flex-wrap items-center gap-2"><Pill tone={item.severity === 'high' ? 'red' : 'amber'}>{item.severity}</Pill><span className="font-black text-sm">{item.kind}</span><span className="text-xs text-slate-400">{item.workspace_id}</span></div><p className="mt-2 text-sm text-slate-600">{item.detail}</p></div>)}</div>
            </Card>
          )}

          {section === 'privacy' && (
            <Card title="Privacy data-request case management" icon={ShieldCheck} right={<Pill tone="amber">no destructive auto-delete</Pill>}>
              <div className="grid gap-2 md:grid-cols-[1fr_150px_1fr_auto]">
                <select value={selectedUserId} onChange={(event) => setSelectedUserId(event.target.value)} className="rounded-xl border border-slate-200 px-3 py-2 text-sm">{customers.map((item) => <option key={item.id} value={item.id}>{item.email}</option>)}</select>
                <select value={privacyType} onChange={(event) => setPrivacyType(event.target.value)} className="rounded-xl border border-slate-200 px-3 py-2 text-sm"><option value="export">export</option><option value="delete">delete</option><option value="anonymize">anonymize</option><option value="rectify">rectify</option></select>
                <input value={privacyReason} onChange={(event) => setPrivacyReason(event.target.value)} placeholder="Reason / source of request" className="rounded-xl border border-slate-200 px-3 py-2 text-sm" />
                <button type="button" disabled={!me.elevated || !selectedUserId} onClick={() => void mutate('/api/control/founder/privacy-requests', { method: 'POST', body: JSON.stringify({ user_id: selectedUserId, request_type: privacyType, reason: privacyReason }) }, 'Privacy request created').then(() => setPrivacyReason(''))} className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-bold text-white disabled:opacity-40">Create case</button>
              </div>
              <div className="mt-4 space-y-2">{privacy.map((item) => <div key={item.request_id} className="rounded-xl border border-slate-200 p-3"><div className="flex flex-wrap items-center justify-between gap-2"><div><span className="font-black text-sm">{item.request_type}</span><span className="ml-2 text-xs text-slate-400">{item.request_id} · user {item.target_user_id}</span></div><Pill tone={item.status === 'completed' ? 'green' : item.status === 'blocked_retention' ? 'red' : 'amber'}>{item.status}</Pill></div><p className="mt-2 text-xs text-slate-500">{item.reason || 'No reason note'}</p><div className="mt-2 flex flex-wrap gap-2"><a href={`${apiBase()}/api/control/founder/privacy-requests/${encodeURIComponent(item.request_id)}/preview`} target="_blank" rel="noreferrer" className="text-xs font-bold text-indigo-600">Open data manifest</a>{me.elevated && ['open', 'verifying', 'ready'].map((state) => <button key={state} type="button" onClick={() => void mutate(`/api/control/founder/privacy-requests/${encodeURIComponent(item.request_id)}`, { method: 'PATCH', body: JSON.stringify({ status: state, note: item.note || '' }) }, `Privacy case moved to ${state}`)} className="text-xs font-bold text-slate-500">→ {state}</button>)}</div></div>)}</div>
            </Card>
          )}

          {section === 'growth' && (
            <Card title="Cohorts & founder funnel" icon={BarChart3} right={<Pill tone={cohorts?.funnel_30d?.landing_denominator_instrumented ? 'green' : 'amber'}>{cohorts?.funnel_30d?.landing_denominator_instrumented ? 'landing measured' : 'landing denominator missing'}</Pill>}>
              <div className="grid gap-3 md:grid-cols-3"><div className="rounded-2xl bg-slate-950 p-4 text-white"><div className="text-xs text-slate-400">Signups · 30d</div><div className="mt-2 text-3xl font-black">{cohorts?.funnel_30d?.signups ?? 0}</div></div><div className="rounded-2xl bg-slate-50 p-4"><div className="text-xs text-slate-400">Activated ≤24h</div><div className="mt-2 text-3xl font-black">{cohorts?.funnel_30d?.activated_24h ?? 0}</div></div><div className="rounded-2xl bg-slate-50 p-4"><div className="text-xs text-slate-400">Paid users</div><div className="mt-2 text-3xl font-black">{cohorts?.funnel_30d?.paid_users ?? 0}</div></div></div>
              <p className="mt-3 text-xs leading-5 text-slate-500">{cohorts.note}</p>
              <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[620px] text-left text-xs"><thead><tr className="border-b border-slate-200 text-slate-400"><th className="py-2">Signup week</th><th>Signups</th><th>Activated ≤24h</th><th>Activation</th><th>Paid</th><th>Paid / signup</th></tr></thead><tbody>{(cohorts.cohorts || []).map((item: JsonRecord) => <tr key={item.week} className="border-b border-slate-100"><td className="py-3 font-bold">{item.week}</td><td>{item.signups}</td><td>{item.activated_24h}</td><td>{item.activation_pct ?? '—'}%</td><td>{item.paid}</td><td>{item.paid_pct ?? '—'}%</td></tr>)}</tbody></table></div>
            </Card>
          )}

          {section === 'flags' && (
            <Card title="Feature flags" icon={Flag} right={<Pill tone="green">runtime evaluator wired</Pill>}>
              <div className="grid gap-2 lg:grid-cols-[180px_1fr_100px_120px]">
                <input value={flagForm.key} onChange={(event) => setFlagForm({ ...flagForm, key: event.target.value })} placeholder="new_feature" className="rounded-xl border border-slate-200 px-3 py-2 text-sm" />
                <input value={flagForm.description} onChange={(event) => setFlagForm({ ...flagForm, description: event.target.value })} placeholder="What this flag controls" className="rounded-xl border border-slate-200 px-3 py-2 text-sm" />
                <input type="number" min={0} max={100} value={flagForm.rollout_pct} onChange={(event) => setFlagForm({ ...flagForm, rollout_pct: Number(event.target.value) })} className="rounded-xl border border-slate-200 px-3 py-2 text-sm" />
                <label className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm"><input type="checkbox" checked={flagForm.enabled} onChange={(event) => setFlagForm({ ...flagForm, enabled: event.target.checked })} /> enabled</label>
              </div>
              <input value={flagForm.workspace_ids} onChange={(event) => setFlagForm({ ...flagForm, workspace_ids: event.target.value })} placeholder="Optional workspace IDs, comma separated; empty = eligible for all authenticated users" className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" />
              <div className="mt-2 flex justify-end"><button type="button" disabled={!me.elevated || flagForm.key.length < 2} onClick={() => void mutate('/api/control/founder/feature-flags', { method: 'POST', body: JSON.stringify({ key: flagForm.key, description: flagForm.description, enabled: flagForm.enabled, rollout_pct: flagForm.rollout_pct, workspace_ids: flagForm.workspace_ids.split(',').map((x) => x.trim()).filter(Boolean) }) }, 'Feature flag saved').then(() => setFlagForm({ key: '', description: '', enabled: false, rollout_pct: 0, workspace_ids: '' }))} className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-bold text-white disabled:opacity-40">Save flag</button></div>
              <div className="mt-4 space-y-2">{flags.map((item) => <button key={item.key} type="button" onClick={() => setFlagForm({ key: item.key, description: item.description || '', enabled: Boolean(item.enabled), rollout_pct: Number(item.rollout_pct || 0), workspace_ids: (item.workspace_ids || []).join(', ') })} className="flex w-full items-center justify-between rounded-xl border border-slate-200 p-3 text-left"><div><div className="text-sm font-black">{item.key}</div><div className="mt-1 text-xs text-slate-500">{item.description || 'No description'} · rollout {item.rollout_pct}%</div></div><Pill tone={item.enabled ? 'green' : 'slate'}>{item.enabled ? 'on' : 'off'}</Pill></button>)}</div>
            </Card>
          )}

          {section === 'announcements' && (
            <Card title="Announcements" icon={Bell} right={<Pill tone="green">authenticated targeting wired</Pill>}>
              <input value={announcementForm.title} onChange={(event) => setAnnouncementForm({ ...announcementForm, title: event.target.value })} placeholder="Announcement title" className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" />
              <textarea value={announcementForm.body} onChange={(event) => setAnnouncementForm({ ...announcementForm, body: event.target.value })} placeholder="Message shown by consumers of /api/announcements" rows={3} className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" />
              <div className="mt-2 grid gap-2 md:grid-cols-[1fr_160px]"><input value={announcementForm.tiers} onChange={(event) => setAnnouncementForm({ ...announcementForm, tiers: event.target.value })} placeholder="Optional tiers: free, solo, studio" className="rounded-xl border border-slate-200 px-3 py-2 text-sm" /><label className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm"><input type="checkbox" checked={announcementForm.active} onChange={(event) => setAnnouncementForm({ ...announcementForm, active: event.target.checked })} /> active</label></div>
              <div className="mt-2 flex justify-end"><button type="button" disabled={!me.elevated || !announcementForm.title.trim() || !announcementForm.body.trim()} onClick={() => void mutate('/api/control/founder/announcements', { method: 'POST', body: JSON.stringify({ title: announcementForm.title, body: announcementForm.body, active: announcementForm.active, tiers: announcementForm.tiers.split(',').map((x) => x.trim()).filter(Boolean), workspace_ids: [] }) }, 'Announcement saved').then(() => setAnnouncementForm({ title: '', body: '', active: false, tiers: '' }))} className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-bold text-white disabled:opacity-40">Create announcement</button></div>
              <div className="mt-4 space-y-2">{announcements.map((item) => <div key={item.announcement_id} className="rounded-xl border border-slate-200 p-3"><div className="flex items-center justify-between gap-2"><div className="font-black text-sm">{item.title}</div><Pill tone={item.active ? 'green' : 'slate'}>{item.active ? 'active' : 'inactive'}</Pill></div><p className="mt-2 text-sm leading-6 text-slate-600">{item.body}</p><div className="mt-2 text-[10px] text-slate-400">tiers: {(item.tiers || []).join(', ') || 'all'} · {item.updated_at}</div></div>)}</div>
            </Card>
          )}

          {section === 'diagnostic' && (
            <Card title="Read-only customer diagnostic" icon={Eye} right={<Pill tone="green">no impersonation</Pill>}>
              <select value={selectedUserId} onChange={(event) => setSelectedUserId(event.target.value)} className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm">{customers.map((item) => <option key={item.id} value={item.id}>{item.email}</option>)}</select>
              {diagnostic && <div className="mt-4"><div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-4 text-xs leading-5 text-emerald-900">{diagnostic.safety}</div><div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{Object.entries(diagnostic.counts || {}).map(([key, value]) => <div key={key} className="rounded-xl bg-slate-50 p-3"><div className="text-[11px] text-slate-400">{key.replaceAll('_', ' ')}</div><div className="mt-1 text-2xl font-black">{String(value)}</div></div>)}</div><pre className="mt-4 max-h-[500px] overflow-auto whitespace-pre-wrap rounded-2xl bg-slate-950 p-4 text-xs text-slate-200">{JSON.stringify({ customer: diagnostic.customer, workspaces: diagnostic.workspaces, projects: diagnostic.projects }, null, 2)}</pre></div>}
            </Card>
          )}

          {section === 'capabilities' && (
            <Card title="Former Post-MVP capability status" icon={Activity}>
              <p className="mb-4 text-sm leading-6 text-slate-500">The old roadmap is now split into real first-party capabilities and explicit external/security dependencies. A green row means there is an actual endpoint/workflow, not a decorative button.</p>
              <div className="grid gap-3 md:grid-cols-2">{capabilities.map((item) => <div key={item.key} className="rounded-2xl border border-slate-200 p-4"><div className="flex flex-wrap items-center justify-between gap-2"><div className="font-black">{item.key.replaceAll('_', ' ')}</div><Pill tone={statusTone(item.status)}>{item.status}</Pill></div><p className="mt-2 text-xs leading-5 text-slate-500">{item.detail}</p></div>)}</div>
              <div className="mt-4 rounded-2xl border border-red-100 bg-red-50 p-4 text-sm leading-6 text-red-900"><span className="font-black">Still intentionally blocked:</span> platform-admin passkey/MFA needs a real WebAuthn credential/recovery lifecycle; provider-side refund/recurring cancellation needs the actually approved live payment provider and verified remote semantics.</div>
            </Card>
          )}
        </main>
      </div>
    </div>
  );
}
