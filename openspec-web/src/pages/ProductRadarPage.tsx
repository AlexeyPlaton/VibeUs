import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Activity,
  CheckCircle2,
  CircleDollarSign,
  Database,
  LayoutDashboard,
  RefreshCw,
  ShieldCheck,
  Siren,
  Users,
  Wrench,
  XCircle,
} from 'lucide-react';

type JsonRecord = Record<string, any>;

type RadarDimension = {
  key: string;
  label: string;
  score: number | null;
  status: 'healthy' | 'watch' | 'intervene' | 'insufficient' | string;
  confidence: string;
  sample: number;
  value: number | null;
  unit: string;
  trend_pct: number | null;
  target: string;
  question: string;
};

function getApiUrl() {
  return window.location.origin.includes('localhost') ? 'http://localhost:8000' : window.location.origin;
}

async function api(path: string): Promise<any> {
  const response = await fetch(`${getApiUrl()}${path}`, { credentials: 'include' });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof data?.detail === 'string' ? data.detail : `Request failed (${response.status})`;
    throw new Error(message);
  }
  return data;
}

function statusClass(status: string) {
  if (status === 'healthy') return 'border-emerald-200 bg-emerald-50 text-emerald-800';
  if (status === 'watch') return 'border-amber-200 bg-amber-50 text-amber-900';
  if (status === 'intervene') return 'border-red-200 bg-red-50 text-red-800';
  if (status === 'unknown' || status === 'manual') return 'border-violet-200 bg-violet-50 text-violet-800';
  return 'border-slate-200 bg-slate-50 text-slate-600';
}

function StatusBadge({ status }: { status: string }) {
  const { t } = useTranslation();
  return (
    <span className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-bold ${statusClass(status)}`}>
      {t(`v7.product_radar.status.${status}`, { defaultValue: status })}
    </span>
  );
}

function Confidence({ value, sample }: { value: string; sample: number }) {
  const { t } = useTranslation();
  return (
    <span className="text-xs text-slate-400">
      {t('v7.product_radar.confidence.label')}: {t(`v7.product_radar.confidence.${value}`, { defaultValue: value })}
      {Number.isFinite(sample) ? ` · ${t('v7.product_radar.confidence.sample', { count: sample })}` : ''}
    </span>
  );
}

function fmtTrend(value: number | null | undefined, fallback: string) {
  if (value === null || value === undefined || !Number.isFinite(value)) return fallback;
  if (value > 0) return `+${value}%`;
  return `${value}%`;
}

function RadarChart({ dimensions }: { dimensions: RadarDimension[] }) {
  const { t } = useTranslation();
  const items = dimensions.slice(0, 8);
  const size = 360;
  const center = size / 2;
  const radius = 125;
  const angleFor = (index: number) => -Math.PI / 2 + (index * Math.PI * 2) / Math.max(items.length, 1);
  const point = (index: number, factor: number): [number, number] => {
    const angle = angleFor(index);
    return [center + Math.cos(angle) * radius * factor, center + Math.sin(angle) * radius * factor];
  };
  const polygon = (factor: number) => items.map((_, index) => point(index, factor).join(',')).join(' ');
  const valuePolygon = items
    .map((item, index) => point(index, Math.max(0, Math.min(100, Number(item.score ?? 0))) / 100).join(','))
    .join(' ');

  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs font-bold uppercase tracking-[0.18em] text-indigo-600">{t('v7.product_radar.chart_eyebrow')}</div>
          <h2 className="mt-1 text-lg font-black">{t('v7.product_radar.chart_title')}</h2>
        </div>
        <span className="max-w-xs text-right text-xs leading-5 text-slate-400">{t('v7.product_radar.chart_help')}</span>
      </div>
      <div className="mt-3 grid gap-5 xl:grid-cols-[390px_1fr] xl:items-center">
        <div className="mx-auto w-full max-w-[390px]">
          <svg viewBox={`0 0 ${size} ${size}`} className="h-auto w-full" role="img" aria-label={t('v7.product_radar.chart_title')}>
            {[0.25, 0.5, 0.75, 1].map((factor) => (
              <polygon key={factor} points={polygon(factor)} fill="none" stroke="currentColor" className="text-slate-200" strokeWidth="1" />
            ))}
            {items.map((item, index) => {
              const [x, y] = point(index, 1);
              const [lx, ly] = point(index, 1.18);
              const [vx, vy] = point(index, Math.max(0, Math.min(100, Number(item.score ?? 0))) / 100);
              return (
                <g key={item.key}>
                  <line x1={center} y1={center} x2={x} y2={y} stroke="currentColor" className="text-slate-200" strokeWidth="1" />
                  <circle cx={vx} cy={vy} r="4" className={item.score === null ? 'fill-white stroke-slate-400' : 'fill-indigo-600'} strokeWidth="2" />
                  <text x={lx} y={ly} textAnchor={lx < center - 8 ? 'end' : lx > center + 8 ? 'start' : 'middle'} dominantBaseline="middle" className="fill-slate-600 text-[10px] font-bold">
                    {t(`v7.product_radar.dimensions.${item.key}.label`, { defaultValue: item.label })}
                  </text>
                </g>
              );
            })}
            {items.length > 2 && <polygon points={valuePolygon} className="fill-indigo-500/15 stroke-indigo-600" strokeWidth="2.5" />}
            <circle cx={center} cy={center} r="4" className="fill-slate-950" />
          </svg>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {items.map((item) => (
            <div key={item.key} className="rounded-2xl border border-slate-100 bg-slate-50/70 p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-sm font-black">{t(`v7.product_radar.dimensions.${item.key}.label`, { defaultValue: item.label })}</div>
                  <div className="mt-1 text-xs leading-5 text-slate-500">{t(`v7.product_radar.dimensions.${item.key}.question`, { defaultValue: item.question })}</div>
                </div>
                <StatusBadge status={item.status} />
              </div>
              <div className="mt-3 flex items-end gap-2">
                <span className="text-2xl font-black tracking-tight">{item.value ?? '—'}</span>
                <span className="pb-1 text-[11px] text-slate-400">{item.unit}</span>
              </div>
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                <Confidence value={item.confidence} sample={item.sample} />
                {item.trend_pct !== null && <span className={`text-xs font-bold ${item.trend_pct >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{fmtTrend(item.trend_pct, t('v7.product_radar.trend_no_base'))}</span>}
              </div>
              <div className="mt-2 text-[11px] leading-4 text-slate-400">{item.target}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function ProductRadarPage() {
  const { t } = useTranslation();
  const [radar, setRadar] = useState<JsonRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api('/api/control/radar');
      setRadar(data);
    } catch (err) {
      setRadar(null);
      setError(err instanceof Error ? err.message : 'Product Radar unavailable');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const dimensions = useMemo(() => (radar?.dimensions || []) as RadarDimension[], [radar]);
  const topPriority = radar?.steering_queue?.[0]?.priority || '—';

  if (loading) {
    return (
      <div className="grid min-h-screen place-items-center bg-slate-950 text-white">
        <RefreshCw className="h-7 w-7 animate-spin text-indigo-400" />
      </div>
    );
  }

  if (error || !radar) {
    return (
      <div className="min-h-screen bg-slate-950 px-6 py-16 text-white">
        <div className="mx-auto max-w-xl rounded-3xl border border-slate-800 bg-slate-900 p-8">
          <ShieldCheck className="h-10 w-10 text-amber-400" />
          <h1 className="mt-5 text-2xl font-black">{t('v7.product_radar.access_title')}</h1>
          <p className="mt-3 text-sm leading-6 text-slate-400">{t('v7.product_radar.access_desc')}</p>
          <div className="mt-5 rounded-xl border border-red-900/50 bg-red-950/40 p-4 text-sm text-red-200">{error || 'Access denied'}</div>
          <div className="mt-6 flex gap-3">
            <a href="/create?next=app" className="rounded-xl bg-white px-4 py-2 text-sm font-bold text-slate-950">{t('v7.product_radar.sign_in')}</a>
            <a href="/app" className="rounded-xl border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-300">{t('v7.product_radar.account')}</a>
          </div>
        </div>
      </div>
    );
  }

  const north = radar.north_star || {};
  const coverage = radar.data_coverage || {};
  const steering = (radar.steering_queue || []) as JsonRecord[];
  const guardrails = (radar.guardrails || []) as JsonRecord[];
  const loop = (radar.value_loop || []) as JsonRecord[];
  const gaps = (coverage.gaps || []) as JsonRecord[];

  return (
    <div className="min-h-screen bg-slate-100 text-slate-950">
      <header className="border-b border-slate-800 bg-slate-950 px-4 py-5 text-white md:px-7">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="grid h-11 w-11 place-items-center rounded-2xl bg-gradient-to-br from-cyan-400 via-indigo-500 to-fuchsia-500">
              <Activity className="h-5 w-5" />
            </div>
            <div>
              <div className="text-xs font-bold uppercase tracking-[0.2em] text-indigo-300">{t('v7.product_radar.eyebrow')}</div>
              <h1 className="mt-1 text-xl font-black">{t('v7.product_radar.title')}</h1>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => void load()} className="inline-flex items-center gap-2 rounded-xl border border-slate-700 px-3 py-2 text-sm font-bold text-slate-200 hover:bg-slate-900">
              <RefreshCw className="h-4 w-4" /> {t('v7.product_radar.refresh')}
            </button>
            <a href="/control/ops" className="inline-flex items-center gap-2 rounded-xl bg-white px-3 py-2 text-sm font-bold text-slate-950">
              <Wrench className="h-4 w-4" /> {t('v7.product_radar.operations')}
            </a>
            <a href="/app" className="rounded-xl border border-slate-700 px-3 py-2 text-sm font-bold text-slate-300">{t('v7.product_radar.account')}</a>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-5 px-4 py-6 md:px-7">
        <section className="grid gap-4 xl:grid-cols-[1.45fr_0.55fr]">
          <div className="overflow-hidden rounded-3xl bg-slate-950 p-6 text-white">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="text-xs font-bold uppercase tracking-[0.18em] text-cyan-300">{t('v7.product_radar.north_star')}</div>
                <div className="mt-2 text-4xl font-black tracking-tight md:text-5xl">{north.value ?? 0}</div>
                <div className="mt-1 text-lg font-bold">{t('v7.product_radar.north_star_name')}</div>
              </div>
              <div className="rounded-2xl border border-slate-700 bg-slate-900 px-4 py-3 text-right">
                <div className="text-xs text-slate-400">{t('v7.product_radar.previous_7d')}</div>
                <div className="mt-1 text-2xl font-black">{north.previous ?? 0}</div>
                <div className={`mt-1 text-xs font-bold ${Number(north.change_abs || 0) >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>{fmtTrend(north.change_pct, t('v7.product_radar.trend_no_base'))}</div>
              </div>
            </div>
            <p className="mt-5 max-w-3xl text-sm leading-6 text-slate-300">{t('v7.product_radar.north_definition')}</p>
            <p className="mt-2 max-w-3xl text-xs leading-5 text-slate-500">{t('v7.product_radar.north_why')}</p>
            <div className="mt-5 flex flex-wrap gap-2">
              <span className="rounded-full border border-slate-700 px-3 py-1 text-xs font-bold">{t('v7.product_radar.confidence.label')}: {north.confidence}</span>
              <span className="rounded-full border border-slate-700 px-3 py-1 text-xs font-bold">{t('v7.product_radar.phase')}: {radar.phase}</span>
              <span className="rounded-full border border-slate-700 px-3 py-1 text-xs font-bold">{t('v7.product_radar.top_steering')}: {topPriority}</span>
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-5">
            <div className="flex items-center gap-2">
              <Database className="h-5 w-5 text-indigo-600" />
              <h2 className="font-black">{t('v7.product_radar.instrument_quality')}</h2>
            </div>
            <div className="mt-5 text-4xl font-black tracking-tight">{coverage.pct ?? 0}%</div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
              <div className="h-full rounded-full bg-indigo-600" style={{ width: `${Math.max(0, Math.min(100, Number(coverage.pct || 0)))}%` }} />
            </div>
            <p className="mt-3 text-xs leading-5 text-slate-500">{t('v7.product_radar.instrument_desc', { measured: coverage.measured ?? 0, total: coverage.total ?? 0 })}</p>
            <div className="mt-4 rounded-xl bg-slate-50 p-3 text-[11px] leading-5 text-slate-500">{t('v7.product_radar.privacy_rule')}</div>
          </div>
        </section>

        <RadarChart dimensions={dimensions} />

        <section className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
          <div className="rounded-3xl border border-slate-200 bg-white p-5">
            <div className="flex items-center gap-2">
              <Siren className="h-5 w-5 text-amber-600" />
              <h2 className="font-black">{t('v7.product_radar.steering_title')}</h2>
            </div>
            <p className="mt-2 text-xs leading-5 text-slate-500">{t('v7.product_radar.steering_desc')}</p>
            <div className="mt-4 space-y-3">
              {steering.map((item, index) => (
                <div key={`${item.priority}-${item.title}-${index}`} className={`rounded-2xl border p-4 ${item.priority === 'P0' ? 'border-red-200 bg-red-50' : item.priority === 'P1' ? 'border-amber-200 bg-amber-50' : 'border-slate-200 bg-slate-50'}`}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className={`rounded-full px-2.5 py-1 text-xs font-black ${item.priority === 'P0' ? 'bg-red-700 text-white' : item.priority === 'P1' ? 'bg-amber-700 text-white' : 'bg-slate-800 text-white'}`}>{item.priority}</span>
                      <span className="text-xs font-bold uppercase tracking-wider text-slate-500">{item.area}</span>
                    </div>
                  </div>
                  <h3 className="mt-3 font-black">{item.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-slate-700">{item.reason}</p>
                  <div className="mt-3 rounded-xl bg-white/70 p-3 text-sm"><span className="font-bold">{t('v7.product_radar.action')}:</span> {item.action}</div>
                  <div className="mt-2 text-xs leading-5 text-slate-500"><span className="font-bold">{t('v7.product_radar.guardrail')}:</span> {item.guardrail}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-5">
            <div className="flex items-center gap-2">
              <LayoutDashboard className="h-5 w-5 text-indigo-600" />
              <h2 className="font-black">{t('v7.product_radar.value_loop_title')}</h2>
            </div>
            <p className="mt-2 text-xs leading-5 text-slate-500">{t('v7.product_radar.value_loop_desc')}</p>
            <div className="mt-4 space-y-2">
              {loop.map((item, index) => (
                <div key={item.key} className="flex items-center gap-3 rounded-2xl border border-slate-100 bg-slate-50 p-3">
                  <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-slate-950 text-xs font-black text-white">{index + 1}</div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-bold">{t(`v7.product_radar.loop.${item.key}`, { defaultValue: item.label })}</div>
                    <div className="mt-0.5 text-[11px] text-slate-400">{item.unit}</div>
                  </div>
                  <div className="text-2xl font-black">{item.value}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-5">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-indigo-600" />
            <h2 className="font-black">{t('v7.product_radar.launch_guardrails')}</h2>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {guardrails.map((item) => (
              <div key={item.key} className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="font-bold">{t(`v7.product_radar.guardrails.${item.key}`, { defaultValue: item.label })}</div>
                  <StatusBadge status={item.status} />
                </div>
                <p className="mt-3 text-xs leading-5 text-slate-500">{item.detail}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="grid gap-5 xl:grid-cols-[0.75fr_1.25fr]">
          <div className="rounded-3xl border border-slate-200 bg-white p-5">
            <div className="flex items-center gap-2">
              <Users className="h-5 w-5 text-indigo-600" />
              <h2 className="font-black">{t('v7.product_radar.read_radar')}</h2>
            </div>
            <div className="mt-4 space-y-2">
              {(radar.decision_order || []).map((item: string, index: number) => (
                <div key={item} className="flex gap-3 rounded-xl bg-slate-50 p-3 text-sm leading-5">
                  <span className="font-black text-indigo-600">{index + 1}</span>
                  <span>{t(`v7.product_radar.decision.${index}`, { defaultValue: item })}</span>
                </div>
              ))}
            </div>
            <div className="mt-4 rounded-xl border border-indigo-100 bg-indigo-50 p-3 text-xs leading-5 text-indigo-900">{t('v7.product_radar.score_method')}</div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-5">
            <div className="flex items-center gap-2">
              <CircleDollarSign className="h-5 w-5 text-indigo-600" />
              <h2 className="font-black">{t('v7.product_radar.blind_spots')}</h2>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {gaps.map((gap) => (
                <div key={gap.key} className="rounded-2xl border border-dashed border-slate-300 p-4">
                  <div className="flex items-center gap-2">
                    <XCircle className="h-4 w-4 text-slate-400" />
                    <div className="text-sm font-black">{t(`v7.product_radar.gaps.${gap.key}.label`, { defaultValue: gap.label })}</div>
                  </div>
                  <p className="mt-2 text-xs leading-5 text-slate-500">{t(`v7.product_radar.gaps.${gap.key}.why`, { defaultValue: gap.why })}</p>
                  <div className="mt-3 text-xs leading-5 text-slate-700"><span className="font-bold">{t('v7.product_radar.todo')}:</span> {t(`v7.product_radar.gaps.${gap.key}.next`, { defaultValue: gap.next })}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-4 text-xs text-slate-400">
          <span>{t('v7.product_radar.generated_at', { value: radar.generated_at })}</span>
          <div className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-emerald-500" /> {t('v7.product_radar.readonly')}</div>
        </div>
      </main>
    </div>
  );
}
