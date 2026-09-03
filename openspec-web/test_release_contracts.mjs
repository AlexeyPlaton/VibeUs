import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const read = (file) => {
  const primaryPath = fileURLToPath(new URL(file, import.meta.url));
  if (fs.existsSync(primaryPath)) {
    return fs.readFileSync(primaryPath, 'utf8');
  }
  const dir = path.dirname(primaryPath);
  const base = path.basename(primaryPath).toLowerCase();
  if (fs.existsSync(dir)) {
    const matched = fs.readdirSync(dir).find(f => f.toLowerCase() === base);
    if (matched) {
      return fs.readFileSync(path.join(dir, matched), 'utf8');
    }
  }
  return fs.readFileSync(primaryPath, 'utf8');
};

test('browser account auth is not persisted in localStorage', () => {
  const create = read('./src/pages/CreateProjectPage.tsx');
  assert.doesNotMatch(create, /vibus_user_jwt/);
  assert.match(create, /credentials:\s*['"]include['"]/);
  assert.match(create, /\/api\/auth\/logout/);
});

test('registration fails closed without a production legal version', () => {
  const create = read('./src/pages/CreateProjectPage.tsx');
  assert.match(create, /VITE_LEGAL_VERSION/);
  assert.match(create, /legalVersionReady/);
  assert.match(create, /accept_terms/);
});

test('widget onboarding uses the canonical static bundle', () => {
  const create = read('./src/pages/CreateProjectPage.tsx');
  const widget = read('./src/widget.tsx');
  assert.match(create, /\/static\/vibus-widget\.umd\.cjs/);
  assert.match(widget, /\/static\/vibus-widget\.css/);
  assert.doesNotMatch(create, /src=\\?['"]\/widget\.js/);
});

test('access-link capability is generated in URL fragment, not query', () => {
  const tokens = read('./src/utils/accessTokens.ts');
  assert.match(tokens, /fragment\.set\(['"]vibus_auth['"]/);
  assert.doesNotMatch(tokens, /searchParams\.set\(['"]vibus_auth['"]/);
});

test('public reporter contact draft is session scoped', () => {
  const reporter = read('./src/components/widget/ui/PublicReporterWizard.tsx');
  assert.match(reporter, /sessionStorage\.setItem\(['"]vibus_feedback_draft_contact/);
  assert.doesNotMatch(reporter, /localStorage\.setItem\(['"]vibus_feedback_draft_contact/);
});

test('first-party source does not load Google Fonts', () => {
  const css = read('./src/index.css');
  const html = read('./index.html');
  assert.doesNotMatch(css, /fonts\.googleapis\.com|fonts\.gstatic\.com/);
  assert.doesNotMatch(html, /fonts\.googleapis\.com|fonts\.gstatic\.com/);
});

test('real Vibe Field landing mounts the actual widget', () => {
  const landing = read('./src/pages/LandingPage.tsx');
  assert.match(landing, /VibusWidgetUI/);
  assert.match(landing, /mode=["']public_feedback["']/);
  assert.match(landing, /v7\.landing\.hero\.manifest/);
  const en = JSON.parse(read('./src/i18n/locales/en.json'));
  assert.match(en.v7.landing.hero.manifest, /vibe/i);
});

test('preview bearer is exchanged once and never persisted in page JavaScript', () => {
  const main = read('../openspec-core/main.py');
  const tunnel = read('../openspec-core/tunnel.py');
  assert.match(main, /PreviewSession/);
  assert.match(main, /httponly=True/);
  assert.match(main, /path=["']\/["']/);
  assert.doesNotMatch(main, /vibeus_preview_access/);
  assert.doesNotMatch(tunnel, /vibeus_preview_access|__VIBUS_ACCESS_TOKEN__/);
  assert.match(tunnel, /preview_base_url/);
});

test('landing never bypasses authenticated workspace billing', () => {
  const landing = read('./src/pages/LandingPage.tsx');
  assert.doesNotMatch(landing, /api\/billing\/yookassa\/create-payment/);
  assert.match(landing, /\/create\?plan=solo/);
  assert.match(landing, /\/create\?plan=studio/);
});

test('reviewer UI uses narrow review capability instead of project write', () => {
  const state = read('./src/components/widget/hooks/useWidgetState.ts');
  const card = read('./src/components/widget/ui/KanbanCard.tsx');
  assert.match(state, /capabilities\.includes\(['"]ticket:review['"]\)/);
  assert.match(state, /reviewTicket\(/);
  assert.match(card, /canReview/);
  assert.match(card, /isReview && canReview/);
});

test('first-party browser login never asks JavaScript to receive an API bearer', () => {
  const create = read('./src/pages/CreateProjectPage.tsx');
  assert.match(create, /\/api\/auth\/browser-login/);
  assert.doesNotMatch(create, /\/api\/auth\/login/);
});

test('widget capabilities are fragment-only and never read from query/global injection', () => {
  const widget = read('./src/widget.tsx');
  const tokens = read('./src/utils/accessTokens.ts');
  assert.match(widget, /window\.location\.hash/);
  assert.doesNotMatch(widget, /queryParams\.get\(['"]vibus_auth/);
  assert.doesNotMatch(widget, /__VIBUS_ACCESS_TOKEN__/);
  assert.doesNotMatch(tokens, /queryParams\.get\(['"]vibus_auth/);
});

test('reviewers do not see custom-board management controls', () => {
  const board = read('./src/components/widget/ui/BoardView.tsx');
  assert.match(board, /canWrite && \(isCreatingBoard/);
  assert.match(board, /canWrite && \(\s*<button[\s\S]*?v7\.board\.delete_board/);
});

test('write roles and project owner tokens can also review tickets', () => {
  const auth = read('../openspec-core/auth.py');
  assert.match(auth, /"owner": \[.*"project:write".*"ticket:review"/);
  assert.match(auth, /return project, \["project:read", "project:write", "ticket:comment", "ticket:review"/);
});

test('status/review REST fallback is not also retained in the reconnect queue', () => {
  const state = read('./src/components/widget/hooks/useWidgetState.ts');
  assert.match(state, /queueWhenOffline[^\n]*false/);
  assert.match(state, /const sentViaWs = sendWsEvent\("ticket\.status\.change"/);
  assert.match(state, /if \(!sentViaWs\)/);
});

test('production requires a freshly built widget manifest and build sync step', () => {
  const main = read('../openspec-core/main.py');
  const pkg = JSON.parse(read('./package.json'));
  const sync = read('./scripts/sync-widget-to-core.mjs');
  assert.match(main, /widget-build-manifest\.json/);
  assert.match(main, /failed manifest verification/);
  assert.match(pkg.scripts['build:widget'], /sync:widget/);
  assert.match(sync, /sha256/);
});

test('network telemetry sanitizes sensitive query strings and extracts request ID', () => {
  const code = read('./src/components/widget/networkTelemetry.ts');
  assert.match(code, /export function safeUrl/);
  assert.match(code, /parsed\.origin.*parsed\.pathname|url\.origin.*url\.pathname/);
  assert.match(code, /requestId/);
  assert.match(code, /x-vibeus-request-id/);
  assert.match(code, /createCorrelationId/);
  assert.match(code, /isSameOriginRequest/);
  assert.match(code, /headers\.set\(['"]X-VibeUs-Request-ID/);
});

test('runtime error bridge contracts: one-time ingest secret, sanitization, and widget correlation', () => {
  const dash = read('./src/pages/DashboardPage.tsx');
  assert.match(dash, /Runtime Ingest Key/);
  assert.match(dash, /rotate-ingest-key/);
  assert.match(dash, /ingest_key_configured/);
  assert.match(dash, /newIngestKey/);
  assert.match(dash, /setRuntimeTracking/);
  assert.match(dash, /runtime_error_tracking_enabled/);
  assert.doesNotMatch(dash, /project\.ingest_key\b/);

  const create = read('./src/pages/CreateProjectPage.tsx');
  assert.match(create, /result\.ingest_key/);
  assert.match(create, /one-time view/);

  const widget = read('./src/components/widget/hooks/useWidgetState.ts');
  assert.match(widget, /latestErrorWithReqId/);
  assert.match(widget, /request_id:\s*latestErrorWithReqId\.requestId/);

  const main = read('../openspec-core/main.py');
  const models = read('../openspec-core/models.py');
  const bridge = read('../openspec-core/error_bridge.py');
  assert.match(main, /\/api\/ingest\/errors/);
  assert.match(main, /x-vibeus-ingest-key/);
  assert.match(main, /ingest_key_configured/);
  assert.doesNotMatch(models, /raw_ingest_key\s*=\s*Column/);
  assert.match(bridge, /redact_runtime_text/);
  assert.match(bridge, /IntegrityError/);
  assert.match(bridge, /with_for_update/);
  assert.match(bridge, /ticket_created_post_commit_side_effects/);
});



test('paid prices come from the public runtime catalog, not React constants', () => {
  const landing = read('./src/pages/LandingPage.tsx');
  const create = read('./src/pages/CreateProjectPage.tsx');
  const dashboard = read('./src/pages/DashboardPage.tsx');
  const pricing = read('./src/utils/pricing.ts');
  const active = [landing, create, dashboard].join('\n');
  assert.match(pricing, /\/api\/public\/pricing/);
  assert.match(landing, /fetchPricing/);
  assert.match(create, /fetchPricing/);
  assert.match(dashboard, /fetchPricing/);
  assert.doesNotMatch(active, /(?:990|2\s*990|2990)\s*₽/);
});

test('workspace dashboard exposes timed founding promo redemption', () => {
  const dashboard = read('./src/pages/DashboardPage.tsx');
  assert.match(dashboard, /redeem-promo/);
  assert.match(dashboard, /v7\.dashboard\.promo\.title/);
  const en = JSON.parse(read('./src/i18n/locales/en.json'));
  assert.match(en.v7.dashboard.promo.title, /Founding access/);
});

test('sitemap.xml is well-formed XML and robots.txt excludes /app', () => {
  const sitemap = read('./public/sitemap.xml');
  assert.match(sitemap, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
  assert.match(sitemap, /<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/);
  assert.doesNotMatch(sitemap, /\\"/);

  const robots = read('./public/robots.txt');
  assert.match(robots, /Disallow: \/app\r?\n/);
  assert.doesNotMatch(robots, /Disallow: \/app\/\r?\n/);
});

test('canonical OpenGraph social preview image exists with valid dimensions and size', () => {
  const primaryPath = fileURLToPath(new URL('./public/og-vibeus.png', import.meta.url));
  assert.equal(fs.existsSync(primaryPath), true, 'og-vibeus.png must exist in public directory');
  const stat = fs.statSync(primaryPath);
  assert.ok(stat.size > 20000, `og-vibeus.png size (${stat.size} bytes) should be > 20KB for high fidelity card`);

  const html = read('./index.html');
  assert.match(html, /<meta property="og:image"\s+content="https:\/\/vibeus\.pro\/og-vibeus\.png"/);
  assert.match(html, /<meta name="twitter:image"\s+content="https:\/\/vibeus\.pro\/og-vibeus\.png"/);
});

test('landing page offers clear segmented founding access for Solo and Studio', () => {
  const landing = read('./src/pages/LandingPage.tsx');
  assert.match(landing, /FOUNDING-SOLO30/);
  assert.match(landing, /FOUNDING-STUDIO30/);
  assert.match(landing, /v7\.landing\.founding\.get_solo/);
  assert.match(landing, /v7\.landing\.founding\.get_studio/);
  const en = JSON.parse(read('./src/i18n/locales/en.json'));
  assert.match(en.v7.landing.founding.get_solo, /Solo Founding/);
  assert.match(en.v7.landing.founding.get_studio, /Studio Founding/);
});

test('engineering criteria v2 is evidence-backed and risk-profiled', () => {
  const catalog = read('./src/utils/dodcatalog.ts');
  assert.match(catalog, /severity:\s*DoDSeverity/);
  assert.match(catalog, /verification:\s*DoDVerification/);
  assert.match(catalog, /negativeCase/);
  assert.match(catalog, /positiveControl/);
  assert.match(catalog, /forbiddenShortcuts/);
  assert.match(catalog, /minQuality:\s*EngineeringQualityMode/);
  const ids = [...catalog.matchAll(/id:\s*['"]([A-Z0-9_]+)['"]/g)].map(m => m[1]);
  assert.ok(new Set(ids).size >= 55, `expected >=55 canonical/preset IDs, got ${new Set(ids).size}`);
});

test('engineering catalog includes critical reusable risk profiles', () => {
  const catalog = read('./src/utils/dodcatalog.ts');
  for (const id of [
    'BASE_REGRESSION_TEST', 'SEC_CROSS_TENANT', 'API_MUTATION_IDEMPOTENCY',
    'DB_CONSTRAINT_CRITICAL_INVARIANT', 'MIGRATION_PREVIOUS_TO_HEAD',
    'CONCURRENCY_DUPLICATE_REQUEST', 'INTEGRATION_MALFORMED_2XX',
    'INTEGRATION_WEBHOOK_AUTHENTICITY', 'BILLING_DURABLE_LEDGER',
    'BILLING_REFUND_LEDGER', 'PRIVACY_DATA_MINIMIZATION', 'JOB_RETRY_IDEMPOTENT',
    'FILES_PATH_TRAVERSAL', 'REALTIME_AUTH_FIRST_FRAME', 'DEPLOY_BUILD_CLEAN'
  ]) {
    assert.match(catalog, new RegExp(`id:\\s*['"]${id}['"]`), `missing ${id}`);
  }
  for (const preset of [
    'preset_bug_fix_regression', 'preset_api_endpoint', 'preset_auth_security',
    'preset_database', 'preset_migration', 'preset_concurrency',
    'preset_external_integration', 'preset_billing_transaction', 'preset_ui_component',
    'preset_privacy', 'preset_background_job', 'preset_files_upload',
    'preset_realtime', 'preset_deployment', 'preset_fullstack_feature'
  ]) {
    assert.match(catalog, new RegExp(`id:\\s*['"]${preset}['"]`), `missing ${preset}`);
  }
});

test('AI DoD generator uses English structured execution-contract prompt', () => {
  const matcher = read('./src/utils/aidodmatcher.ts');
  assert.match(matcher, /Principal Software Engineer, Security Reviewer, and Senior QA Automation Architect/);
  assert.match(matcher, /Every bug fix requires a regression test/);
  assert.match(matcher, /malformed 2xx/);
  assert.match(matcher, /previous-production->head/);
  assert.match(matcher, /forbidden_shortcuts/);
  assert.match(matcher, /positive_control/);
  assert.match(matcher, /response_format:\s*\{\s*type:\s*['"]json_object['"]\s*\}/);
  assert.doesNotMatch(matcher, /Ты — Senior QA Automation/);
});

test('copied AI prompt uses VibeUs Engineering Execution Contract v2', () => {
  const contract = read('./src/utils/engineeringcontract.ts');
  const state = read('./src/components/widget/hooks/usewidgetstate.ts');
  assert.match(contract, /VibeUs Engineering Execution Contract v2/);
  assert.match(contract, /Never mark a criterion complete before its required verification/);
  assert.match(contract, /CRITERION: <id\/title>/);
  assert.match(contract, /Do not claim production readiness from a walkthrough alone/);
  assert.match(state, /buildTicketExecutionPrompt/);
  assert.doesNotMatch(state, /\[ЗАДАЧА ДЛЯ ИИ\]/);
});

test('AI-generated structured criteria are retained for later rich prompt rendering', () => {
  const manager = read('./src/components/widget/ui/dodmanager.tsx');
  assert.match(manager, /saveCustomCheck\(\{/);
  assert.match(manager, /requiredArtifacts:\s*item\.requiredArtifacts/);
  assert.match(manager, /forbiddenShortcuts:\s*item\.forbiddenShortcuts/);
  assert.match(manager, /minQuality:\s*qualityMode/);
});
