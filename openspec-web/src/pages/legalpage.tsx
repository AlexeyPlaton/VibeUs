import { Link, Navigate, useParams } from 'react-router-dom';
import { ArrowLeft, ShieldCheck } from 'lucide-react';
import { tr } from '../i18n/config';
import { LanguageSwitcher } from '../components/LanguageSwitcher';
import { MarkdownRenderer } from '../components/MarkdownRenderer';
import privacy from '../legal/docs/privacy.md?raw';
import offer from '../legal/docs/offer.md?raw';
import dpa from '../legal/docs/dpa.md?raw';
import consent from '../legal/docs/consent.md?raw';
import subprocessors from '../legal/docs/subprocessors.md?raw';
import retention from '../legal/docs/retention.md?raw';
import refunds from '../legal/docs/refunds.md?raw';
import acceptableUse from '../legal/docs/acceptable-use.md?raw';
import security from '../legal/docs/security.md?raw';
import cookies from '../legal/docs/cookies.md?raw';
import './legalpage.css';

const DOCS: Record<string, { labelKey: string; content: string }> = {
  offer: { labelKey: 'v7.legal.docs.offer', content: offer },
  privacy: { labelKey: 'v7.legal.docs.privacy', content: privacy },
  dpa: { labelKey: 'v7.legal.docs.dpa', content: dpa },
  consent: { labelKey: 'v7.legal.docs.consent', content: consent },
  subprocessors: { labelKey: 'v7.legal.docs.subprocessors', content: subprocessors },
  retention: { labelKey: 'v7.legal.docs.retention', content: retention },
  refunds: { labelKey: 'v7.legal.docs.refunds', content: refunds },
  'acceptable-use': { labelKey: 'v7.legal.docs.acceptable', content: acceptableUse },
  security: { labelKey: 'v7.legal.docs.security', content: security },
  cookies: { labelKey: 'v7.legal.docs.cookies', content: cookies },
};

export function LegalPage() {
  const { doc = '' } = useParams();
  const selected = DOCS[doc];

  if (!selected) return <Navigate to="/legal/privacy" replace />;

  return (
    <div className="legal-page">
      <header className="legal-topbar">
        <div className="legal-shell legal-topbar-inner">
          <Link to="/" className="legal-brand" aria-label={tr('v7.legal.brand_home')}>
            <span className="legal-brand-dot" /> VibeUs
          </Link>
          <div className="flex items-center gap-3"><LanguageSwitcher compact /><Link to="/" className="legal-back"><ArrowLeft size={15} /> {tr('v7.legal.back')}</Link></div>
        </div>
      </header>

      <main className="legal-shell legal-layout">
        <aside className="legal-nav" aria-label={tr('v7.legal.navigation')}>
          <div className="legal-nav-title"><ShieldCheck size={16} /> Legal center</div>
          {Object.entries(DOCS).map(([slug, item]) => (
            <Link key={slug} to={`/legal/${slug}`} className={slug === doc ? 'active' : ''}>
              {tr(item.labelKey)}
            </Link>
          ))}
        </aside>

        <article className="legal-document"><div className="legal-draft-warning"><strong>{tr('v7.legal.notice_title')}</strong><br />{tr('v7.legal.notice')}</div>
          <MarkdownRenderer content={selected.content} />
        </article>
      </main>
    </div>
  );
}
