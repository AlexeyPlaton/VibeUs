import { Link, Navigate, useParams } from 'react-router-dom';
import { ArrowLeft, ShieldCheck } from 'lucide-react';
import i18n, { normalizeUiLocale, tr } from '../i18n/config';
import { LanguageSwitcher } from '../components/LanguageSwitcher';
import { MarkdownRenderer } from '../components/MarkdownRenderer';
import privacyRu from '../legal/docs/privacy.md?raw';
import offerRu from '../legal/docs/offer.md?raw';
import dpaRu from '../legal/docs/dpa.md?raw';
import consentRu from '../legal/docs/consent.md?raw';
import subprocessorsRu from '../legal/docs/subprocessors.md?raw';
import retentionRu from '../legal/docs/retention.md?raw';
import refundsRu from '../legal/docs/refunds.md?raw';
import acceptableUseRu from '../legal/docs/acceptable-use.md?raw';
import securityRu from '../legal/docs/security.md?raw';
import cookiesRu from '../legal/docs/cookies.md?raw';
import privacyEn from '../legal/docs/en/privacy.md?raw';
import offerEn from '../legal/docs/en/offer.md?raw';
import dpaEn from '../legal/docs/en/dpa.md?raw';
import consentEn from '../legal/docs/en/consent.md?raw';
import subprocessorsEn from '../legal/docs/en/subprocessors.md?raw';
import retentionEn from '../legal/docs/en/retention.md?raw';
import refundsEn from '../legal/docs/en/refunds.md?raw';
import acceptableUseEn from '../legal/docs/en/acceptable-use.md?raw';
import securityEn from '../legal/docs/en/security.md?raw';
import cookiesEn from '../legal/docs/en/cookies.md?raw';
import './legalpage.css';

type LegalDoc = { labelKey: string; content: string };

const RU_DOCS: Record<string, LegalDoc> = {
  offer: { labelKey: 'v7.legal.docs.offer', content: offerRu },
  privacy: { labelKey: 'v7.legal.docs.privacy', content: privacyRu },
  dpa: { labelKey: 'v7.legal.docs.dpa', content: dpaRu },
  consent: { labelKey: 'v7.legal.docs.consent', content: consentRu },
  subprocessors: { labelKey: 'v7.legal.docs.subprocessors', content: subprocessorsRu },
  retention: { labelKey: 'v7.legal.docs.retention', content: retentionRu },
  refunds: { labelKey: 'v7.legal.docs.refunds', content: refundsRu },
  'acceptable-use': { labelKey: 'v7.legal.docs.acceptable', content: acceptableUseRu },
  security: { labelKey: 'v7.legal.docs.security', content: securityRu },
  cookies: { labelKey: 'v7.legal.docs.cookies', content: cookiesRu },
};

const EN_DOCS: Record<string, LegalDoc> = {
  offer: { labelKey: 'v7.legal.docs.offer', content: offerEn },
  privacy: { labelKey: 'v7.legal.docs.privacy', content: privacyEn },
  dpa: { labelKey: 'v7.legal.docs.dpa', content: dpaEn },
  consent: { labelKey: 'v7.legal.docs.consent', content: consentEn },
  subprocessors: { labelKey: 'v7.legal.docs.subprocessors', content: subprocessorsEn },
  retention: { labelKey: 'v7.legal.docs.retention', content: retentionEn },
  refunds: { labelKey: 'v7.legal.docs.refunds', content: refundsEn },
  'acceptable-use': { labelKey: 'v7.legal.docs.acceptable', content: acceptableUseEn },
  security: { labelKey: 'v7.legal.docs.security', content: securityEn },
  cookies: { labelKey: 'v7.legal.docs.cookies', content: cookiesEn },
};

export function LegalPage() {
  const { doc = '' } = useParams();
  const locale = normalizeUiLocale(i18n.language) || 'en';
  const docs = locale === 'ru' ? RU_DOCS : EN_DOCS;
  const selected = docs[doc];

  if (!selected) return <Navigate to="/legal/privacy" replace />;

  const scopeNotice = locale === 'en'
    ? 'International hosted-service documents apply only to currently eligible markets. New hosted accounts and paid hosted checkout are not currently offered or intentionally targeted to the EEA or United Kingdom. Self-hosted software remains governed by its repository licences.'
    : tr('v7.legal.notice');

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
          {Object.entries(docs).map(([slug, item]) => (
            <Link key={slug} to={`/legal/${slug}`} className={slug === doc ? 'active' : ''}>
              {tr(item.labelKey)}
            </Link>
          ))}
        </aside>

        <article className="legal-document">
          <div className="legal-draft-warning"><strong>{tr('v7.legal.notice_title')}</strong><br />{scopeNotice}</div>
          <MarkdownRenderer content={selected.content} />
        </article>
      </main>
    </div>
  );
}
