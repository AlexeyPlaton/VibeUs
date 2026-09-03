import { findDoDItem } from './dodCatalog';
import type { DoDItem, EngineeringQualityMode } from './dodCatalog';

export const ENGINEERING_EXECUTION_CONTRACT_V2 = `# VibeUs Engineering Execution Contract v2

You are implementing an engineering ticket. The ticket description defines the requested behavior. The Definition of Done below is a mandatory execution contract, not a self-certification checklist.

## Non-negotiable rules

1. Inspect the existing implementation, contracts, data model, migrations, and relevant tests before changing code.
2. Identify the root cause and the invariant that was broken. Fix the owning production code path instead of patching only the visible symptom.
3. Preserve existing correct behavior unless the ticket explicitly changes it.
4. When a criterion requires an automated test, manual inspection does not substitute for that test.
5. A checkbox [x] is only your implementation CLAIM. VibeUs stores verification evidence separately and may refuse Review even when every box is checked.
6. Never mark a criterion complete before its required verification has actually run successfully. Never fabricate verifier metadata, targets, exit codes, contract fingerprints, or evidence receipts, and never call ticket.criteria.evidence or equivalent evidence-mutation APIs manually; evidence must come from the VibeUs verifier or authenticated human review.
7. If verification cannot run in the current environment, leave the criterion unchecked and report BLOCKED with the exact reason. Strict/Critical BLOCKER/HIGH criteria remain unverified until an allowlisted verifier passes or an authenticated human reviewer verifies them.
8. Do not make tests green by deleting or disabling the protected feature, weakening assertions, adding test-only production branches, hard-coding expected values, swallowing exceptions, or editing protected quality-gate files.
9. Security fixes must preserve the intended legitimate path. Add a positive control when a negative test could pass simply because the feature was disabled.
10. For bug fixes, add a regression test that reproduces the original failure, fails on the vulnerable behavior, passes after the fix, and is accompanied by a neighboring valid scenario when applicable.
11. For mutable or money-sensitive operations, analyze retries, duplicate requests/events, concurrency, partial failure, crash boundaries, and side-effect ordering when applicable.
12. For external providers, do not trust HTTP 2xx alone. Validate required response fields and cover timeout/network failure, malformed 2xx, provider 4xx/5xx, retry, replay, and out-of-order delivery as applicable.
13. For persistent invariants, prefer database enforcement when the property must remain true regardless of which writer changes the data. Test critical constraints against a real migrated database where practical.
14. Never rewrite already-published migration history. Use a new forward migration and verify both blank->head and previous-production->head when schema semantics change.
15. Do not leak credentials, personal data, provider secrets, raw tracebacks, or sensitive payloads into URLs, logs, screenshots, analytics, or test fixtures.
16. Run focused verification first, then adjacent regression tests, then the repository's relevant native build/type/lint/release checks.
17. Final human acceptance remains separate from AI completion. Your job is to produce a reviewable implementation with evidence.

## Required evidence format

For every BLOCKER or HIGH criterion, include this in the final implementation report:

CRITERION: <id/title>\nIMPLEMENTATION: <production files and behavior>\nTEST_OR_VERIFICATION: <test/file/check>\nCOMMAND: <exact command actually run>\nRESULT: PASS | BLOCKED\nEVIDENCE: <concise observed result/artifact>\n
Never invent a command result. If you did not run it, say BLOCKED/NOT RUN.`;

function list(label: string, values?: string[]): string {
  if (!values || values.length === 0) return '';
  return `\n${label}:\n${values.map(v => `- ${v}`).join('\n')}`;
}

export function renderCriterionContract(item: DoDItem, index?: number): string {
  const prefix = typeof index === 'number' ? `${index + 1}. ` : '';
  return `${prefix}[${item.severity.toUpperCase()}] ${item.id} — ${item.title}
REQUIREMENT: ${item.requirement}
WHY: ${item.why}
APPLICABILITY: ${item.applicability}
VERIFICATION: ${item.verification.type}${item.verification.requiredTest ? ` — ${item.verification.requiredTest}` : ''}
PASS CONDITION: ${item.verification.passCondition}${item.verification.commandHint ? `\nCOMMAND HINT: ${item.verification.commandHint}` : ''}${item.negativeCase ? `\nNEGATIVE CASE: ${item.negativeCase}` : ''}${item.positiveControl ? `\nPOSITIVE CONTROL: ${item.positiveControl}` : ''}${list('REQUIRED ARTIFACTS', item.requiredArtifacts)}${list('FORBIDDEN SHORTCUTS', item.forbiddenShortcuts)}`;
}

export function renderUnknownCriterionContract(title: string, index?: number): string {
  const prefix = typeof index === 'number' ? `${index + 1}. ` : '';
  return `${prefix}[NORMAL] CUSTOM — ${title}
REQUIREMENT: Satisfy the criterion exactly as written without changing its meaning.
VERIFICATION: Provide a concrete automated test or reproducible verification when technically possible.
PASS CONDITION: The requested property is demonstrated by actual evidence, not assertion.
FORBIDDEN SHORTCUTS:
- Do not mark this criterion complete without evidence.
- Do not weaken or delete existing tests/features merely to make the criterion appear satisfied.`;
}

export interface BuildExecutionPromptInput {
  ticketId: string;
  title: string;
  section?: string | undefined;
  summary?: string | undefined;
  status?: string | undefined;
  assignee?: string | undefined;
  sourceQuote?: string | undefined;
  reworkNotes?: string | undefined;
  bugContext?: Record<string, unknown> | undefined;
  checklists?: Record<string, boolean | undefined> | undefined;
  criteriaContract?: Record<string, DoDItem | undefined> | undefined;
  criteriaEvidence?: Record<string, { verified?: boolean; result?: string; adapter?: string; target?: string } | undefined> | undefined;
  qualityMode?: EngineeringQualityMode | undefined;
}

function renderBugContext(ctx?: Record<string, unknown>): string {
  if (!ctx) return '';
  const fields: Array<[string, unknown]> = [
    ['Type', ctx.type],
    ['URL', ctx.url || ctx.pageUrl],
    ['CSS selector', ctx.selector],
    ['Element text', ctx.elementText],
    ['Viewport', ctx.viewport || ctx.windowSize],
    ['API endpoint', ctx.apiEndpoint],
    ['HTTP status', ctx.httpStatus],
    ['Request payload', ctx.requestPayload],
    ['Response/traceback', ctx.responseTraceback || ctx.traceback],
    ['Request ID', ctx.requestId],
  ];
  const lines = fields.filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== '')
    .map(([label, value]) => `- ${label}: ${String(value)}`);
  return lines.length ? `\n## Technical context\n${lines.join('\n')}\n` : '';
}

export function buildTicketExecutionPrompt(input: BuildExecutionPromptInput): string {
  const criteria = Object.keys(input.checklists || {});
  const qualityMode = input.qualityMode || 'strict';
  let prompt = `${ENGINEERING_EXECUTION_CONTRACT_V2}\n\n---\n\n# Ticket\n\nID: ${input.ticketId}\nTITLE: ${input.title}\nQUALITY MODE: ${qualityMode.toUpperCase()}\n`;
  if (input.section) prompt += `SECTION: ${input.section}\n`;
  if (input.status) prompt += `STATUS: ${input.status}\n`;
  if (input.assignee) prompt += `ASSIGNEE: ${input.assignee}\n`;
  if (input.summary) prompt += `\n## Requested behavior\n${input.summary}\n`;
  prompt += renderBugContext(input.bugContext);
  if (input.sourceQuote) prompt += `\n## Source/spec context\n${input.sourceQuote}\n`;
  if (input.reworkNotes) prompt += `\n## Rework notes\n${input.reworkNotes}\n`;

  prompt += `\n## Definition of Done — executable criteria\n\n`;
  if (criteria.length === 0) {
    prompt += 'No explicit criteria are attached. Apply the Baseline Engineering contract and add the missing regression/security/integration criteria that are materially applicable before claiming completion.\n';
  } else {
    prompt += criteria.map((title, index) => {
      const item = input.criteriaContract?.[title] || findDoDItem(title);
      const body = item ? renderCriterionContract(item, index) : renderUnknownCriterionContract(title, index);
      const claimed = input.checklists?.[title] ? 'CLAIMED [x]' : 'PENDING [ ]';
      const receipt = input.criteriaEvidence?.[title];
      const verified = receipt?.verified === true && receipt?.result === 'PASS'
        ? `VERIFIED PASS (${receipt.adapter || 'unknown'}${receipt.target ? `: ${receipt.target}` : ''})`
        : 'UNVERIFIED';
      return `${body}\nSTATE: ${claimed}; ${verified}`;
    }).join('\n\n');
  }

  prompt += `\n\n## Final handoff\nBefore requesting Review, provide: changed production files; tests added/changed; root cause; verification commands and actual results; any blocked/unverified checks; and known remaining limitations. Do not claim production readiness from a walkthrough alone.`;
  return prompt;
}
