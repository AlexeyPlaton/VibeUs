import { useState } from 'react';
import { tr } from '../i18n/config';
import {
  Activity,
  Bot,
  Check,
  Code2,
  Copy,
  ExternalLink,
  Globe,
  Layers,
  Sparkles,
  Terminal,
  X,
  Zap,
} from 'lucide-react';

interface OnboardingGuideModalProps {
  project: {
    id: string;
    name: string;
    slug: string;
    public_widget_key?: string | null;
    ingest_key_configured: boolean;
    runtime_error_tracking_enabled?: boolean;
  };
  serverUrl: string;
  isOpen: boolean;
  onClose: () => void;
  onOpenBoard?: () => void;
  onOpenErrors?: () => void;
}

export function OnboardingGuideModal({
  project,
  serverUrl,
  isOpen,
  onClose,
  onOpenBoard,
  onOpenErrors,
}: OnboardingGuideModalProps) {
  const [activeStep, setActiveStep] = useState<1 | 2 | 3>(1);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  if (!isOpen) return null;

  const copy = async (text: string, id: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1600);
  };

  const widgetScript = project.public_widget_key
    ? `<script src="${serverUrl}/static/vibus-widget.umd.cjs" data-project="${project.slug}" data-public-key="${project.public_widget_key}" data-server="${serverUrl}" data-mode="public_feedback" async></script>`
    : `<script src="${serverUrl}/static/vibus-widget.umd.cjs" data-project="${project.slug}" data-public-key="YOUR_PUBLIC_KEY" data-server="${serverUrl}" data-mode="public_feedback" async></script>`;

  const tunnelCommand = `npx vibus share --port 3000 --server ${serverUrl}`;
  const listenCommand = `npx vibus listen --project ${project.slug} --server ${serverUrl}`;
  const mcpCommand = `npx vibus mcp --project ${project.slug}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 sm:p-6 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="flex h-[90vh] w-full max-w-4xl flex-col rounded-3xl border border-white/10 bg-slate-900 shadow-2xl overflow-hidden">
        <header className="flex items-center justify-between border-b border-white/10 px-6 py-4 bg-slate-950/70">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
              <Zap className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold text-white">{tr('v7.onboarding.title', { name: project.name })}</h2>
                <span className="rounded-full bg-slate-800 px-2.5 py-0.5 text-xs text-slate-400 font-mono">
                  {project.slug}
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">{tr('v7.onboarding.subtitle')}</p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="rounded-xl border border-white/10 p-2 text-slate-400 hover:bg-white/5 hover:text-white transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="grid grid-cols-3 border-b border-white/10 bg-slate-950/40 text-xs">
          <button
            onClick={() => setActiveStep(1)}
            className={`flex items-center justify-center gap-2 py-3 px-4 font-semibold border-b-2 transition-all ${
              activeStep === 1
                ? 'border-indigo-500 bg-indigo-500/10 text-white'
                : 'border-transparent text-slate-400 hover:text-white hover:bg-white/[0.02]'
            }`}
          >
            <span
              className={`flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold ${
                activeStep === 1 ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-400'
              }`}
            >
              1
            </span>
            <Globe className="h-4 w-4" />
            <span>{tr('v7.onboarding.tabs.widget')}</span>
          </button>

          <button
            onClick={() => setActiveStep(2)}
            className={`flex items-center justify-center gap-2 py-3 px-4 font-semibold border-b-2 transition-all ${
              activeStep === 2
                ? 'border-rose-500 bg-rose-500/10 text-white'
                : 'border-transparent text-slate-400 hover:text-white hover:bg-white/[0.02]'
            }`}
          >
            <span
              className={`flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold ${
                activeStep === 2 ? 'bg-rose-600 text-white' : 'bg-slate-800 text-slate-400'
              }`}
            >
              2
            </span>
            <Activity className="h-4 w-4" />
            <span>{tr('v7.onboarding.tabs.runtime')}</span>
          </button>

          <button
            onClick={() => setActiveStep(3)}
            className={`flex items-center justify-center gap-2 py-3 px-4 font-semibold border-b-2 transition-all ${
              activeStep === 3
                ? 'border-emerald-500 bg-emerald-500/10 text-white'
                : 'border-transparent text-slate-400 hover:text-white hover:bg-white/[0.02]'
            }`}
          >
            <span
              className={`flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold ${
                activeStep === 3 ? 'bg-emerald-600 text-white' : 'bg-slate-800 text-slate-400'
              }`}
            >
              3
            </span>
            <Bot className="h-4 w-4" />
            <span>{tr('v7.onboarding.tabs.ai')}</span>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {activeStep === 1 && (
            <div className="space-y-6">
              <div className="rounded-2xl border border-indigo-500/20 bg-indigo-500/10 p-5">
                <h3 className="font-bold text-white text-sm flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-indigo-400" />{tr('v7.onboarding.step1.title')}</h3>
                <p className="mt-1.5 text-xs text-indigo-200/80 leading-relaxed">
                  {tr('v7.onboarding.step1.copy')}
                </p>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-300">{tr('v7.onboarding.step1.option_a')}</span>
                  <span className="rounded bg-indigo-500/20 px-2 py-0.5 text-[10px] font-bold text-indigo-300">{tr('v7.onboarding.recommended')}</span>
                </div>
                <p className="text-xs text-slate-400">{tr('v7.onboarding.step1.run_local')}</p>
                <div className="relative rounded-2xl border border-white/10 bg-slate-950 p-4 font-mono text-xs">
                  <button
                    onClick={() => copy(tunnelCommand, 'tunnel_cmd')}
                    className="absolute right-3 top-3 rounded-lg border border-white/10 bg-slate-900 px-2.5 py-1 text-[11px] text-slate-300 hover:bg-white/10 flex items-center gap-1"
                  >
                    {copiedId === 'tunnel_cmd' ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                    {copiedId === 'tunnel_cmd' ? tr('v7.onboarding.common.copied') : tr('v7.onboarding.common.copy')}
                  </button>
                  <code className="text-indigo-300">{tunnelCommand}</code>
                </div>
                <p className="text-[11px] text-slate-500">
                  {tr('v7.onboarding.step1.preview_copy')}
                </p>
              </div>

              <div className="space-y-3 pt-4 border-t border-white/10">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-300">{tr('v7.onboarding.step1.option_b')}</span>
                <p className="text-xs text-slate-400">
                  {tr('v7.onboarding.step1.before_body')}
                </p>
                <div className="relative rounded-2xl border border-white/10 bg-slate-950 p-4 font-mono text-xs">
                  <button
                    onClick={() => copy(widgetScript, 'widget_script')}
                    className="absolute right-3 top-3 rounded-lg border border-white/10 bg-slate-900 px-2.5 py-1 text-[11px] text-slate-300 hover:bg-white/10 flex items-center gap-1"
                  >
                    {copiedId === 'widget_script' ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                    {copiedId === 'widget_script' ? tr('v7.onboarding.common.copied') : tr('v7.onboarding.common.copy')}
                  </button>
                  <pre className="overflow-x-auto text-emerald-300 text-[11px]">
                    {widgetScript}
                  </pre>
                </div>
              </div>
            </div>
          )}

          {activeStep === 2 && (
            <div className="space-y-6">
              <div className="rounded-2xl border border-rose-500/20 bg-rose-500/10 p-5">
                <h3 className="font-bold text-white text-sm flex items-center gap-2">
                  <Activity className="h-4 w-4 text-rose-400" />{tr('v7.onboarding.step2.title')}</h3>
                <p className="mt-1.5 text-xs text-rose-200/80 leading-relaxed">
                  {tr('v7.onboarding.step2.copy')}
                </p>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-300">{tr('v7.onboarding.step2.status')}</span>
                  <div className="flex items-center gap-2">
                    <span
                      className={`rounded px-2 py-0.5 text-[10px] font-bold ${
                        project.ingest_key_configured
                          ? 'bg-emerald-500/20 text-emerald-300'
                          : 'bg-amber-500/20 text-amber-300'
                      }`}
                    >
                      {project.ingest_key_configured ? tr('v7.onboarding.step2.key_ready') : tr('v7.onboarding.step2.key_missing')}
                    </span>
                    <span
                      className={`rounded px-2 py-0.5 text-[10px] font-bold ${
                        project.runtime_error_tracking_enabled
                          ? 'bg-emerald-500/20 text-emerald-300'
                          : 'bg-slate-700 text-slate-300'
                      }`}
                    >
                      {project.runtime_error_tracking_enabled ? tr('v7.onboarding.step2.collection_on') : tr('v7.onboarding.step2.collection_off')}
                    </span>
                  </div>
                </div>

                <div className="relative rounded-2xl border border-white/10 bg-slate-950 p-4 font-mono text-xs">
                  <button
                    onClick={() =>
                      copy(
                        `from fastapi import FastAPI\nfrom vibeus_sdk import VibeUsMiddleware\n\napp = FastAPI()\n\n# ${tr('v7.onboarding.step2.code_comment')}\napp.add_middleware(\n    VibeUsMiddleware,\n    ingest_key="vb_ingest_...", # ${tr('v7.onboarding.step2.key_comment')}\n    server_url="${serverUrl}",\n    service="backend",\n    environment="production",\n)`,
                        'py_mw',
                      )
                    }
                    className="absolute right-3 top-3 rounded-lg border border-white/10 bg-slate-900 px-2.5 py-1 text-[11px] text-slate-300 hover:bg-white/10 flex items-center gap-1"
                  >
                    {copiedId === 'py_mw' ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                    {copiedId === 'py_mw' ? tr('v7.onboarding.common.copied') : tr('v7.onboarding.common.copy')}
                  </button>
                  <pre className="overflow-x-auto text-rose-300 text-[11px]">
{`from fastapi import FastAPI
from vibeus_sdk import VibeUsMiddleware

app = FastAPI()

app.add_middleware(
    VibeUsMiddleware,
    ingest_key="vb_ingest_...", # ${tr('v7.onboarding.step2.copy_key_comment')}
    server_url="${serverUrl}",
    service="backend",
    environment="production",
)`}
                  </pre>
                </div>

                {onOpenErrors && (
                  <button
                    onClick={onOpenErrors}
                    className="inline-flex items-center gap-2 rounded-xl bg-slate-800 px-4 py-2.5 text-xs font-semibold text-white hover:bg-slate-700 transition-colors"
                  >
                    <Activity className="h-3.5 w-3.5 text-rose-400" />{tr('v7.onboarding.step2.open_errors')}</button>
                )}
              </div>
            </div>
          )}

          {activeStep === 3 && (
            <div className="space-y-6">
              <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-5">
                <h3 className="font-bold text-white text-sm flex items-center gap-2">
                  <Bot className="h-4 w-4 text-emerald-400" />{tr('v7.onboarding.step3.title')}</h3>
                <p className="mt-1.5 text-xs text-emerald-200/80 leading-relaxed">
                  {tr('v7.onboarding.step3.copy')}
                </p>
              </div>

              <div className="space-y-3">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-300">{tr('v7.onboarding.step3.sync_title')}</span>
                <p className="text-xs text-slate-400">{tr('v7.onboarding.step3.run_root')}</p>
                <div className="relative rounded-2xl border border-white/10 bg-slate-950 p-4 font-mono text-xs">
                  <button
                    onClick={() => copy(listenCommand, 'listen_cmd')}
                    className="absolute right-3 top-3 rounded-lg border border-white/10 bg-slate-900 px-2.5 py-1 text-[11px] text-slate-300 hover:bg-white/10 flex items-center gap-1"
                  >
                    {copiedId === 'listen_cmd' ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                    {copiedId === 'listen_cmd' ? tr('v7.onboarding.common.copied') : tr('v7.onboarding.common.copy')}
                  </button>
                  <code className="text-emerald-300">{listenCommand}</code>
                </div>
                <p className="text-[11px] text-slate-500">{tr('v7.onboarding.step3.files_prefix')}<code>.vibus/board.json</code> {tr('v7.common.and')}{' '}
                  <code>.vibus/TASKS_FOR_AI.md</code>{tr('v7.onboarding.step3.files_suffix')}</p>
              </div>

              <div className="space-y-3 pt-4 border-t border-white/10">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-300">{tr('v7.onboarding.step3.mcp_title')}</span>
                <p className="text-xs text-slate-400">{tr('v7.onboarding.step3.mcp_run')}</p>
                <div className="relative rounded-2xl border border-white/10 bg-slate-950 p-4 font-mono text-xs">
                  <button
                    onClick={() => copy(mcpCommand, 'mcp_cmd')}
                    className="absolute right-3 top-3 rounded-lg border border-white/10 bg-slate-900 px-2.5 py-1 text-[11px] text-slate-300 hover:bg-white/10 flex items-center gap-1"
                  >
                    {copiedId === 'mcp_cmd' ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                    {copiedId === 'mcp_cmd' ? tr('v7.onboarding.common.copied') : tr('v7.onboarding.common.copy')}
                  </button>
                  <code className="text-emerald-300">{mcpCommand}</code>
                </div>
              </div>
            </div>
          )}
        </div>

        <footer className="flex items-center justify-between border-t border-white/10 px-6 py-4 bg-slate-950/70">
          <div className="text-xs text-slate-400">
            {activeStep === 1 && tr('v7.onboarding.footer.next_crashes')}
            {activeStep === 2 && tr('v7.onboarding.footer.next_ai')}
            {activeStep === 3 && tr('v7.onboarding.footer.done')}
          </div>

          <div className="flex items-center gap-2">
            {activeStep > 1 && (
              <button
                onClick={() => setActiveStep((prev) => (prev - 1) as any)}
                className="rounded-xl border border-white/10 px-4 py-2 text-xs font-semibold text-slate-300 hover:bg-white/5 transition-colors"
              >{tr('v7.onboarding.footer.back')}</button>
            )}

            {activeStep < 3 ? (
              <button
                onClick={() => setActiveStep((prev) => (prev + 1) as any)}
                className="rounded-xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-500 transition-colors"
              >{tr('v7.onboarding.footer.next')}</button>
            ) : (
              <button
                onClick={onClose}
                className="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-500 transition-colors"
              >{tr('v7.onboarding.footer.finish')}</button>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
}
