import { getAllAvailableChecks, isCriterionIncludedForQuality } from './dodCatalog';
import type { DoDCategory, DoDItem, DoDSeverity, EngineeringQualityMode, VerificationType } from './dodCatalog';

export interface AISettings {
  providerType: 'heuristic' | 'custom';
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface GeneratedDoDCriterion {
  id: string;
  category: DoDCategory;
  severity: DoDSeverity;
  title: string;
  requirement: string;
  why: string;
  applicability: string;
  verificationType: VerificationType;
  verificationAdapter: 'pytest' | 'node_test' | 'npm_script' | 'file_exists' | '';
  verificationTarget: string;
  requiredTest: string;
  passCondition: string;
  negativeCase: string;
  positiveControl: string;
  requiredArtifacts: string[];
  forbiddenShortcuts: string[];
}

export interface GeneratedDoDResult {
  riskProfiles: string[];
  missingContext: string[];
  suggestedPresets: string[];
  criteria: GeneratedDoDCriterion[];
}

export const DEFAULT_AI_SETTINGS: AISettings = {
  providerType: 'heuristic',
  baseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  model: 'gpt-4o-mini'
};

let inMemorySettings: AISettings = DEFAULT_AI_SETTINGS;

export function getAISettings(): AISettings { return inMemorySettings; }
export function saveAISettings(settings: AISettings): void { inMemorySettings = settings; }

export function rankChecksByRelevance(
  title: string,
  summary: string = '',
  existingCheckTitles: string[] = []
): DoDItem[] {
  const allChecks = getAllAvailableChecks();
  const text = `${title} ${summary}`.toLowerCase();
  const existingSet = new Set(existingCheckTitles.map(t => t.toLowerCase().trim()));
  return allChecks
    .map(check => {
      let score = 0;
      if (existingSet.has(check.title.toLowerCase().trim())) return { check, score: -100 };
      if (check.pattern && check.pattern.test(text)) score += 12;
      for (const tag of check.tags) if (text.includes(tag.toLowerCase())) score += 4;
      for (const profile of check.profiles) if (text.includes(profile.toLowerCase())) score += 3;
      if (check.severity === 'blocker') score += 1;
      return { check, score };
    })
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .map(s => s.check);
}

export function getGhostSuggestion(currentInput: string, ticketTitle = '', existingCheckTitles: string[] = []): string | null {
  const trimmed = currentInput.trim().toLowerCase();
  const allChecks = getAllAvailableChecks();
  const existingSet = new Set(existingCheckTitles.map(t => t.toLowerCase().trim()));
  if (trimmed.length >= 2) {
    for (const check of allChecks) {
      if (existingSet.has(check.title.toLowerCase().trim())) continue;
      const lower = check.title.toLowerCase();
      if (lower.startsWith(trimmed) || lower.includes(trimmed)) return check.title;
    }
  }
  if (!trimmed && ticketTitle.trim()) return rankChecksByRelevance(ticketTitle, '', existingCheckTitles)[0]?.title || null;
  return null;
}

function fromCatalog(items: DoDItem[]): GeneratedDoDResult {
  return {
    riskProfiles: [...new Set(items.flatMap(item => item.profiles))].slice(0, 8),
    missingContext: [],
    suggestedPresets: [],
    criteria: items.slice(0, 10).map(item => ({
      id: item.id,
      category: item.category,
      severity: item.severity,
      title: item.title,
      requirement: item.requirement,
      why: item.why,
      applicability: item.applicability,
      verificationType: item.verification.type,
      verificationAdapter: item.verification.adapter || '',
      verificationTarget: item.verification.target || '',
      requiredTest: item.verification.requiredTest || '',
      passCondition: item.verification.passCondition,
      negativeCase: item.negativeCase || '',
      positiveControl: item.positiveControl || '',
      requiredArtifacts: item.requiredArtifacts || [],
      forbiddenShortcuts: item.forbiddenShortcuts || [],
    }))
  };
}

function normalizeGenerated(raw: any): GeneratedDoDResult | null {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.criteria)) return null;
  const allowedCategories = new Set(['security','boundary','regression','spec','ui_ux','backend_perf','api','auth','database','migration','concurrency','integration','billing','privacy','background_job','files','realtime','deployment']);
  const allowedSeverity = new Set(['blocker','high','normal']);
  const allowedVerification = new Set(['automated_test','command','db_invariant','build','manual']);
  const criteria = raw.criteria.slice(0, 12).map((item: any, index: number): GeneratedDoDCriterion | null => {
    if (!item || typeof item !== 'object' || !String(item.title || '').trim()) return null;
    const category = allowedCategories.has(item.category) ? item.category : 'regression';
    const severity = allowedSeverity.has(item.severity) ? item.severity : 'high';
    const verificationType = allowedVerification.has(item.verification_type) ? item.verification_type : 'automated_test';
    return {
      id: String(item.id || `AI_CRITERION_${index + 1}`).trim().replace(/[^A-Za-z0-9_.:-]/g, '_').slice(0, 80),
      category,
      severity,
      title: String(item.title).trim().slice(0, 500),
      requirement: String(item.requirement || item.title).trim().slice(0, 2000),
      why: String(item.why || 'Required by the ticket risk profile.').trim().slice(0, 1000),
      applicability: String(item.applicability || 'Apply to this ticket.').trim().slice(0, 1000),
      verificationType,
      verificationAdapter: ['pytest', 'node_test', 'npm_script', 'file_exists'].includes(String(item.verification_adapter || '')) ? String(item.verification_adapter) as GeneratedDoDCriterion['verificationAdapter'] : '',
      verificationTarget: String(item.verification_target || '').trim().slice(0, 500),
      requiredTest: String(item.required_test || '').trim().slice(0, 1000),
      passCondition: String(item.pass_condition || 'The criterion is demonstrated by actual evidence.').trim().slice(0, 1500),
      negativeCase: String(item.negative_case || '').trim().slice(0, 1000),
      positiveControl: String(item.positive_control || '').trim().slice(0, 1000),
      requiredArtifacts: Array.isArray(item.required_artifacts) ? item.required_artifacts.map(String).slice(0, 8) : [],
      forbiddenShortcuts: Array.isArray(item.forbidden_shortcuts) ? item.forbidden_shortcuts.map(String).slice(0, 8) : [],
    };
  }).filter(Boolean) as GeneratedDoDCriterion[];
  if (!criteria.length) return null;
  return {
    riskProfiles: Array.isArray(raw.risk_profiles) ? raw.risk_profiles.map(String).slice(0, 10) : [],
    missingContext: Array.isArray(raw.missing_context) ? raw.missing_context.map(String).slice(0, 10) : [],
    suggestedPresets: Array.isArray(raw.suggested_presets) ? raw.suggested_presets.map(String).slice(0, 10) : [],
    criteria,
  };
}

export async function generateSmartDoDWithAI(
  ticketTitle: string,
  ticketSummary = '',
  category = '',
  existingCheckTitles: string[] = [],
  qualityMode: EngineeringQualityMode = 'strict',
  settingsOverride?: AISettings
): Promise<GeneratedDoDResult> {
  const settings = settingsOverride || getAISettings();
  const fallback = () => fromCatalog(rankChecksByRelevance(ticketTitle, ticketSummary, existingCheckTitles).filter(item => isCriterionIncludedForQuality(item, qualityMode)));
  if (settings.providerType === 'heuristic' || (!settings.apiKey && !settings.baseUrl.includes('localhost') && !settings.baseUrl.includes('127.0.0.1'))) return fallback();

  const systemPrompt = `You are a Principal Software Engineer, Security Reviewer, and Senior QA Automation Architect.

Your task is to create the minimum sufficient set of machine-verifiable Definition of Done criteria for one engineering ticket.

Do NOT produce generic advice such as "write good tests", "check security", or "make the code robust". Every criterion must define one observable system property and how to prove it.

First classify the ticket's risk profile. Then generate only materially applicable criteria.

Mandatory reasoning rules:
1. Every bug fix requires a regression test that reproduces the original failure and fails on the vulnerable behavior.
2. Security-sensitive changes require applicable unauthenticated, unauthorized/cross-tenant, forged/replayed input, boundary, and sensitive-data leakage tests.
3. Mutable operations require analysis of retry, duplicate delivery/request, concurrency, partial failure, crash boundaries, and side-effect ordering when applicable.
4. Payment/billing changes require idempotency, durable ledger semantics, provider authenticity, amount/currency verification, duplicate/out-of-order events, and refund semantics when applicable.
5. External API integrations require explicit timeouts plus malformed 2xx, representative 4xx/5xx, retry, replay, and required-response-field validation when applicable.
6. Persistent schema changes require a new forward migration, blank->head, previous-production->head with representative legacy data, and database-level enforcement for critical invariants.
7. UI changes require applicable loading, failed mutation/recovery, empty state, repeated click, keyboard accessibility, and representative responsive behavior.
8. Personal-data changes require minimization, leakage review, retention/deletion implications, and third-party data-flow review when applicable.
9. If a negative test could pass by simply disabling/removing the feature, require a positive control.
10. Never require a technology (RLS, Redis, Kubernetes, E2E, etc.) merely because it is fashionable; criteria must follow from this project's actual architecture and ticket.
11. Do not invent an HTTP status code if the existing API policy is unknown. Require denial according to the project contract instead.
12. Keep independent invariants in separate criteria.
13. Prefer 5-12 strong criteria over 20 vague ones.
14. Criteria are execution contracts: include required test/evidence and forbidden shortcuts.
15. verification_adapter may be only pytest, node_test, npm_script, file_exists, or empty. Never emit a shell command.
16. verification_target must be a concrete repository-relative test/file target or a declared npm script target. Never use .., absolute paths, pipes, redirects, shell operators, environment assignments, or command substitution. If a safe concrete target is not known yet, leave both adapter and target empty; Strict/Critical will require human verification instead of pretending success.

Return ONLY one valid JSON object with exactly this shape:
{
  "risk_profiles": ["..."],
  "missing_context": ["..."],
  "suggested_presets": ["..."],
  "criteria": [
    {
      "id": "STABLE_ID",
      "category": "security|boundary|regression|spec|ui_ux|backend_perf|api|auth|database|migration|concurrency|integration|billing|privacy|background_job|files|realtime|deployment",
      "severity": "blocker|high|normal",
      "title": "one precise observable property",
      "requirement": "what must be true",
      "why": "risk prevented",
      "applicability": "why it applies to this ticket",
      "verification_type": "automated_test|command|db_invariant|build|manual",
      "verification_adapter": "pytest|node_test|npm_script|file_exists|",
      "verification_target": "safe repository-relative test/file target or declared npm script target; never a shell command",
      "required_test": "specific test scenario or command",
      "pass_condition": "objective pass condition",
      "negative_case": "specific invalid/adversarial case",
      "positive_control": "valid sibling scenario that must still work",
      "required_artifacts": ["..."],
      "forbidden_shortcuts": ["..."]
    }
  ]
}`;

  const userPrompt = `TICKET TITLE: ${ticketTitle}\nENGINEERING QUALITY MODE: ${qualityMode.toUpperCase()}\nCATEGORY/HINT: ${category || 'unspecified'}\nCONTEXT: ${ticketSummary || 'No additional context provided.'}\nEXISTING CRITERIA: ${existingCheckTitles.join('; ') || 'None'}\n\nGenerate a strict, ticket-specific engineering acceptance contract. Do not repeat existing criteria.`;

  try {
    let url = settings.baseUrl.trim().replace(/\/$/, '');
    if (!url.endsWith('/chat/completions')) url = `${url}/chat/completions`;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (settings.apiKey) headers.Authorization = `Bearer ${settings.apiKey.trim()}`;
    const response = await fetch(url, {
      method: 'POST', headers,
      body: JSON.stringify({
        model: settings.model || 'gpt-4o-mini',
        messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
        temperature: 0.1,
        max_tokens: 2600,
        response_format: { type: 'json_object' }
      })
    });
    if (!response.ok) return fallback();
    const data = await response.json();
    const rawContent = data.choices?.[0]?.message?.content || '';
    const normalized = normalizeGenerated(JSON.parse(rawContent));
    return normalized || fallback();
  } catch (err) {
    console.warn('AI DoD generation failed, falling back to the local engineering catalog:', err);
    return fallback();
  }
}

export async function testAIConnection(settings: AISettings): Promise<{ ok: boolean; message: string }> {
  try {
    let url = settings.baseUrl.trim().replace(/\/$/, '');
    if (!url.endsWith('/chat/completions')) url = `${url}/chat/completions`;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (settings.apiKey) headers.Authorization = `Bearer ${settings.apiKey.trim()}`;
    const response = await fetch(url, {
      method: 'POST', headers,
      body: JSON.stringify({ model: settings.model || 'gpt-4o-mini', messages: [{ role: 'user', content: 'Reply with OK.' }], max_tokens: 10 })
    });
    if (response.ok) return { ok: true, message: 'Connection established.' };
    const text = await response.text();
    return { ok: false, message: `Server error (HTTP ${response.status}): ${text.slice(0, 120)}` };
  } catch (e: any) {
    return { ok: false, message: `Network error: ${e.message}` };
  }
}
