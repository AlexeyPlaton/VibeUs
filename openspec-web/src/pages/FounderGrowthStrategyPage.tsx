import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  ClipboardList,
  Copy,
  Download,
  ExternalLink,
  FileJson,
  FileText,
  Loader2,
  LockKeyhole,
  RefreshCw,
  Save,
  Target,
  Upload,
} from 'lucide-react';

type JsonRecord = Record<string, any>;
type StrategyStatus = 'todo' | 'preparing' | 'done' | 'skipped';
type WorkflowState = 'todo' | 'preparing' | 'skipped';

function apiBase() {
  return window.location.origin.includes('localhost') ? 'http://localhost:8000' : window.location.origin;
}

async function api(path: string, init?: RequestInit): Promise<any> {
  const response = await fetch(`${apiBase()}${path}`, {
    credentials: 'include',
    cache: 'no-store',
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

function statusClasses(status: StrategyStatus) {
  if (status === 'done') return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  if (status === 'preparing') return 'border-amber-200 bg-amber-50 text-amber-800';
  if (status === 'skipped') return 'border-slate-300 bg-slate-100 text-slate-500';
  return 'border-indigo-200 bg-indigo-50 text-indigo-700';
}

function StatusPill({ status }: { status: StrategyStatus }) {
  return <span className={`rounded-full border px-2.5 py-1 text-[11px] font-black ${statusClasses(status)}`}>{status}</span>;
}

function MetricCard({ label, value, note }: { label: string; value: React.ReactNode; note?: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-xs font-bold uppercase tracking-wider text-slate-400">{label}</div>
      <div className="mt-2 text-3xl font-black text-slate-950">{value}</div>
      {note && <div className="mt-1 text-xs leading-5 text-slate-500">{note}</div>}
    </div>
  );
}

function downloadJson(filename: string, value: unknown) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function FounderGrowthStrategyPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [me, setMe] = useState<JsonRecord>({});
  const [data, setData] = useState<JsonRecord>({ items: [], counts: {}, next: [], radar: {} });
  const [password, setPassword] = useState('');
  const [mdPreview, setMdPreview] = useState('');
  const [importText, setImportText] = useState('');
  const [archiveMissing, setArchiveMissing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [meData, strategyData] = await Promise.all([
        api('/api/control/me'),
        api('/api/control/growth-strategy'),
      ]);
      setMe(meData);
      setData(strategyData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Founder strategy unavailable');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const grouped = useMemo(() => {
    const groups: Record<string, JsonRecord[]> = {};
    for (const item of data.items || []) {
      const key = `Wave ${item.wave} — ${item.phase}`;
      (groups[key] ||= []).push(item);
    }
    return groups;
  }, [data.items]);

  const patchLocal = (key: string, patch: JsonRecord) => {
    setData((old: JsonRecord) => ({
      ...old,
      items: (old.items || []).map((item: JsonRecord) => {
        if (item.key !== key) return item;
        const next = { ...item, ...patch };
        next.status = String(next.actual || '').trim() ? 'done' : next.workflow_state;
        return next;
      }),
    }));
  };

  const unlock = async () => {
    try {
      setError(null);
      const result = await api('/api/control/elevate', {
        method: 'POST',
        body: JSON.stringify({ password }),
      });
      setPassword('');
      setMe((old: JsonRecord) => ({ ...old, ...result, elevated: true }));
      setNotice('Sensitive founder writes unlocked for the configured short window.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not unlock founder writes');
    }
  };

  const saveProgress = async (item: JsonRecord) => {
    try {
      setError(null);
      const saved = await api(`/api/control/growth-strategy/${encodeURIComponent(item.key)}/progress`, {
        method: 'PATCH',
        body: JSON.stringify({
          workflow_state: item.workflow_state || 'todo',
          actual: item.actual || '',
          link: item.link || '',
          result: item.result || '',
        }),
      });
      setData((old: JsonRecord) => ({
        ...old,
        items: (old.items || []).map((value: JsonRecord) => value.key === saved.key ? saved : value),
      }));
      setNotice(saved.status === 'done' ? `Completed: ${saved.title}` : `Saved: ${saved.title}`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save strategy progress');
    }
  };

  const importStrategy = async () => {
    try {
      setError(null);
      let parsed = JSON.parse(importText || '{}');
      if (Array.isArray(parsed)) parsed = { items: parsed };
      if (parsed?.definitions?.items && !parsed.items) parsed = parsed.definitions;
      if (!Array.isArray(parsed?.items)) throw new Error('Import JSON must contain an items array.');
      const result = await api('/api/control/growth-strategy/import', {
        method: 'POST',
        body: JSON.stringify({ items: parsed.items, archive_missing: archiveMissing }),
      });
      setImportText('');
      setNotice(`Imported ${result.total} private strategy items.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not import private strategy');
    }
  };

  const readStrategyFile = async (file?: File) => {
    if (!file) return;
    try {
      setImportText(await file.text());
      setNotice(`Loaded ${file.name} locally. Nothing is saved until you press Import.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read strategy file');
    }
  };

  const copyStrategyMd = async () => {
    try {
      const text = await apiText('/api/control/growth-strategy.md');
      await navigator.clipboard.writeText(text);
      setMdPreview(text);
      setNotice('Live strategy + Product Radar Markdown copied.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not copy strategy Markdown');
    }
  };

  const previewStrategyMd = async () => {
    try {
      setMdPreview(await apiText('/api/control/growth-strategy.md'));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load strategy Markdown');
    }
  };

  const exportStrategy = async () => {
    try {
      const value = await api('/api/control/growth-strategy/export');
      downloadJson('vibeus-founder-strategy-backup.json', value);
      setNotice('Private founder strategy backup exported from this instance.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not export strategy');
    }
  };

  const copyPlan = async (item: JsonRecord) => {
    const text = [
      item.title,
      `Channel: ${item.channel}`,
      `Goal: ${item.goal}`,
      `Trigger: ${item.trigger}`,
      `Planned brief: ${item.planned}`,
      `Format: ${item.format}`,
      `Success signal: ${item.success_signal}`,
    ].join('\n\n');
    await navigator.clipboard.writeText(text);
    setNotice(`Plan copied: ${item.channel}`);
  };

  if (loading) {
    return <div className="grid min-h-[70vh] place-items-center bg-slate-100"><Loader2 className="h-8 w-8 animate-spin text-indigo-600" /></div>;
  }

  if (error && !Array.isArray(data.items)) {
    return (
      <div className="min-h-screen bg-slate-100 px-4 py-12">
        <div className="mx-auto max-w-xl rounded-3xl border border-red-200 bg-white p-8">
          <LockKeyhole className="h-10 w-10 text-red-500" />
          <h1 className="mt-4 text-2xl font-black">Founder Strategy unavailable</h1>
          <p className="mt-3 text-sm text-slate-600">{error}</p>
        </div>
      </div>
    );
  }

  const total = Number(data.total || 0);
  const done = Number(data.counts?.done || 0);
  const preparing = Number(data.counts?.preparing || 0);
  const northStar = data.radar?.north_star || {};

  return (
    <div className="min-h-screen bg-slate-100 text-slate-950">
      <header className="border-b border-slate-200 bg-white px-4 py-6 md:px-7">
        <div className="mx-auto flex max-w-7xl flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-xs font-black uppercase tracking-[0.2em] text-indigo-600">Private founder strategy</div>
            <h1 className="mt-1 text-3xl font-black tracking-tight">Plan → actual execution → measured learning</h1>
            <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-600">
              Strategy definitions are imported into this instance and are not bundled in the public repository. Paste what you actually published or completed into a card; any non-empty actual-evidence field makes that card done automatically and the same evidence appears in the private live AI Markdown.
            </p>
          </div>
          <button type="button" onClick={() => void load()} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold hover:bg-slate-50"><RefreshCw className="h-4 w-4" /> Refresh</button>
        </div>
      </header>

      <div className="mx-auto max-w-7xl space-y-5 px-4 py-6 md:px-7">
        {error && <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
        {notice && <div className="flex items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"><CheckCircle2 className="h-4 w-4" /> {notice}</div>}

        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard label="Strategy completed" value={`${done}/${total}`} note="Actual evidence closes a card automatically." />
          <MetricCard label="Preparing" value={preparing} note="Drafting/setup in progress." />
          <MetricCard label="North Star" value={northStar.value ?? '—'} note={northStar.name || 'Weekly Value Workspaces'} />
          <MetricCard label="Data confidence" value={`${Number(data.radar?.data_coverage?.pct || 0)}%`} note="Measured steering coverage from Product Radar." />
        </section>

        <section className="grid gap-4 xl:grid-cols-[0.58fr_0.42fr]">
          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2"><FileJson className="h-5 w-5 text-indigo-600" /><h2 className="font-black">Private strategy pack</h2></div>
              <button type="button" onClick={() => void exportStrategy()} disabled={!total} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold disabled:opacity-40"><Download className="h-3.5 w-3.5" /> Export backup</button>
            </div>
            <p className="mt-3 text-sm leading-6 text-slate-600">Load a JSON pack from your computer or paste it below. The browser reads the selected file locally; the plan is saved only when you explicitly import it into this platform-admin account.</p>
            <label className="mt-4 flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-indigo-300 bg-indigo-50 px-4 py-3 text-sm font-black text-indigo-700 hover:bg-indigo-100">
              <Upload className="h-4 w-4" /> Load JSON file locally
              <input type="file" accept="application/json,.json" className="hidden" onChange={(event) => void readStrategyFile(event.target.files?.[0])} />
            </label>
            <textarea value={importText} onChange={(event) => setImportText(event.target.value)} rows={7} placeholder={'{"items":[{"key":"...","wave":0,"phase":"..."}]}' } className="mt-3 w-full rounded-xl border border-slate-200 px-3 py-2 font-mono text-xs leading-5 outline-none focus:border-indigo-400" />
            <label className="mt-2 flex items-start gap-2 text-xs text-slate-500"><input type="checkbox" checked={archiveMissing} onChange={(event) => setArchiveMissing(event.target.checked)} className="mt-0.5" /> Archive existing strategy cards that are missing from this imported pack.</label>
            <button type="button" onClick={() => void importStrategy()} disabled={!me.elevated || !importText.trim()} className="mt-3 inline-flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-black text-white disabled:opacity-40"><Upload className="h-4 w-4" /> Import private strategy</button>
          </div>

          <div className="rounded-3xl bg-slate-950 p-5 text-white shadow-sm">
            <div className="flex items-center gap-2"><FileText className="h-5 w-5 text-indigo-300" /><h2 className="font-black">Live AI context</h2></div>
            <p className="mt-3 text-sm leading-6 text-slate-300">One private .md combines Product Radar, Steering Queue, every saved plan, every actual publication/completion field, links and learnings. Founder-entered fields are included verbatim, so do not paste credentials or unnecessary personal data if you plan to share the brief with an external AI.</p>
            <div className="mt-4 grid gap-2">
              <button type="button" onClick={() => void copyStrategyMd()} className="inline-flex items-center justify-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-black text-slate-950"><Copy className="h-4 w-4" /> Copy strategy + radar .md</button>
              <button type="button" onClick={() => void previewStrategyMd()} className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-700 px-4 py-2.5 text-sm font-bold text-white"><ClipboardList className="h-4 w-4" /> Preview .md</button>
              <a href="/api/control/growth-strategy.md" target="_blank" rel="noreferrer" className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-700 px-4 py-2.5 text-sm font-bold text-white"><ExternalLink className="h-4 w-4" /> Open live .md</a>
            </div>
          </div>
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2"><Target className="h-5 w-5 text-indigo-600" /><div><div className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">Next saved actions</div><h2 className="mt-1 text-xl font-black">Follow the plan unless live evidence says to steer</h2></div></div>
            <span className="rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1 text-xs font-black text-indigo-700">radar-aware context</span>
          </div>
          {(data.next || []).length ? (
            <div className="mt-4 grid gap-3 lg:grid-cols-2">
              {(data.next || []).map((item: JsonRecord) => (
                <div key={item.key} className="rounded-2xl border border-slate-200 p-4">
                  <div className="flex items-center gap-2"><StatusPill status={item.status as StrategyStatus} /><span className="text-xs font-bold text-slate-400">Wave {item.wave}</span></div>
                  <div className="mt-2 font-black">{item.title}</div>
                  <div className="mt-1 text-xs text-slate-500">{item.channel}</div>
                  <div className="mt-3 text-xs leading-5 text-slate-600"><span className="font-black">Trigger:</span> {item.trigger || 'No trigger saved.'}</div>
                </div>
              ))}
            </div>
          ) : <p className="mt-4 text-sm text-slate-500">No unfinished private strategy item is saved yet.</p>}
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-black">Founder write access</h2>
              <p className="mt-1 text-sm text-slate-500">Reading remains platform-admin only. Importing the private plan and saving execution evidence also requires short-lived password step-up.</p>
            </div>
            <span className={`rounded-full border px-3 py-1 text-xs font-black ${me.elevated ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-amber-200 bg-amber-50 text-amber-800'}`}>{me.elevated ? 'unlocked' : 'locked'}</span>
          </div>
          {!me.elevated && (
            <div className="mt-4 flex max-w-xl flex-col gap-2 sm:flex-row">
              <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Password for founder step-up" className="min-w-0 flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400" />
              <button type="button" disabled={!password} onClick={() => void unlock()} className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-black text-white disabled:opacity-40">Unlock writes</button>
            </div>
          )}
        </section>

        {!total && (
          <section className="rounded-3xl border border-dashed border-indigo-300 bg-indigo-50 p-8 text-center">
            <FileJson className="mx-auto h-9 w-9 text-indigo-500" />
            <h2 className="mt-3 text-xl font-black">No private strategy imported yet</h2>
            <p className="mx-auto mt-2 max-w-2xl text-sm leading-6 text-indigo-900/70">Import your founder strategy pack above. The public VibeUs repository intentionally contains the engine but not your concrete launch plan.</p>
          </section>
        )}

        <div className="space-y-7">
          {Object.entries(grouped).map(([group, items]) => (
            <section key={group}>
              <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
                <div><div className="text-xs font-black uppercase tracking-[0.2em] text-indigo-600">Execution wave</div><h2 className="mt-1 text-2xl font-black">{group}</h2></div>
                <span className="text-xs text-slate-400">{items.filter((item) => item.status === 'done').length}/{items.length} done</span>
              </div>

              <div className="grid gap-4">
                {items.map((item) => (
                  <article key={item.key} className={`rounded-3xl border bg-white p-5 shadow-sm ${item.status === 'done' ? 'border-emerald-200' : 'border-slate-200'}`}>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <StatusPill status={item.status as StrategyStatus} />
                          <span className="rounded-full border border-slate-200 px-2.5 py-1 text-[11px] font-bold text-slate-500">{item.channel}</span>
                          {item.market && <span className="rounded-full border border-slate-200 px-2.5 py-1 text-[11px] font-bold text-slate-500">{item.market}</span>}
                          <span className="rounded-full border border-slate-200 px-2.5 py-1 text-[11px] font-bold text-slate-500">{item.kind}</span>
                        </div>
                        <h3 className="mt-3 text-xl font-black tracking-tight">{item.title}</h3>
                        {item.goal && <p className="mt-2 text-sm leading-6 text-slate-600">{item.goal}</p>}
                      </div>
                      <button type="button" onClick={() => void copyPlan(item)} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold hover:bg-slate-50"><Copy className="h-3.5 w-3.5" /> Copy plan</button>
                    </div>

                    <div className="mt-4 grid gap-3 lg:grid-cols-2">
                      <div className="rounded-2xl bg-indigo-50 p-4">
                        <div className="text-[11px] font-black uppercase tracking-wider text-indigo-500">Planned article / action placeholder</div>
                        <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-indigo-950">{item.planned || 'No planned brief saved.'}</p>
                      </div>
                      <div className="rounded-2xl bg-slate-50 p-4">
                        <div className="text-[11px] font-black uppercase tracking-wider text-slate-400">When / format / success</div>
                        <p className="mt-2 text-xs leading-5 text-slate-600"><span className="font-black">Trigger:</span> {item.trigger || '—'}</p>
                        <p className="mt-2 text-xs leading-5 text-slate-600"><span className="font-black">Format:</span> {item.format || '—'}</p>
                        <p className="mt-2 text-xs leading-5 text-slate-600"><span className="font-black">Success:</span> {item.success_signal || '—'}</p>
                      </div>
                    </div>

                    {(item.preflight?.length || item.rules_note) && (
                      <details className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                        <summary className="cursor-pointer text-xs font-black text-slate-700">Preflight and channel cautions</summary>
                        <div className="mt-3 flex flex-wrap gap-1.5">{(item.preflight || []).map((value: string) => <span key={value} className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-500">{value}</span>)}</div>
                        {item.rules_note && <p className="mt-3 text-xs leading-5 text-amber-800">{item.rules_note}</p>}
                      </details>
                    )}

                    <div className="mt-5 rounded-2xl border-2 border-dashed border-indigo-200 bg-indigo-50/40 p-4">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <div className="text-sm font-black text-slate-950">What was actually published / completed</div>
                          <p className="mt-1 text-xs leading-5 text-slate-500">Paste the final public text or a concise factual completion record. On save, any non-empty value is completion evidence: the card becomes DONE and this exact field enters the private live AI Markdown.</p>
                        </div>
                        {item.completed_at && <span className="text-[11px] font-bold text-emerald-700">completed {item.completed_at}</span>}
                      </div>
                      <textarea value={item.actual || ''} onChange={(event) => patchLocal(item.key, { actual: event.target.value })} placeholder="Paste what was actually published or completed here…" rows={7} className="mt-3 w-full rounded-xl border border-indigo-200 bg-white px-3 py-2 text-sm leading-6 outline-none focus:border-indigo-400" />
                    </div>

                    <div className="mt-3 grid gap-3 lg:grid-cols-[180px_minmax(0,1fr)]">
                      <select value={item.workflow_state || 'todo'} disabled={Boolean(String(item.actual || '').trim())} onChange={(event) => patchLocal(item.key, { workflow_state: event.target.value as WorkflowState })} className="rounded-xl border border-slate-200 px-3 py-2 text-sm disabled:bg-emerald-50 disabled:text-emerald-700">
                        <option value="todo">todo</option>
                        <option value="preparing">preparing</option>
                        <option value="skipped">skipped</option>
                      </select>
                      <input value={item.link || ''} onChange={(event) => patchLocal(item.key, { link: event.target.value })} placeholder={item.destination || 'Published/article/artifact URL (optional)'} className="rounded-xl border border-slate-200 px-3 py-2 text-sm" />
                    </div>

                    <textarea value={item.result || ''} onChange={(event) => patchLocal(item.key, { result: event.target.value })} placeholder="Result / learning after the action: activation, replies, objections, what to repeat or stop…" rows={3} className="mt-3 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm leading-6" />

                    <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                      <div className="text-xs text-slate-400">{String(item.actual || '').trim() ? 'Saving this evidence will mark the item done automatically.' : 'No completion evidence yet; workflow state remains manual.'}</div>
                      <button type="button" disabled={!me.elevated} onClick={() => void saveProgress(item)} className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-black text-white disabled:opacity-40"><Save className="h-4 w-4" /> Save strategy state</button>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          ))}
        </div>

        {mdPreview && (
          <section className="rounded-3xl border border-slate-800 bg-slate-950 p-5 text-white">
            <div className="flex items-center justify-between gap-3"><h2 className="font-black">Live AI Markdown preview</h2><button type="button" onClick={() => setMdPreview('')} className="text-xs font-bold text-slate-400 hover:text-white">Close</button></div>
            <pre className="mt-4 max-h-[760px] overflow-auto whitespace-pre-wrap text-xs leading-5 text-slate-300">{mdPreview}</pre>
          </section>
        )}
      </div>
    </div>
  );
}
