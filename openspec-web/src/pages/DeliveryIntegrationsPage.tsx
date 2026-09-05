import { useEffect, useState } from 'react';
import { ArrowLeft, CheckCircle2, ExternalLink, GitBranch, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

type GithubStatus = {
  configured: boolean;
  partial: boolean;
  slug?: string | null;
  install_url?: string | null;
  setup_url?: string | null;
  state_ready?: boolean;
  app_installed: boolean;
  has_pat: boolean;
  credential_type?: 'github_app' | 'pat' | null;
  configuration_error?: string | null;
  github_repo?: string | null;
};

type PreviewProvider = 'github' | 'vercel' | 'render' | 'disabled';
type PreviewConfig = {
  provider: PreviewProvider;
  provider_project_id?: string | null;
  provider_scope_id?: string | null;
  review_url?: string | null;
  has_api_token: boolean;
  observe_only: boolean;
  safe_preview_request_supported?: boolean;
  production_deploy_allowed?: boolean;
};

function errorMessage(data: any, fallback: string) {
  return typeof data?.detail === 'string' ? data.detail : fallback;
}

export function DeliveryIntegrationsPage() {
  const { projectSlug = '' } = useParams();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [github, setGithub] = useState<GithubStatus | null>(null);
  const [preview, setPreview] = useState<PreviewConfig | null>(null);
  const [repo, setRepo] = useState('');
  const [provider, setProvider] = useState<PreviewProvider>('github');
  const [providerProjectId, setProviderProjectId] = useState('');
  const [providerScopeId, setProviderScopeId] = useState('');
  const [providerToken, setProviderToken] = useState('');
  const [clearToken, setClearToken] = useState(false);
  const [busy, setBusy] = useState('load');
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

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

  const applyPreview = (data: PreviewConfig) => {
    setPreview(data);
    setProvider(data.provider || 'github');
    setProviderProjectId(data.provider_project_id || '');
    setProviderScopeId(data.provider_scope_id || '');
    setProviderToken('');
    setClearToken(false);
  };

  const load = async () => {
    setBusy('load');
    try {
      const [githubData, previewData] = await Promise.all([
        request(`/api/projects/${encodeURIComponent(projectSlug)}/github/app`),
        request(`/api/projects/${encodeURIComponent(projectSlug)}/automation/preview`),
      ]);
      setGithub(githubData);
      setRepo(githubData.github_repo || '');
      applyPreview(previewData);
      setNotice(null);
    } catch (error: any) {
      setNotice({ ok: false, text: error?.message || t('v7.integrations.load_failed') });
    } finally {
      setBusy('');
    }
  };

  useEffect(() => { void load(); }, [projectSlug]);

  const beginInstall = async () => {
    if (!repo.trim()) return;
    setBusy('github-install');
    try {
      const data = await request(`/api/projects/${encodeURIComponent(projectSlug)}/github/app/install-intent`, {
        method: 'POST',
        body: JSON.stringify({ github_repo: repo.trim() }),
      });
      if (!data.install_url) throw new Error(t('v7.integrations.github_failed'));
      window.location.assign(data.install_url);
    } catch (error: any) {
      setNotice({ ok: false, text: error?.message || t('v7.integrations.github_failed') });
      setBusy('');
    }
  };

  const connectApp = async () => {
    if (!repo.trim()) return;
    setBusy('github-connect');
    try {
      const data = await request(`/api/projects/${encodeURIComponent(projectSlug)}/github/app/connect`, {
        method: 'POST',
        body: JSON.stringify({ github_repo: repo.trim() }),
      });
      setGithub(data);
      setRepo(data.github_repo || repo.trim());
      setNotice({ ok: true, text: t('v7.integrations.app_connected') });
    } catch (error: any) {
      setNotice({ ok: false, text: error?.message || t('v7.integrations.github_failed') });
    } finally { setBusy(''); }
  };

  const testGithub = async () => {
    setBusy('github-test');
    try {
      await request(`/api/projects/${encodeURIComponent(projectSlug)}/github/app/test`, { method: 'POST', body: '{}' });
      setNotice({ ok: true, text: t('v7.integrations.github_test_ok') });
      await load();
    } catch (error: any) {
      setNotice({ ok: false, text: error?.message || t('v7.integrations.github_failed') });
    } finally { setBusy(''); }
  };

  const removePat = async () => {
    setBusy('remove-pat');
    try {
      await request(`/api/projects/${encodeURIComponent(projectSlug)}/github/pat`, { method: 'DELETE' });
      setNotice({ ok: true, text: t('v7.integrations.legacy_pat_removed') });
      await load();
    } catch (error: any) {
      setNotice({ ok: false, text: error?.message || t('v7.integrations.github_failed') });
    } finally { setBusy(''); }
  };

  const savePreview = async () => {
    setBusy('preview-save');
    try {
      const usesVercelSecret = provider === 'vercel';
      const data = await request(`/api/projects/${encodeURIComponent(projectSlug)}/automation/preview`, {
        method: 'PUT',
        body: JSON.stringify({
          provider,
          provider_project_id: usesVercelSecret ? (providerProjectId || null) : null,
          provider_scope_id: usesVercelSecret ? (providerScopeId || null) : null,
          review_url: null,
          api_token: usesVercelSecret ? (providerToken || null) : null,
          clear_token: clearToken || !usesVercelSecret,
        }),
      });
      applyPreview(data);
      setNotice({ ok: true, text: t('v7.integrations.preview_saved') });
    } catch (error: any) {
      setNotice({ ok: false, text: error?.message || t('v7.integrations.save_failed') });
    } finally { setBusy(''); }
  };

  const testPreview = async () => {
    setBusy('preview-test');
    try {
      await request(`/api/projects/${encodeURIComponent(projectSlug)}/automation/preview/test`, { method: 'POST', body: '{}' });
      setNotice({ ok: true, text: t('v7.integrations.preview_test_ok') });
    } catch (error: any) {
      setNotice({ ok: false, text: error?.message || t('v7.integrations.preview_failed') });
    } finally { setBusy(''); }
  };

  if (!github || !preview) {
    return (
      <main className="min-h-screen p-6 text-[var(--vb-text)]">
        <button onClick={() => navigate('/app')} className="enterprise-icon-button" aria-label={t('v7.integrations.back')}><ArrowLeft className="h-4 w-4" /></button>
        <p className="mt-8 text-sm text-[var(--vb-muted)]">{busy === 'load' ? t('v7.integrations.loading') : notice?.text || t('v7.integrations.load_failed')}</p>
      </main>
    );
  }

  const credentialLabel = github.credential_type === 'github_app'
    ? t('v7.integrations.credential_app')
    : github.credential_type === 'pat'
      ? t('v7.integrations.credential_pat')
      : t('v7.integrations.credential_none');
  const onboarding = [
    { label: t('v7.integrations.onboarding_repo'), done: Boolean(repo.trim()) },
    { label: t('v7.integrations.onboarding_install'), done: Boolean(github.app_installed) },
    { label: t('v7.integrations.onboarding_verify'), done: github.credential_type === 'github_app' },
  ];

  return (
    <main className="min-h-screen bg-[var(--vb-canvas)] px-4 py-6 text-[var(--vb-text)] sm:px-6">
      <div className="mx-auto max-w-5xl space-y-5">
        <header className="flex items-start justify-between gap-4 border-b border-[var(--vb-border)] pb-5">
          <div className="flex items-start gap-3">
            <button onClick={() => navigate('/app')} className="enterprise-icon-button" aria-label={t('v7.integrations.back')}><ArrowLeft className="h-4 w-4" /></button>
            <div><h1 className="text-lg font-semibold">{t('v7.integrations.title')}</h1><p className="mt-1 max-w-3xl text-xs text-[var(--vb-muted)]">{t('v7.integrations.subtitle')}</p></div>
          </div>
          <button type="button" onClick={() => void load()} className="enterprise-icon-button" aria-label={t('v7.integrations.refresh')}><RefreshCw className="h-4 w-4" /></button>
        </header>

        {notice && <div className={`rounded-xl border p-3 text-xs ${notice.ok ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300' : 'border-rose-500/25 bg-rose-500/10 text-rose-300'}`}>{notice.text}</div>}

        <section className="rounded-2xl border border-[var(--vb-border)] bg-[var(--vb-surface)] p-4 sm:p-5" data-github-app-integration>
          <div className="flex items-start gap-3"><GitBranch className="mt-0.5 h-5 w-5 text-[var(--vb-accent)]" /><div><h2 className="text-sm font-semibold">{t('v7.integrations.github_title')}</h2><p className="mt-1 text-xs text-[var(--vb-muted)]">{t('v7.integrations.github_desc')}</p></div></div>

          <div className="mt-4 grid gap-2 sm:grid-cols-3" data-github-onboarding>
            {onboarding.map((step, index) => <div key={step.label} className={`rounded-xl border p-3 text-xs ${step.done ? 'border-emerald-500/25 bg-emerald-500/10' : 'border-[var(--vb-border)] bg-[var(--vb-canvas-subtle)]'}`}><div className="flex items-center gap-2"><span className="flex h-5 w-5 items-center justify-center rounded-full border border-current text-[10px]">{step.done ? <CheckCircle2 className="h-3 w-3" /> : index + 1}</span><span className="font-semibold">{step.label}</span></div></div>)}
          </div>

          {github.partial && <div className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-300">{github.configuration_error || t('v7.integrations.app_not_configured')}</div>}
          {!github.configured && !github.partial && <div className="mt-4 rounded-lg border border-[var(--vb-border)] bg-[var(--vb-canvas-subtle)] p-3 text-xs text-[var(--vb-muted)]">{t('v7.integrations.app_not_configured')}</div>}
          {github.configured && !github.state_ready && <div className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-300">{t('v7.integrations.app_state_not_configured')}</div>}

          <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto]">
            <label className="space-y-1 text-xs"><span className="text-[var(--vb-muted)]">{t('v7.integrations.repo')}</span><input value={repo} onChange={(e) => setRepo(e.target.value)} placeholder={t('v7.integrations.repo_placeholder')} className="w-full rounded-lg border border-[var(--vb-border)] bg-[var(--vb-canvas-subtle)] px-3 py-2 font-mono" /></label>
            <div className="flex items-end gap-2">
              <button type="button" disabled={!github.configured || !github.state_ready || !repo.trim() || busy === 'github-install'} onClick={() => void beginInstall()} className="rounded-lg bg-[var(--vb-accent)] px-3 py-2 text-xs font-semibold text-white disabled:opacity-40">{t('v7.integrations.app_install_start')} <ExternalLink className="ml-1 inline h-3 w-3" /></button>
              <button type="button" disabled={!github.configured || !repo.trim() || busy === 'github-connect'} onClick={() => void connectApp()} className="rounded-lg border border-[var(--vb-border)] px-3 py-2 text-xs font-semibold disabled:opacity-40">{t('v7.integrations.app_verify')}</button>
            </div>
          </div>
          {github.setup_url && <div className="mt-2 text-[10px] text-[var(--vb-muted)]">{t('v7.integrations.setup_url')} <code className="break-all">{github.setup_url}</code></div>}

          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            <div className="rounded-xl border border-[var(--vb-border)] p-3 text-xs"><p className="text-[var(--vb-muted)]">{t('v7.integrations.credential')}</p><p className="mt-1 font-semibold">{credentialLabel}</p><p className={`mt-2 ${github.app_installed ? 'text-emerald-400' : 'text-[var(--vb-muted)]'}`}>{github.app_installed ? t('v7.integrations.app_connected') : t('v7.integrations.app_not_installed')}</p></div>
            <div className="rounded-xl border border-[var(--vb-border)] p-3 text-xs"><p className="text-[var(--vb-muted)]">PAT</p><p className="mt-1">{github.has_pat ? t('v7.integrations.legacy_pat_present') : t('v7.integrations.credential_none')}</p></div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2"><button type="button" onClick={() => void testGithub()} disabled={busy === 'github-test'} className="rounded-lg border border-[var(--vb-border)] px-3 py-2 text-xs font-semibold">{t('v7.integrations.github_test')}</button>{github.has_pat && <button type="button" onClick={() => void removePat()} disabled={!github.app_installed || busy === 'remove-pat'} className="rounded-lg border border-rose-500/30 px-3 py-2 text-xs font-semibold text-rose-300 disabled:opacity-40"><Trash2 className="mr-1 inline h-3.5 w-3.5" />{t('v7.integrations.legacy_pat_remove')}</button>}</div>
        </section>

        <section className="rounded-2xl border border-[var(--vb-border)] bg-[var(--vb-surface)] p-4 sm:p-5" data-preview-adapters>
          <div className="flex items-start gap-3"><ShieldCheck className="mt-0.5 h-5 w-5 text-[var(--vb-accent)]" /><div><h2 className="text-sm font-semibold">{t('v7.integrations.preview_title')}</h2><p className="mt-1 text-xs text-[var(--vb-muted)]">{t('v7.integrations.preview_desc')}</p></div></div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-xs"><span className="text-[var(--vb-muted)]">{t('v7.integrations.preview_provider')}</span><select value={provider} onChange={(e) => setProvider(e.target.value as PreviewProvider)} className="w-full rounded-lg border border-[var(--vb-border)] bg-[var(--vb-canvas-subtle)] p-2"><option value="github">{t('v7.integrations.preview_github')}</option><option value="vercel">{t('v7.integrations.preview_vercel')}</option><option value="render">{t('v7.integrations.preview_render')}</option><option value="disabled">{t('v7.integrations.preview_disabled')}</option></select></label>
            {provider === 'vercel' && <label className="space-y-1 text-xs"><span className="text-[var(--vb-muted)]">{t('v7.integrations.preview_project_id')}</span><input value={providerProjectId} onChange={(e) => setProviderProjectId(e.target.value)} className="w-full rounded-lg border border-[var(--vb-border)] bg-[var(--vb-canvas-subtle)] px-3 py-2 font-mono" /></label>}
            {provider === 'vercel' && <label className="space-y-1 text-xs"><span className="text-[var(--vb-muted)]">{t('v7.integrations.preview_scope_id')}</span><input value={providerScopeId} onChange={(e) => setProviderScopeId(e.target.value)} className="w-full rounded-lg border border-[var(--vb-border)] bg-[var(--vb-canvas-subtle)] px-3 py-2 font-mono" /></label>}
            {provider === 'vercel' && <label className="space-y-1 text-xs sm:col-span-2"><span className="text-[var(--vb-muted)]">{t('v7.integrations.preview_token')}</span><input type="password" autoComplete="off" value={providerToken} onChange={(e) => setProviderToken(e.target.value)} placeholder={t('v7.integrations.preview_token_placeholder')} className="w-full rounded-lg border border-[var(--vb-border)] bg-[var(--vb-canvas-subtle)] px-3 py-2 font-mono" />{preview.has_api_token && <span className="block text-[10px] text-emerald-400">{t('v7.integrations.preview_token_saved')}</span>}</label>}
          </div>
          {preview.has_api_token && provider === 'vercel' && <label className="mt-3 flex items-center gap-2 text-xs"><input type="checkbox" checked={clearToken} onChange={(e) => setClearToken(e.target.checked)} />{t('v7.integrations.preview_clear_token')}</label>}

          {provider === 'github' && <p className="mt-3 text-xs text-[var(--vb-muted)]">{t('v7.integrations.preview_github_mechanism')}</p>}
          {provider === 'vercel' && <p className="mt-3 text-xs text-[var(--vb-muted)]">{t('v7.integrations.preview_vercel_mechanism')}</p>}
          {provider === 'render' && <p className="mt-3 text-xs text-[var(--vb-muted)]">{t('v7.integrations.preview_render_mechanism')}</p>}

          <div className="mt-4 rounded-xl border border-emerald-500/25 bg-emerald-500/10 p-3"><p className="text-xs font-semibold text-emerald-300">{t('v7.integrations.preview_safety')}</p><p className="mt-1 text-xs text-[var(--vb-secondary)]">{t('v7.integrations.preview_safety_desc')}</p></div>
          <div className="mt-4 flex flex-wrap gap-2"><button type="button" onClick={() => void savePreview()} disabled={busy === 'preview-save'} className="rounded-lg bg-[var(--vb-text)] px-3 py-2 text-xs font-semibold text-[var(--vb-canvas)] disabled:opacity-40">{t('v7.integrations.preview_save')}</button><button type="button" onClick={() => void testPreview()} disabled={busy === 'preview-test'} className="rounded-lg border border-[var(--vb-border)] px-3 py-2 text-xs font-semibold">{t('v7.integrations.preview_test')}</button></div>
        </section>
      </div>
    </main>
  );
}
