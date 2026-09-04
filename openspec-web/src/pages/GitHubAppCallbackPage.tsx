import { useEffect, useState } from 'react';
import { ArrowLeft, CheckCircle2, GitBranch, Loader2, ShieldAlert } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

type Completion = {
  project_slug: string;
  github_repo?: string | null;
  app_installed?: boolean;
  credential_type?: string | null;
};

function errorMessage(data: any, fallback: string) {
  return typeof data?.detail === 'string' ? data.detail : fallback;
}

export function GitHubAppCallbackPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [result, setResult] = useState<Completion | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const state = params.get('state')?.trim() || '';
    if (!state) {
      setError(t('v7.integrations.callback_missing_state'));
      return;
    }
    let cancelled = false;
    fetch('/api/github/app/install/complete', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state }),
    })
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(errorMessage(data, t('v7.integrations.callback_failed')));
        if (!cancelled) setResult(data);
      })
      .catch((reason: any) => {
        if (!cancelled) setError(reason?.message || t('v7.integrations.callback_failed'));
      });
    return () => { cancelled = true; };
  }, [location.search, t]);

  const backToIntegration = () => {
    if (result?.project_slug) {
      navigate(`/app/integrations/${encodeURIComponent(result.project_slug)}?github=connected`);
    } else {
      navigate('/app');
    }
  };

  return (
    <main className="min-h-screen bg-[var(--vb-canvas)] px-4 py-8 text-[var(--vb-text)] sm:px-6">
      <div className="mx-auto max-w-xl rounded-2xl border border-[var(--vb-border)] bg-[var(--vb-surface)] p-5 sm:p-6" data-github-app-callback>
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[var(--vb-border)] bg-[var(--vb-accent-soft)] text-[var(--vb-accent)]">
            <GitBranch className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-base font-semibold">{t('v7.integrations.callback_title')}</h1>
            <p className="mt-1 text-xs text-[var(--vb-muted)]">{t('v7.integrations.callback_desc')}</p>
          </div>
        </div>

        {!result && !error && (
          <div className="mt-5 flex items-center gap-3 rounded-xl border border-[var(--vb-border)] bg-[var(--vb-canvas-subtle)] p-4 text-sm">
            <Loader2 className="h-4 w-4 animate-spin text-[var(--vb-accent)]" />
            <span>{t('v7.integrations.callback_working')}</span>
          </div>
        )}

        {result && (
          <div className="mt-5 rounded-xl border border-emerald-500/25 bg-emerald-500/10 p-4 text-sm text-emerald-300">
            <div className="flex items-center gap-2 font-semibold"><CheckCircle2 className="h-4 w-4" />{t('v7.integrations.callback_success')}</div>
            {result.github_repo && <p className="mt-2 font-mono text-xs">{result.github_repo}</p>}
          </div>
        )}

        {error && (
          <div className="mt-5 rounded-xl border border-rose-500/25 bg-rose-500/10 p-4 text-sm text-rose-300">
            <div className="flex items-center gap-2 font-semibold"><ShieldAlert className="h-4 w-4" />{t('v7.integrations.callback_failed')}</div>
            <p className="mt-2 text-xs">{error}</p>
          </div>
        )}

        <button type="button" onClick={backToIntegration} className="mt-5 inline-flex items-center gap-2 rounded-lg border border-[var(--vb-border)] px-3 py-2 text-xs font-semibold">
          <ArrowLeft className="h-3.5 w-3.5" />
          {result ? t('v7.integrations.callback_back_project') : t('v7.integrations.callback_back')}
        </button>
      </div>
    </main>
  );
}
