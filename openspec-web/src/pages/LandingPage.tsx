import { useEffect, useState } from 'react';
import { tr } from '../i18n/config';
import { LanguageSwitcher } from '../components/LanguageSwitcher';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  Check,
  Code2,
  Copy,
  Eye,
  GitBranch,
  
  MousePointer2,
  Radio,
  ShieldCheck,
  Sparkles,
  Terminal,
  UserCheck,
  Waves,
  Zap,
} from 'lucide-react';
import { VibusWidgetUI } from '../components/VibusWidgetUI';
import { chooseInitialMarket, fetchPricing, rememberMarket, type PricingCatalog, type PricingMarket } from '../utils/pricing';
import './landingpage.vibe.css';

const LOOP = [
  { n: '01', icon: MousePointer2, title: tr('v7.landing.loop.show.title'), text: tr('v7.landing.loop.show.text') },
  { n: '02', icon: Radio, title: tr('v7.landing.loop.context.title'), text: tr('v7.landing.loop.context.text') },
  { n: '03', icon: Code2, title: tr('v7.landing.loop.work.title'), text: tr('v7.landing.loop.work.text') },
  { n: '04', icon: UserCheck, title: tr('v7.landing.loop.review.title'), text: tr('v7.landing.loop.review.text') },
];

const FAQ = [
  [tr('v7.landing.faq.jira_q'), tr('v7.landing.faq.jira_a')],
  [tr('v7.landing.faq.ai_q'), tr('v7.landing.faq.ai_a')],
  [tr('v7.landing.faq.staging_q'), tr('v7.landing.faq.staging_a')],
  [tr('v7.landing.faq.browser_q'), tr('v7.landing.faq.browser_a')],
  [tr('v7.landing.faq.selfhost_q'), tr('v7.landing.faq.selfhost_a')],
  [tr('v7.landing.faq.ru_pay_q'), tr('v7.landing.faq.ru_pay_a')],
];

export function LandingPage() {
  useEffect(() => {
    document.title = tr('v7.landing.meta.title');
    const description = document.querySelector('meta[name=\"description\"]');
    description?.setAttribute('content', tr('v7.landing.meta.description'));
  }, []);
  const [copied, setCopied] = useState(false);
  const [widgetHint, setWidgetHint] = useState(false);
  const [pricing, setPricing] = useState<PricingCatalog | null>(null);
  const [market, setMarket] = useState<PricingMarket>('ru');

  const serverUrl = window.location.origin.includes('localhost')
    ? 'http://localhost:8000'
    : window.location.origin;

  const demoProject = import.meta.env.VITE_DEMO_PROJECT || 'demo-showcase';
  const demoPublicKey = import.meta.env.VITE_DEMO_PUBLIC_WIDGET_KEY || '';

  useEffect(() => {
    fetchPricing(serverUrl)
      .then((catalog) => {
        setPricing(catalog);
        setMarket(chooseInitialMarket(catalog, new URLSearchParams(window.location.search).get('market')));
      })
      .catch(() => undefined);

    try {
      const q = new URLSearchParams(window.location.search);
      const src = q.get('src') || q.get('utm_source');
      if (src) sessionStorage.setItem('vibeus_attribution_src', src);
      const promo = q.get('promo');
      if (promo) sessionStorage.setItem('vibeus_pending_promo', promo.trim().toUpperCase());
    } catch {}
  }, [serverUrl]);

  const toCreateUrl = (extra?: { plan?: 'solo' | 'studio'; promo?: string; market?: string }) => {
    const p = new URLSearchParams();
    if (extra?.plan) p.set('plan', extra.plan);
    p.set('market', extra?.market || market);
    if (extra?.promo) p.set('promo', extra.promo);
    try {
      const pendingPromo = sessionStorage.getItem('vibeus_pending_promo');
      if (!extra?.promo && pendingPromo) p.set('promo', pendingPromo);
      const src = sessionStorage.getItem('vibeus_attribution_src');
      if (src) p.set('src', src);
    } catch {}
    return `/create?${p.toString()}`;
  };

  const setPricingMarket = (next: PricingMarket) => {
    if (next === 'global' && !pricing?.markets.global.visible) return;
    setMarket(next);
    rememberMarket(next);
  };
  const soloPrice = pricing?.markets?.[market]?.plans?.solo?.display || '—';
  const studioPrice = pricing?.markets?.[market]?.plans?.studio?.display || '—';
  const periodDays = pricing?.period_days || 30;
  const globalVisible = Boolean(pricing?.markets.global.visible);

  const cli = `npx vibus share --port 5173\n# ${tr('v7.landing.cli.listen_comment')}\nnpx vibus listen --project ${demoProject} --server ${serverUrl}`;

  const copyCli = async () => {
    await navigator.clipboard.writeText(cli);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  const openWidget = () => {
    const button = document.getElementById('vibeWidgetBtn') as HTMLButtonElement | null;
    if (button) {
      button.click();
      setWidgetHint(false);
      return;
    }
    setWidgetHint(true);
    document.getElementById('live-demo')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  return (
    <div className="vibe-landing">
      <a className="vibe-skip" href="#main">{tr('v7.landing.skip_to_content')}</a>
      <div className="vibe-field" aria-hidden="true" />
      <div className="vibe-grain" aria-hidden="true" />

      <div className="vibe-nav-wrap">
        <header className="vibe-shell vibe-nav">
          <a className="vibe-brand" href="#top" aria-label={tr('v7.landing.brand_home')}>
            <span className="vibe-brand-mark"><i /></span>
            <span>VibeUs</span>
            <small>context relay</small>
          </a>

          <nav className="vibe-nav-links" aria-label={tr('v7.landing.primary_navigation')}>
            <a href="#loop">{tr('v7.landing.nav.how')}</a>
            <a href="#live-demo">{tr('v7.landing.nav.demo')}</a>
            <a href="#security">{tr('v7.landing.nav.security')}</a>
            <a href="#pricing">{tr('v7.landing.nav.pricing')}</a>
          </nav>

          <div className="vibe-nav-actions">
            <LanguageSwitcher compact />
            <a
              className="vibe-icon-link"
              href="https://github.com/AlexeyPlaton/Vibus"
              target="_blank"
              rel="noopener noreferrer"
              aria-label={tr('v7.landing.github_label')}
            >
              <GitBranch size={17} />
            </a>
            <Link className="vibe-ghost-cta" to="/app">{tr('v7.landing.nav.dashboard')}</Link>
            <Link className="vibe-nav-cta" to="/create">{tr('v7.landing.nav.start')}<ArrowRight size={15} /></Link>
          </div>
        </header>
      </div>

      <main id="main">
        <section className="vibe-hero" id="top">
          <div className="vibe-shell vibe-hero-grid">
            <div>
              <div className="vibe-eyebrow"><span className="vibe-live-dot" /> VISUAL FEEDBACK + RUNTIME ERRORS → AI-READY WORK</div>
              <h1>{tr('v7.landing.hero.title_main')}<br /><span className="quiet">{tr('v7.landing.hero.title_quiet')}</span></h1>
              <p className="vibe-hero-copy">{tr('v7.landing.hero.copy')}</p>
              <div className="vibe-hero-actions">
                <button className="vibe-btn vibe-btn-primary" type="button" onClick={openWidget}>
                  <Waves size={18} />{tr('v7.landing.hero.try_here')}</button>
                <Link className="vibe-btn vibe-btn-secondary" to={toCreateUrl()}>{tr('v7.landing.hero.create_free')}<ArrowRight size={16} />
                </Link>
              </div>
              {widgetHint && <p className="vibe-hint" role="status">{tr('v7.landing.hero.widget_hint')}</p>}
              <div className="vibe-microproof" aria-label={tr('v7.landing.hero.properties')}>
                <span><Check size={13} />{tr('v7.landing.hero.free_project')}</span>
                <span><Check size={13} />{tr('v7.landing.hero.no_card')}</span>
                <span><Check size={13} /> self-hostable</span>
              </div>
              <p className="vibe-hero-manifest">
                <em>{tr('v7.landing.hero.manifest')}</em>
              </p>
            </div>

            <div className="vibe-orbit" aria-label={tr('v7.landing.hero.visual_map')}>
              <div className="vibe-orbit-stage">
                <span className="vibe-orbit-ring" /><span className="vibe-orbit-ring" />
                <span className="vibe-orbit-ring" /><span className="vibe-orbit-ring" />
                <div className="vibe-orbit-core"><span>V</span></div>
                <div className="vibe-orbit-label ol-1"><b>Human</b>{tr('v7.landing.hero.here')}</div>
                <div className="vibe-orbit-label ol-2"><b>Context</b> selector + viewport</div>
                <div className="vibe-orbit-label ol-3"><b>Runtime</b> stack + request ID</div>
                <div className="vibe-orbit-label ol-4"><b>Review</b>{tr('v7.landing.hero.human_accepts')}</div>
              </div>
            </div>
          </div>
        </section>

        <section id="two-inputs" className="vibe-section">
          <div className="vibe-shell">
            <div className="vibe-kicker">{tr('v7.landing.inputs.kicker')}</div>
            <h2 className="vibe-section-title">{tr('v7.landing.inputs.title')}</h2>
            <p className="vibe-section-lead">{tr('v7.landing.inputs.lead')}</p>

            <div className="vibe-two-inputs-grid">
              <article className="vibe-input-card">
                <div className="vibe-input-badge"><MousePointer2 size={16} />{tr('v7.landing.inputs.one')}</div>
                <h3>{tr('v7.landing.inputs.human_title')}</h3>
                <p>{tr('v7.landing.inputs.human_intro')}<br />
                  <em style={{ color: '#d0d2dd' }}>{tr('v7.landing.inputs.human_quote')}</em>.
                  <br />{tr('v7.landing.inputs.human_outro')}</p>
                <div className="vibe-input-meta">
                  <span>{tr('v7.landing.inputs.dom')}</span>
                  <span>{tr('v7.landing.inputs.viewport')}</span>
                  <span>{tr('v7.landing.inputs.capture')}</span>
                </div>
              </article>

              <article className="vibe-input-card">
                <div className="vibe-input-badge"><Zap size={16} />{tr('v7.landing.inputs.two')}</div>
                <h3>{tr('v7.landing.inputs.backend_title')}</h3>
                <p>{tr('v7.landing.inputs.backend_copy')}</p>
                <div className="vibe-input-meta">
                  <span>{tr('v7.landing.inputs.request_id')}</span>
                  <span>{tr('v7.landing.inputs.clean_stack')}</span>
                  <span>{tr('v7.landing.inputs.reopen')}</span>
                </div>
              </article>
            </div>

            <div className="vibe-destination-ribbon">
              <span className="vibe-dest-arrow">↓</span>
              <p>{tr('v7.landing.inputs.destination')}</p>
              <div className="vibe-dest-tags">
                <span>Kanban</span>
                <span>Markdown (TASKS_FOR_AI.md)</span>
                <span>MCP Server</span>
                <span>AI IDE (Cursor, Claude Code, Windsurf)</span>
              </div>
            </div>
          </div>
        </section>

        <section id="loop" className="vibe-section">
          <div className="vibe-shell">
            <div className="vibe-kicker">The Vibe Loop</div>
            <h2 className="vibe-section-title">{tr('v7.landing.loop.title')}</h2>
            <p className="vibe-section-lead">{tr('v7.landing.loop.lead')}</p>
            <div className="vibe-loop-grid">
              {LOOP.map(({ n, icon: Icon, title, text }) => (
                <article className="vibe-loop-card" key={n}>
                  <div className="vibe-loop-top"><span>{n}</span><Icon size={19} /></div>
                  <h3>{title}</h3><p>{text}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="live-demo" className="vibe-section vibe-demo-section">
          <div className="vibe-shell vibe-demo-grid">
            <div className="vibe-demo-copy">
              <div className="vibe-kicker">{tr('v7.landing.demo.kicker')}</div>
              <h2 className="vibe-section-title">{tr('v7.landing.demo.title')}</h2>
              <p className="vibe-section-lead">{tr('v7.landing.demo.lead')}</p>
              <div className="vibe-demo-points">
                <div><span>1</span><p><b>{tr('v7.landing.demo.locator_title')}</b>{tr('v7.landing.demo.locator_copy')}</p></div>
                <div><span>2</span><p><b>Minimum necessary</b>{tr('v7.landing.demo.minimum_copy')}</p></div>
                <div><span>3</span><p><b>DoD → Review</b>{tr('v7.landing.demo.review_copy')}</p></div>
              </div>
              <button className="vibe-btn vibe-btn-primary" type="button" onClick={openWidget}><Eye size={17} />{tr('v7.landing.demo.open_widget')}</button>
            </div>

            <div className="vibe-demo-app" data-vibe-demo-target="pricing-preview">
              <div className="vibe-demo-windowbar"><i /><i /><i /><span>client-project.local / pricing</span></div>
              <div className="vibe-demo-app-body">
                <div className="vibe-demo-side"><div className="active" /><div /><div /><div /></div>
                <div className="vibe-demo-canvas">
                  <span className="vibe-demo-caption">{tr('v7.landing.demo.select_element')}</span>
                  <div className="vibe-fake-title" /><div className="vibe-fake-sub" />
                  <div className="vibe-fake-cards">
                    <div className="vibe-fake-card"><small>FREE</small><b>0 ₽</b><span /></div>
                    <div className="vibe-fake-card target" data-vibe-demo-target="solo-card"><small>SOLO</small><b>{soloPrice}</b><span /><button type="button">{tr('v7.landing.nav.start')}</button></div>
                    <div className="vibe-fake-card"><small>STUDIO</small><b>{studioPrice}</b><span /></div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="vibe-section">
          <div className="vibe-shell vibe-split">
            <article className="vibe-big-card">
              <span className="vibe-tag">Local-first DX</span>
              <h2>{tr('v7.landing.local.title')}</h2>
              <p>{tr('v7.landing.local.copy')}</p>
              <div className="vibe-terminal">
                <div className="vibe-terminal-head"><Terminal size={14} /><span>terminal</span><button onClick={copyCli} type="button"><Copy size={13} /> {copied ? tr('v7.landing.common.copied') : tr('v7.landing.common.copy')}</button></div>
                <pre>{cli}</pre>
              </div>
            </article>
            <article className="vibe-big-card vibe-philosophy">
              <span className="vibe-tag">What VibeUs is not</span>
              <h2>{tr('v7.landing.not_pm.title')}</h2>
              <p>{tr('v7.landing.not_pm.copy')}</p>
              <div className="vibe-not-list">
                <div><span>×</span>{tr('v7.landing.not_pm.jira')}</div>
                <div><span>×</span>{tr('v7.landing.not_pm.magic_ai')}</div>
                <div><span>×</span>{tr('v7.landing.not_pm.ide')}</div>
                <div><span>+</span>{tr('v7.landing.not_pm.context')}</div>
              </div>
              <div className="vibe-flow-rings" aria-hidden="true" />
            </article>
          </div>
        </section>

        <section id="security" className="vibe-section">
          <div className="vibe-shell">
            <div className="vibe-kicker">Trust is a feature</div>
            <h2 className="vibe-section-title">{tr('v7.landing.security.title')}</h2>
            <div className="vibe-security-grid">
              <div className="vibe-security-list">
                <div><ShieldCheck /><span><b>Preview isolation</b><small>{tr('v7.landing.security.preview')}</small></span><em>origin boundary</em></div>
                <div><GitBranch /><span><b>Scoped capabilities</b><small>{tr('v7.landing.security.capabilities')}</small></span><em>least privilege</em></div>
                <div><Radio /><span><b>Telemetry opt-in</b><small>{tr('v7.landing.security.telemetry')}</small></span><em>minimum necessary</em></div>
                <div><UserCheck /><span><b>Human acceptance</b><small>{tr('v7.landing.security.human')}</small></span><em>review gate</em></div>
              </div>
              <aside className="vibe-trust-card">
                <Sparkles size={20} />
                <h3>{tr('v7.landing.security.principle')}</h3>
                <p>{tr('v7.landing.security.principle_copy')}</p>
                <pre><span>release gate:</span>{'\n'}  tenant_isolation: <b>required</b>{'\n'}  tunnel_auth: <b>required</b>{'\n'}  billing_replay: <b>required</b>{'\n'}  migration_restore: <b>required</b></pre>
              </aside>
            </div>
          </div>
        </section>

        <section id="founding" className="vibe-section vibe-founding-section">
          <div className="vibe-shell">
            <div className="vibe-founding-card">
              <div className="vibe-kicker"><Sparkles size={14} /> Founding access</div>
              <h2>{tr('v7.landing.founding.title')}</h2>
              <p className="vibe-founding-text">
                {tr('v7.landing.founding.question')}
                <br /><br />
                {tr('v7.landing.founding.offer_intro')} <strong>{tr('v7.landing.founding.offer_strong')}</strong>.
                {' '}{tr('v7.landing.founding.offer_outro')}
              </p>

              <div className="vibe-founding-allocations">
                <div className="vibe-alloc-item">
                  <b style={{ color: '#7fe0b5' }}>30 ×</b>
                  <span>{tr('v7.landing.founding.solo')}</span>
                </div>
                <div className="vibe-alloc-item">
                  <b style={{ color: '#b5a9ff' }}>20 ×</b>
                  <span>{tr('v7.landing.founding.studio')}</span>
                </div>
              </div>

              <div className="vibe-founding-cta">
                <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', justifyContent: 'center' }}>
                  <Link className="vibe-btn vibe-btn-primary" to={toCreateUrl({ promo: 'FOUNDING-SOLO30', plan: 'solo' })}>{tr('v7.landing.founding.get_solo')}<ArrowRight size={16} />
                  </Link>
                  <Link className="vibe-btn vibe-btn-secondary" to={toCreateUrl({ promo: 'FOUNDING-STUDIO30', plan: 'studio' })}>{tr('v7.landing.founding.get_studio')}<ArrowRight size={16} />
                  </Link>
                </div>
                <span className="vibe-founding-note">{tr('v7.landing.founding.auto_code')}</span>
              </div>
            </div>
          </div>
        </section>

        <section id="pricing" className="vibe-section">
          <div className="vibe-shell">
            <div className="vibe-kicker">{tr('v7.landing.pricing.kicker')}</div>
            <h2 className="vibe-section-title">{tr('v7.landing.pricing.title')}</h2>
            <p className="vibe-section-lead">{tr('v7.landing.pricing.lead', { days: periodDays })}</p>
            {globalVisible && <div className="vibe-market-switch" aria-label={tr('v7.landing.pricing.region')}><button type="button" className={market === 'ru' ? 'active' : ''} onClick={() => setPricingMarket('ru')}>{tr('v7.landing.pricing.russia')}</button><button type="button" className={market === 'global' ? 'active' : ''} onClick={() => setPricingMarket('global')}>International · $</button></div>}
            <div className="vibe-pricing">
              <article className="vibe-price-card"><span>FREE</span><h3>0</h3><p>{tr('v7.landing.pricing.free_copy')}</p><ul><li>{tr('v7.landing.pricing.one_project')}</li><li>{tr('v7.landing.pricing.basic_loop')}</li><li>Powered by VibeUs</li></ul><Link className="vibe-btn vibe-btn-secondary" to={`/create?market=${market}`}>{tr('v7.landing.pricing.try')}</Link></article>
              <article className="vibe-price-card featured"><i>EARLY ACCESS</i><span>SOLO</span><h3>{soloPrice} <small>{tr('v7.landing.pricing.period', { days: periodDays })}</small></h3><p>{tr('v7.landing.pricing.solo_copy')}</p><ul><li>{tr('v7.landing.pricing.ten_projects')}</li><li>Live Preview + IDE bridge</li><li>Runtime Error Bridge</li></ul><Link className="vibe-btn vibe-btn-primary" to={`/create?plan=solo&market=${market}`}>{tr('v7.landing.pricing.choose_solo')}</Link></article>
              <article className="vibe-price-card"><span>STUDIO</span><h3>{studioPrice} <small>{tr('v7.landing.pricing.period', { days: periodDays })}</small></h3><p>{tr('v7.landing.pricing.studio_copy')}</p><ul><li>{tr('v7.landing.pricing.fifty_projects')}</li><li>{tr('v7.landing.pricing.team_roles')}</li><li>Runtime + AI workflow</li></ul><Link className="vibe-btn vibe-btn-secondary" to={`/create?plan=studio&market=${market}`}>{tr('v7.landing.pricing.choose_studio')}</Link></article>
            </div>
            <p className="vibe-price-legal">{tr('v7.landing.pricing.legal')}</p>
          </div>
        </section>

        <section className="vibe-section" id="faq">
          <div className="vibe-shell">
            <div className="vibe-kicker">FAQ</div><h2 className="vibe-section-title">{tr('v7.landing.faq.title')}</h2>
            <div className="vibe-faq">{FAQ.map(([q, a]) => <details key={q}><summary>{q}</summary><p>{a}</p></details>)}</div>
          </div>
        </section>

        <section className="vibe-final">
          <div className="vibe-shell vibe-final-inner">
            <div><div className="vibe-kicker">Vibe is shared context.</div><h2>{tr('v7.landing.final.title')}</h2></div>
            <div className="vibe-final-actions"><button className="vibe-btn vibe-btn-secondary" onClick={openWidget} type="button"><Zap size={17} />{tr('v7.landing.final.open_widget')}</button><Link className="vibe-btn vibe-btn-primary" to="/create">{tr('v7.landing.final.create')}<ArrowRight size={16} /></Link></div>
          </div>
        </section>
      </main>

      <footer className="vibe-footer">
        <div className="vibe-shell">
          <div className="vibe-footer-brand"><span className="vibe-brand-mark"><i /></span><b>VibeUs</b><span>© 2026</span></div>
          <div className="vibe-footer-links">
            <Link to="/legal/offer">{tr('v7.legal.links.offer')}</Link><Link to="/legal/privacy">{tr('v7.legal.links.privacy')}</Link><Link to="/legal/dpa">{tr('v7.legal.links.dpa')}</Link><Link to="/legal/refunds">{tr('v7.legal.links.refunds')}</Link><a href="mailto:security@vibeus.pro">Security</a>
          </div>
        </div>
      </footer>

      {/* Real product widget. Public key is an identifier, not a secret; configure it in deployment. */}
      <VibusWidgetUI
        projectId={demoProject}
        serverUrl={serverUrl}
        publicKey={demoPublicKey}
        mode="public_feedback"
        theme="dark"
        accentColor="indigo"
      />
    </div>
  );
}