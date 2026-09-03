/**
 * VibeUs Engineering Criteria Contract v2.
 *
 * The catalog is intentionally data-rich: a checklist title is the human-facing
 * label, while the rest of the fields define what an AI agent must prove before
 * it may claim the criterion as complete.
 */

export type DoDCategory =
  | 'security'
  | 'boundary'
  | 'regression'
  | 'spec'
  | 'ui_ux'
  | 'backend_perf'
  | 'api'
  | 'auth'
  | 'database'
  | 'migration'
  | 'concurrency'
  | 'integration'
  | 'billing'
  | 'privacy'
  | 'background_job'
  | 'files'
  | 'realtime'
  | 'deployment';

export type DoDSeverity = 'blocker' | 'high' | 'normal';
export type VerificationType = 'automated_test' | 'command' | 'db_invariant' | 'build' | 'manual';
export type EngineeringQualityMode = 'standard' | 'strict' | 'critical';

export type VerificationAdapter = 'pytest' | 'node_test' | 'npm_script' | 'file_exists';

export interface DoDVerification {
  type: VerificationType;
  requiredTest?: string | undefined;
  passCondition: string;
  commandHint?: string | undefined;
  adapter?: VerificationAdapter | undefined;
  target?: string | undefined;
}

export interface DoDItem {
  id: string;
  category: DoDCategory;
  severity: DoDSeverity;
  title: string;
  description?: string | undefined;
  requirement: string;
  why: string;
  applicability: string;
  verification: DoDVerification;
  negativeCase?: string | undefined;
  positiveControl?: string | undefined;
  requiredArtifacts?: string[] | undefined;
  forbiddenShortcuts?: string[] | undefined;
  tags: string[];
  profiles: string[];
  minQuality: EngineeringQualityMode;
  pattern?: RegExp | undefined;
  legacyTitles?: string[] | undefined;
}

export interface DoDPreset {
  id: string;
  title: string;
  description: string;
  icon: string;
  checkIds: string[];
  quality: EngineeringQualityMode;
}

const GLOBAL_FORBIDDEN = [
  'Do not skip, xfail, delete, weaken, or replace the test that proves this criterion.',
  'Do not add test-only production branches or hard-code the expected result.',
  'Do not disable the protected feature merely to make the negative case pass.',
];

function criterion(input: Omit<DoDItem, 'forbiddenShortcuts'> & { forbiddenShortcuts?: string[] | undefined }): DoDItem {
  return {
    ...input,
    forbiddenShortcuts: [...GLOBAL_FORBIDDEN, ...(input.forbiddenShortcuts || [])],
  };
}

export const GOLDEN_DOD_CATALOG: DoDItem[] = [
  criterion({
    id: 'BASE_ROOT_CAUSE', category: 'regression', severity: 'high', minQuality: 'standard',
    title: 'Root cause is identified and the fix addresses the cause, not only the visible symptom',
    description: 'The implementation explains what invariant was broken and fixes the responsible code path.',
    requirement: 'Document the root cause and change the production path that owns the broken invariant.',
    why: 'Symptom-only fixes frequently regress or create parallel inconsistent logic.',
    applicability: 'Every bug fix or behavioral defect.',
    verification: { type: 'manual', passCondition: 'The final report names the root cause and the production change that resolves it.' },
    tags: ['bug', 'root cause', 'regression'], profiles: ['base', 'bugfix'], pattern: /bug|ошиб|слом|fix|regress/i,
  }),
  criterion({
    id: 'BASE_REGRESSION_TEST', category: 'regression', severity: 'blocker', minQuality: 'standard',
    title: 'A regression test reproduces the original failure and passes only after the fix',
    requirement: 'Add an automated test that fails on the vulnerable/old behavior and passes after the production fix.',
    why: 'A fix without a regression test can silently disappear in a later refactor.',
    applicability: 'Every reproducible bug fix unless an automated test is technically impossible and explicitly justified.',
    verification: { type: 'automated_test', requiredTest: 'A focused regression test for the reported failure', passCondition: 'The test fails before the fix and passes after it.' },
    negativeCase: 'The historical failing input or state is exercised directly.',
    positiveControl: 'A valid neighboring scenario still succeeds.',
    requiredArtifacts: ['Regression test source file', 'Test command and PASS result'],
    tags: ['bug', 'test', 'red green', 'regression'], profiles: ['base', 'bugfix'], pattern: /bug|ошиб|слом|fix|regress/i,
  }),
  criterion({
    id: 'BASE_ADJACENT_REGRESSION', category: 'regression', severity: 'high', minQuality: 'strict',
    title: 'Adjacent behavior is regression-tested so the fix does not break valid neighboring flows',
    requirement: 'Run or add tests for the closest valid sibling flows affected by the same code path.',
    why: 'Narrow fixes often make the reported test pass while breaking another valid state.',
    applicability: 'Strict and Critical changes with shared code paths.',
    verification: { type: 'automated_test', requiredTest: 'At least one adjacent positive-control scenario', passCondition: 'Focused and adjacent suites pass together.' },
    tags: ['regression', 'positive control'], profiles: ['base', 'bugfix'], pattern: /fix|refactor|shared|common|service/i,
  }),
  criterion({
    id: 'BASE_NO_SILENT_FAILURE', category: 'regression', severity: 'high', minQuality: 'strict',
    title: 'Failures are not swallowed; unexpected errors remain observable and fail closed where required',
    requirement: 'Do not replace a failure with catch-and-ignore behavior. Preserve an explicit error, rollback, retry, or recovery path.',
    why: 'Silent failure creates false success and hides data-loss or security defects.',
    applicability: 'Error handling, integrations, persistence, async work, security-sensitive flows.',
    verification: { type: 'automated_test', requiredTest: 'Dependency or persistence failure path', passCondition: 'The caller observes the documented failure/recovery result and no false success is persisted.' },
    negativeCase: 'Force the dependency or commit to fail.',
    forbiddenShortcuts: ['Do not use empty catch handlers or catch(() => {}) to satisfy the test.'],
    tags: ['error', 'fail closed', 'rollback'], profiles: ['base', 'integration'], pattern: /error|exception|ошиб|fail|catch|rollback/i,
  }),

  criterion({
    id: 'SEC_UNAUTHENTICATED', category: 'security', severity: 'blocker', minQuality: 'standard',
    title: 'Private operations reject unauthenticated requests according to the project authorization policy',
    requirement: 'Exercise the protected operation without credentials and verify denial without data leakage.',
    why: 'Authentication is the first trust boundary for private data and mutations.',
    applicability: 'Private API, WebSocket, admin, project, billing, account, and tenant-scoped operations.',
    verification: { type: 'automated_test', requiredTest: 'Unauthenticated request', passCondition: 'The operation is denied and no protected state changes.' },
    negativeCase: 'No credential is supplied.',
    tags: ['security', 'auth', '401', 'private'], profiles: ['security', 'api', 'auth'], pattern: /api|auth|private|admin|tenant|account|project|billing/i,
    legacyTitles: ['Безопасность: запрос к приватному API без заголовка Authorization возвращает HTTP 401'],
  }),
  criterion({
    id: 'SEC_INVALID_CREDENTIAL', category: 'security', severity: 'blocker', minQuality: 'strict',
    title: 'Forged, malformed, revoked, or expired credentials are rejected without fallback access',
    requirement: 'Verify invalid signatures/tokens/capabilities cannot authenticate or silently downgrade into another trusted mode.',
    why: 'Credential parsing and fallback paths are common authentication bypasses.',
    applicability: 'Token, JWT, API-key, access-link, session, or capability based authentication.',
    verification: { type: 'automated_test', requiredTest: 'Invalid/expired credential matrix', passCondition: 'Every invalid credential is denied and protected state remains unchanged.' },
    tags: ['security', 'jwt', 'token', 'revoked', 'expired'], profiles: ['security', 'auth'], pattern: /jwt|token|credential|access link|session|auth/i,
    legacyTitles: ['Безопасность: истекший или поддельный Bearer токен возвращает HTTP 401 Unauthorized'],
  }),
  criterion({
    id: 'SEC_CROSS_TENANT', category: 'security', severity: 'blocker', minQuality: 'standard',
    title: 'Cross-tenant read, write, delete, and action attempts are denied without revealing protected data',
    requirement: 'Use valid credentials for tenant/user A against an object owned by tenant/user B and verify denial.',
    why: 'IDOR and tenant-confusion defects expose or mutate another customer\'s data.',
    applicability: 'Any multi-user or multi-tenant resource identifier.',
    verification: { type: 'automated_test', requiredTest: 'Cross-tenant authorization test', passCondition: 'The foreign operation is denied according to project policy and the target remains unchanged.' },
    negativeCase: 'Authenticated attacker references another tenant\'s valid object ID.',
    positiveControl: 'The same operation on an owned object succeeds.',
    tags: ['security', 'idor', 'tenant', 'authorization'], profiles: ['security', 'api', 'database'], pattern: /tenant|workspace|project|user_id|owner|idor|resource/i,
    legacyTitles: ['Безопасность: проверка IDOR — доступ к чужим сущностям возвращает HTTP 403 Forbidden'],
  }),
  criterion({
    id: 'SEC_CAPABILITY_SCOPE', category: 'security', severity: 'blocker', minQuality: 'critical',
    title: 'Capabilities and roles authorize only the documented actions and cannot be escalated by client-controlled fields',
    requirement: 'Test the full relevant role/capability matrix and reject forged role, scope, project, or ownership fields.',
    why: 'Client-controlled authorization metadata can turn a valid credential into privilege escalation.',
    applicability: 'Role-based access, project links, team roles, admin capabilities, MCP/CLI mutations.',
    verification: { type: 'automated_test', requiredTest: 'Role/capability matrix including forbidden mutations', passCondition: 'Only documented capabilities succeed.' },
    tags: ['security', 'rbac', 'capability', 'role'], profiles: ['security', 'auth', 'realtime'], pattern: /role|capability|permission|team|reviewer|owner|admin/i,
  }),
  criterion({
    id: 'SEC_INJECTION_SQL', category: 'security', severity: 'blocker', minQuality: 'strict',
    title: 'Database inputs cannot alter query structure or bypass tenant/authorization filters',
    requirement: 'Use parameterized queries/ORM-safe predicates and test injection-shaped input on exposed query fields.',
    why: 'Injection can bypass access controls or corrupt data.',
    applicability: 'Search, filters, raw SQL, dynamic sorting, identifiers, query builders.',
    verification: { type: 'automated_test', requiredTest: 'SQL/NoSQL injection-shaped input', passCondition: 'Input is treated as data; authorization and query semantics remain intact.' },
    tags: ['security', 'sql', 'injection', 'query'], profiles: ['security', 'database', 'api'], pattern: /sql|query|filter|search|sort|database/i,
  }),
  criterion({
    id: 'SEC_XSS_OUTPUT', category: 'security', severity: 'blocker', minQuality: 'strict',
    title: 'Untrusted text is rendered without executable script, HTML, URL, or attribute injection',
    requirement: 'Test stored/reflected untrusted content at each relevant render boundary and preserve framework escaping.',
    why: 'Stored or reflected XSS compromises sessions and customer projects.',
    applicability: 'Feedback, comments, names, markdown, HTML preview, URLs, user-generated content.',
    verification: { type: 'automated_test', requiredTest: 'XSS payload render test', passCondition: 'Payload is displayed/handled as data and no executable sink is created.' },
    tags: ['security', 'xss', 'html', 'render'], profiles: ['security', 'ui'], pattern: /html|markdown|comment|feedback|render|text|url/i,
  }),
  criterion({
    id: 'SEC_SECRET_STORAGE', category: 'security', severity: 'blocker', minQuality: 'critical',
    title: 'Long-lived secrets are not stored or logged in plaintext and are never exposed through ordinary read APIs',
    requirement: 'Persist one-way digests for bearer-style credentials where verification permits; encrypt integration secrets where recovery is required; redact logs.',
    why: 'A database or log leak must not become an immediate credential leak.',
    applicability: 'API tokens, access links, integration keys, OAuth secrets, webhook secrets.',
    verification: { type: 'automated_test', requiredTest: 'Persistence and logging secret-leak test', passCondition: 'Raw secret is absent from database-facing serialization, config files, and logs.' },
    requiredArtifacts: ['Secret storage regression test'],
    tags: ['security', 'secret', 'token', 'hash', 'encryption'], profiles: ['security', 'auth', 'integration'], pattern: /secret|token|api key|credential|oauth|webhook/i,
  }),
  criterion({
    id: 'SEC_CORS_ORIGIN', category: 'security', severity: 'high', minQuality: 'strict',
    title: 'Credentialed cross-origin access uses an explicit trusted-origin policy with no wildcard bypass',
    requirement: 'Validate production CORS/origin handling against trusted and attacker origins.',
    why: 'Credentialed wildcard or reflection policies can expose authenticated endpoints cross-origin.',
    applicability: 'Browser APIs, widgets, preview origins, credentialed fetch/WebSocket flows.',
    verification: { type: 'automated_test', requiredTest: 'Trusted and untrusted origin tests', passCondition: 'Trusted origins work; untrusted origins do not receive credentialed access.' },
    tags: ['security', 'cors', 'origin'], profiles: ['security', 'api', 'realtime'], pattern: /cors|origin|browser|widget|websocket/i,
  }),
  criterion({
    id: 'SEC_RATE_LIMIT_ABUSE', category: 'security', severity: 'high', minQuality: 'critical',
    title: 'Abuse-sensitive public or authentication endpoints have bounded request rates without cross-tenant interference',
    requirement: 'Apply rate limiting at the appropriate identity/IP/project scope and test both enforcement and recovery.',
    why: 'Brute force, spam, expensive AI calls, and public feedback can exhaust resources or abuse customers.',
    applicability: 'Login, signup, public feedback, token generation, email, AI, upload, expensive public endpoints.',
    verification: { type: 'automated_test', requiredTest: 'Rate-limit threshold and reset test', passCondition: 'Excess requests are rejected while unrelated principals remain usable.' },
    tags: ['security', 'rate limit', 'spam', 'bruteforce'], profiles: ['security', 'api'], pattern: /login|signup|public|feedback|send|ai|upload|rate/i,
    legacyTitles: ['Безопасность: настроен Rate Limiting для защиты от брутфорса и спама (HTTP 429)'],
  }),

  criterion({
    id: 'BOUNDARY_REQUIRED_FIELDS', category: 'boundary', severity: 'high', minQuality: 'standard',
    title: 'Required inputs reject null, undefined, empty, and whitespace-only values without server crashes',
    requirement: 'Exercise missing, null, empty, and whitespace-only values for required fields.',
    why: 'Loose presence checks create crashes, ambiguous records, or validation bypasses.',
    applicability: 'Forms, API DTOs, identifiers, names, secrets, required metadata.',
    verification: { type: 'automated_test', requiredTest: 'Required-field negative matrix', passCondition: 'Invalid values are rejected by the documented validation layer.' },
    tags: ['boundary', 'null', 'empty', 'validation'], profiles: ['base', 'api', 'ui'], pattern: /required|field|input|form|dto|schema|name|title/i,
    legacyTitles: ['Тест (Негатив): отправка null, undefined, пустой строки ("") или пробелов'],
  }),
  criterion({
    id: 'BOUNDARY_MIN_MAX_VALID', category: 'boundary', severity: 'normal', minQuality: 'standard',
    title: 'Minimum and maximum allowed boundary values are accepted exactly at the documented limits',
    requirement: 'Test min and max valid values rather than only typical middle values.',
    why: 'Off-by-one validation bugs frequently appear exactly at contractual boundaries.',
    applicability: 'Lengths, numbers, dates, TTLs, quotas, amounts, file sizes.',
    verification: { type: 'automated_test', requiredTest: 'min and max positive boundary cases', passCondition: 'Both documented boundary values succeed.' },
    tags: ['boundary', 'min', 'max'], profiles: ['base', 'api'], pattern: /min|max|limit|length|size|amount|ttl|quota/i,
    legacyTitles: ['Тест (Позитив): проверка граничных допустимых значений диапазона (min и max)'],
  }),
  criterion({
    id: 'BOUNDARY_OUTSIDE_RANGE', category: 'boundary', severity: 'high', minQuality: 'standard',
    title: 'Values immediately outside allowed boundaries are rejected without partial side effects',
    requirement: 'Test min-1/max+1 or the nearest invalid semantic equivalent.',
    why: 'Boundary validators are easy to invert or implement inconsistently across layers.',
    applicability: 'Lengths, numbers, dates, TTLs, quotas, amounts, file sizes.',
    verification: { type: 'automated_test', requiredTest: 'Nearest-invalid boundary cases', passCondition: 'Invalid values are rejected and no state change is committed.' },
    tags: ['boundary', 'validation', '422'], profiles: ['base', 'api'], pattern: /min|max|limit|length|size|amount|ttl|quota|validation/i,
    legacyTitles: ['Тест (Негатив): выход за границы допустимого (min - 1 и max + 1) возвращает HTTP 422'],
  }),
  criterion({
    id: 'BOUNDARY_UNICODE', category: 'boundary', severity: 'normal', minQuality: 'strict',
    title: 'User-visible text safely supports Unicode, Cyrillic, emoji, and long valid strings end-to-end',
    requirement: 'Round-trip representative Unicode content through persistence, API serialization, and rendering where applicable.',
    why: 'Encoding and truncation bugs often appear only outside ASCII.',
    applicability: 'Names, comments, feedback, descriptions, searchable text.',
    verification: { type: 'automated_test', requiredTest: 'Unicode round-trip test', passCondition: 'Valid Unicode is preserved exactly without layout or serialization failure.' },
    tags: ['boundary', 'unicode', 'emoji', 'utf8'], profiles: ['ui', 'api', 'database'], pattern: /text|comment|feedback|name|description|string/i,
    legacyTitles: ['Тест (Граничные): поддержка Unicode, кириллицы, длинных строк и Emoji (utf8mb4)'],
  }),
  criterion({
    id: 'BOUNDARY_LARGE_PAYLOAD', category: 'boundary', severity: 'high', minQuality: 'strict',
    title: 'Oversized request bodies or files are rejected before excessive memory, disk, or downstream work is consumed',
    requirement: 'Test the configured size limit and the nearest oversized payload.',
    why: 'Unbounded payloads enable resource exhaustion and unstable workers.',
    applicability: 'Uploads, screenshots, logs, runtime payloads, feedback attachments, large JSON bodies.',
    verification: { type: 'automated_test', requiredTest: 'Maximum-size and oversized payload tests', passCondition: 'Valid maximum succeeds; oversized input is rejected without expensive downstream processing.' },
    tags: ['boundary', 'upload', 'payload', '413'], profiles: ['files', 'api', 'security'], pattern: /upload|file|image|payload|body|attachment|screenshot/i,
    legacyTitles: ['Тест (Негатив): загрузка слишком большого файла или payload (> Max Body Size)'],
  }),

  criterion({
    id: 'API_STRICT_REQUEST_SCHEMA', category: 'api', severity: 'high', minQuality: 'standard',
    title: 'Request schemas reject unknown or invalid fields instead of silently accepting contract drift',
    requirement: 'Use strict request validation for security- or state-sensitive DTOs and test unknown fields.',
    why: 'Silent field acceptance hides client/server drift and can enable mass-assignment bugs.',
    applicability: 'Mutation endpoints and security-sensitive request DTOs.',
    verification: { type: 'automated_test', requiredTest: 'Unknown-field and invalid-type request tests', passCondition: 'Unexpected fields/types are rejected by the API contract.' },
    tags: ['api', 'dto', 'schema', 'strict'], profiles: ['api', 'security'], pattern: /api|endpoint|request|dto|schema|mutation/i,
  }),
  criterion({
    id: 'API_RESPONSE_CONTRACT', category: 'api', severity: 'high', minQuality: 'standard',
    title: 'Success and error responses match the documented API schema without leaking internal exceptions or secrets',
    requirement: 'Assert the response shape for success and representative failures.',
    why: 'Contract drift breaks clients and raw internal errors leak sensitive implementation details.',
    applicability: 'Public or client-consumed APIs.',
    verification: { type: 'automated_test', requiredTest: 'Success/error response contract tests', passCondition: 'Response status/body match the documented contract and contain no secrets/tracebacks.' },
    tags: ['api', 'response', 'error', 'contract'], profiles: ['api'], pattern: /api|endpoint|response|error|status/i,
  }),
  criterion({
    id: 'API_MUTATION_IDEMPOTENCY', category: 'api', severity: 'blocker', minQuality: 'critical',
    title: 'Retrying the same logical mutation does not duplicate durable side effects',
    requirement: 'Define the idempotency identity and test repeated requests with the same key/event ID.',
    why: 'Networks retry; duplicate mutations create double charges, duplicate tickets, or inconsistent state.',
    applicability: 'Payments, orders, webhooks, ticket creation, queue delivery, external side effects.',
    verification: { type: 'automated_test', requiredTest: 'Same idempotency key/event delivered at least twice', passCondition: 'One logical operation and one set of durable side effects remain.' },
    negativeCase: 'Repeat the identical operation after the first success and after a retryable failure.',
    positiveControl: 'A distinct idempotency key creates a distinct logical operation when the contract permits.',
    tags: ['api', 'idempotency', 'duplicate', 'retry'], profiles: ['api', 'billing', 'integration', 'background_job'], pattern: /payment|order|webhook|event|create|mutation|retry|duplicate/i,
    legacyTitles: ['Тест: проверка идемпотентности — повтор запроса с тем же Idempotency-Key не дублирует действие'],
  }),

  criterion({
    id: 'DB_CONSTRAINT_CRITICAL_INVARIANT', category: 'database', severity: 'blocker', minQuality: 'critical',
    title: 'Critical persistent invariants are enforced by the database when application-only validation can be bypassed',
    requirement: 'Add CHECK/UNIQUE/FK/NOT NULL or equivalent database enforcement for invariants that must survive every writer.',
    why: 'Background jobs, scripts, migrations, races, and future code can bypass application validation.',
    applicability: 'Fiscal state, ownership, uniqueness, ledger state, lifecycle combinations, durable identifiers.',
    verification: { type: 'db_invariant', requiredTest: 'Direct SQL/ORM insertion of invalid states against a migrated database', passCondition: 'Invalid rows are rejected by the database; representative valid rows succeed.' },
    positiveControl: 'Insert at least one valid row for each constraint family.',
    tags: ['database', 'constraint', 'invariant', 'sql'], profiles: ['database', 'billing', 'migration'], pattern: /database|db|state|status|unique|constraint|ledger|fiscal/i,
  }),
  criterion({
    id: 'DB_UNIQUENESS', category: 'database', severity: 'blocker', minQuality: 'strict',
    title: 'Business uniqueness is enforced atomically in the database, not only by pre-check code',
    requirement: 'Use a database unique constraint/index for identities that must be globally unique within their scope.',
    why: 'Check-then-insert logic races under concurrent requests.',
    applicability: 'Provider IDs, event IDs, slugs, idempotency keys, membership uniqueness, one-per-scope records.',
    verification: { type: 'db_invariant', requiredTest: 'Duplicate insert and concurrent creation test', passCondition: 'At most one conflicting row commits.' },
    tags: ['database', 'unique', 'race'], profiles: ['database', 'concurrency'], pattern: /unique|duplicate|event_id|provider|slug|idempotency/i,
  }),
  criterion({
    id: 'DB_TRANSACTION_ATOMICITY', category: 'database', severity: 'blocker', minQuality: 'critical',
    title: 'Related durable state changes commit atomically or roll back together on failure',
    requirement: 'Place related database mutations in one transaction boundary and verify rollback on mid-operation failure.',
    why: 'Partial commits create states the rest of the system was never designed to handle.',
    applicability: 'Multi-row mutations, ledger + entitlement, conversion, quota consumption, audit + business state.',
    verification: { type: 'automated_test', requiredTest: 'Injected failure between related writes', passCondition: 'Either all intended durable writes exist or none do.' },
    tags: ['database', 'transaction', 'rollback', 'atomic'], profiles: ['database', 'billing', 'concurrency'], pattern: /transaction|commit|rollback|multi|ledger|quota|conversion/i,
  }),
  criterion({
    id: 'DB_INDEX_QUERY_PATH', category: 'backend_perf', severity: 'normal', minQuality: 'strict',
    title: 'High-cardinality lookup and foreign-key query paths have appropriate indexes for production scale',
    requirement: 'Verify indexes for frequent filters, joins, ordering, and provider/event identifiers introduced by the change.',
    why: 'Correct code can still become operationally unusable after data growth.',
    applicability: 'New tables, high-volume event/feedback/payment lookups, frequent filters and joins.',
    verification: { type: 'manual', passCondition: 'Schema/index review confirms the production query paths are indexed appropriately.' },
    tags: ['database', 'index', 'performance'], profiles: ['database', 'performance'], pattern: /search|filter|query|join|foreign key|table|index/i,
    legacyTitles: ['Бэкенд: проверены индексы в БД для полей поиска, фильтрации и foreign keys'],
  }),
  criterion({
    id: 'PERF_N_PLUS_ONE', category: 'backend_perf', severity: 'normal', minQuality: 'strict',
    title: 'List and detail paths avoid N+1 database access for related entities',
    requirement: 'Use eager loading, joins, or batching where the number of queries would otherwise scale with result count.',
    why: 'N+1 behavior passes small tests but collapses under real data volumes.',
    applicability: 'ORM list/detail endpoints loading related entities.',
    verification: { type: 'automated_test', requiredTest: 'Query-count or representative integration test when practical', passCondition: 'Query count remains bounded as result count grows.' },
    tags: ['database', 'n+1', 'performance', 'orm'], profiles: ['database', 'performance'], pattern: /list|related|orm|n\+1|query|join/i,
    legacyTitles: ['Бэкенд: исключена проблема N+1 запросов при выборке связанных сущностей'],
  }),

  criterion({
    id: 'MIGRATION_FORWARD_ONLY', category: 'migration', severity: 'blocker', minQuality: 'critical',
    title: 'Published migrations remain immutable; schema changes use a new forward migration',
    requirement: 'Create a new migration from the current head rather than editing a migration already used by deployed environments.',
    why: 'Rewriting migration history makes different installations believe they have the same revision with different schemas.',
    applicability: 'Any schema change after a migration has been published/deployed.',
    verification: { type: 'command', passCondition: 'Protected historical migration hashes remain unchanged and the migration graph advances to a new head.' },
    forbiddenShortcuts: ['Do not modify a frozen historical migration to make a new test pass.'],
    tags: ['migration', 'alembic', 'forward'], profiles: ['migration', 'database'], pattern: /migration|alembic|schema|column|table|constraint/i,
  }),
  criterion({
    id: 'MIGRATION_BLANK_TO_HEAD', category: 'migration', severity: 'blocker', minQuality: 'strict',
    title: 'A blank database upgrades to the current migration head successfully',
    requirement: 'Run the real migration chain from an empty database.',
    why: 'Fresh installs expose missing dependencies and migration-order assumptions.',
    applicability: 'Every migration release.',
    verification: { type: 'command', commandHint: 'alembic upgrade head on a blank database', passCondition: 'All migrations apply and the final schema matches the expected head.' },
    tags: ['migration', 'blank', 'head'], profiles: ['migration'], pattern: /migration|schema|alembic/i,
  }),
  criterion({
    id: 'MIGRATION_PREVIOUS_TO_HEAD', category: 'migration', severity: 'blocker', minQuality: 'critical',
    title: 'The previous production schema upgrades to head while preserving valid existing data semantics',
    requirement: 'Create a database at the prior production revision, seed representative legacy rows, then upgrade to head.',
    why: 'Production upgrades are not equivalent to fresh installs.',
    applicability: 'Every migration that changes columns, constraints, defaults, or lifecycle semantics.',
    verification: { type: 'automated_test', requiredTest: 'Previous-revision upgrade with legacy data', passCondition: 'Upgrade succeeds and legacy rows end in explicit, safe states.' },
    tags: ['migration', 'legacy', 'upgrade'], profiles: ['migration', 'database'], pattern: /migration|backfill|legacy|existing data|schema/i,
  }),
  criterion({
    id: 'MIGRATION_SINGLE_HEAD', category: 'migration', severity: 'high', minQuality: 'strict',
    title: 'The migration graph has exactly one intended head after the change',
    requirement: 'Check for accidental branches and merge heads intentionally when needed.',
    why: 'Multiple unintended heads make deployment order ambiguous.',
    applicability: 'Repositories using linear or intentionally merged migration history.',
    verification: { type: 'command', passCondition: 'Migration tooling reports exactly the intended head set.' },
    tags: ['migration', 'head', 'branch'], profiles: ['migration'], pattern: /migration|alembic|head|revision/i,
  }),

  criterion({
    id: 'CONCURRENCY_DUPLICATE_REQUEST', category: 'concurrency', severity: 'blocker', minQuality: 'critical',
    title: 'Concurrent duplicate requests cannot create duplicate business effects',
    requirement: 'Issue simultaneous equivalent requests and assert the documented one-winner/idempotent behavior.',
    why: 'Sequential tests do not expose check-then-act races.',
    applicability: 'Create, claim, redeem, payment, quota, invitation, conversion, token issuance.',
    verification: { type: 'automated_test', requiredTest: 'Concurrent duplicate request test', passCondition: 'The final durable state satisfies the exactly-once/one-winner invariant.' },
    tags: ['concurrency', 'race', 'duplicate'], profiles: ['concurrency', 'billing', 'api'], pattern: /concurrent|race|duplicate|create|claim|redeem|quota|payment/i,
  }),
  criterion({
    id: 'CONCURRENCY_STALE_REVISION', category: 'concurrency', severity: 'blocker', minQuality: 'critical',
    title: 'Stale writers are rejected or safely reconciled using an authoritative revision/version contract',
    requirement: 'Exercise two writers starting from the same revision and verify conflict handling without lost updates.',
    why: 'Last-write-wins can silently erase another user or agent mutation.',
    applicability: 'Kanban/board sync, collaborative state, optimistic concurrency, WebSocket mutations.',
    verification: { type: 'automated_test', requiredTest: 'Two-writer stale revision test', passCondition: 'One update is rejected/rebased/resynced according to the protocol; no update is silently lost.' },
    tags: ['concurrency', 'revision', 'lost update'], profiles: ['concurrency', 'realtime'], pattern: /revision|version|websocket|sync|board|concurrent/i,
  }),
  criterion({
    id: 'CONCURRENCY_SIDE_EFFECT_ORDER', category: 'concurrency', severity: 'blocker', minQuality: 'critical',
    title: 'Irreversible external side effects do not occur before the local transaction state needed to recover them is durable',
    requirement: 'Design side-effect ordering or an outbox/recovery path so a crash cannot leave an untracked external success.',
    why: 'Process crashes between provider success and local commit create orphan operations.',
    applicability: 'Payments, email, webhooks, GitHub writes, external AI jobs, provisioning.',
    verification: { type: 'automated_test', requiredTest: 'Crash/failure injection around side-effect boundary', passCondition: 'Every external success is either durably tracked or safely recoverable/reconciled.' },
    tags: ['concurrency', 'side effect', 'outbox', 'crash'], profiles: ['concurrency', 'integration', 'billing'], pattern: /external|provider|email|github|payment|side effect|commit/i,
  }),

  criterion({
    id: 'INTEGRATION_TIMEOUT', category: 'integration', severity: 'high', minQuality: 'strict',
    title: 'External calls use explicit timeouts and bounded retry behavior appropriate to operation semantics',
    requirement: 'Configure connect/read/overall timeout behavior and do not retry unsafe non-idempotent operations blindly.',
    why: 'Unbounded calls exhaust workers; unsafe retries duplicate side effects.',
    applicability: 'HTTP APIs, AI providers, payment providers, email, GitHub, Telegram, webhooks.',
    verification: { type: 'automated_test', requiredTest: 'Timeout and retry-bound test', passCondition: 'The call fails/retries within the documented bound and does not duplicate side effects.' },
    tags: ['integration', 'timeout', 'retry'], profiles: ['integration', 'api'], pattern: /external|provider|http|api|telegram|github|email|ai|webhook/i,
    legacyTitles: ['Бэкенд: настроены таймауты и ограниченные retry для внешних сетевых вызовов (API/микросервисы)'],
  }),
  criterion({
    id: 'INTEGRATION_MALFORMED_2XX', category: 'integration', severity: 'blocker', minQuality: 'critical',
    title: 'Malformed or incomplete 2xx provider responses fail closed instead of being treated as successful operations',
    requirement: 'Validate all provider fields required to establish success before persisting/returning success.',
    why: 'HTTP success alone does not prove the provider created a usable operation.',
    applicability: 'Payments, uploads, provisioning, OAuth, external task creation, AI responses.',
    verification: { type: 'automated_test', requiredTest: 'Missing/empty/invalid required fields in a 2xx response', passCondition: 'No false local success is persisted or returned.' },
    tags: ['integration', 'malformed', '2xx', 'fail closed'], profiles: ['integration', 'billing'], pattern: /provider|response|confirmation|external|api|payment/i,
  }),
  criterion({
    id: 'INTEGRATION_4XX_5XX', category: 'integration', severity: 'high', minQuality: 'strict',
    title: 'Provider 4xx and 5xx responses follow explicit error/retry semantics without leaking provider internals',
    requirement: 'Test representative client and server errors and map them to stable local behavior.',
    why: 'Unstructured propagation creates broken UX, retry storms, or information leaks.',
    applicability: 'External HTTP providers.',
    verification: { type: 'automated_test', requiredTest: 'Representative provider 4xx and 5xx tests', passCondition: 'Local state and response behavior match the documented contract.' },
    tags: ['integration', '4xx', '5xx', 'retry'], profiles: ['integration'], pattern: /provider|external|http|api|webhook/i,
  }),
  criterion({
    id: 'INTEGRATION_WEBHOOK_AUTHENTICITY', category: 'integration', severity: 'blocker', minQuality: 'critical',
    title: 'Webhook mutations are based on authenticated or provider-refetched authoritative state, not untrusted payload claims',
    requirement: 'Authenticate the event and/or re-fetch the provider object before applying security- or money-sensitive mutations.',
    why: 'Public webhook endpoints receive attacker-controlled JSON.',
    applicability: 'Payment, GitHub, email, CI, or any externally delivered event that changes durable state.',
    verification: { type: 'automated_test', requiredTest: 'Forged event whose provider-refetched status contradicts the payload', passCondition: 'No local mutation occurs from the forged claim.' },
    tags: ['integration', 'webhook', 'authenticity', 'provider'], profiles: ['integration', 'billing', 'security'], pattern: /webhook|event|provider|payment|callback/i,
  }),
  criterion({
    id: 'INTEGRATION_EVENT_REPLAY', category: 'integration', severity: 'blocker', minQuality: 'critical',
    title: 'Duplicate and replayed external events are idempotent at the durable ledger boundary',
    requirement: 'Persist and uniquely identify provider/event IDs before or atomically with applying effects.',
    why: 'Webhook and queue providers routinely redeliver events.',
    applicability: 'Webhooks, queues, background delivery, GitHub callbacks, payment notifications.',
    verification: { type: 'automated_test', requiredTest: 'Same event delivered multiple times', passCondition: 'Exactly one durable event/effect is recorded.' },
    tags: ['integration', 'replay', 'duplicate', 'event'], profiles: ['integration', 'billing', 'background_job'], pattern: /webhook|event|queue|delivery|callback/i,
  }),
  criterion({
    id: 'INTEGRATION_OUT_OF_ORDER', category: 'integration', severity: 'blocker', minQuality: 'critical',
    title: 'Out-of-order external events cannot move a lifecycle backwards or overwrite newer authoritative state',
    requirement: 'Exercise valid events in non-chronological delivery order and enforce monotonic/authoritative transitions.',
    why: 'Distributed event delivery is not guaranteed to be ordered.',
    applicability: 'Payment status, async jobs, provisioning, sync protocols, webhook-driven lifecycle.',
    verification: { type: 'automated_test', requiredTest: 'Out-of-order event sequence', passCondition: 'Final local state reflects authoritative lifecycle rules, not arrival order.' },
    tags: ['integration', 'ordering', 'lifecycle'], profiles: ['integration', 'billing', 'realtime'], pattern: /status|lifecycle|webhook|event|async|sync/i,
  }),

  criterion({
    id: 'BILLING_DURABLE_LEDGER', category: 'billing', severity: 'blocker', minQuality: 'critical',
    title: 'Money-moving operations have a durable local ledger entry before the application reports success',
    requirement: 'Persist the provider/local payment identity and essential accounting state before returning a successful checkout/operation result.',
    why: 'A provider success without a durable local record cannot be reconciled reliably.',
    applicability: 'Checkout, refunds, payouts, credits, subscription purchases.',
    verification: { type: 'automated_test', requiredTest: 'Database commit failure after provider success', passCondition: 'The application does not report success when the ledger cannot be persisted.' },
    tags: ['billing', 'ledger', 'payment', 'durable'], profiles: ['billing'], pattern: /payment|checkout|refund|billing|money|subscription/i,
  }),
  criterion({
    id: 'BILLING_AMOUNT_CURRENCY', category: 'billing', severity: 'blocker', minQuality: 'critical',
    title: 'Provider amount and currency are verified against the server-side expected transaction before entitlements change',
    requirement: 'Never trust client or webhook amount/currency alone; compare authoritative provider data with server-side pricing/order state.',
    why: 'Mismatched amount/currency can grant access for an invalid payment.',
    applicability: 'Payment success, refund, capture, subscription entitlement.',
    verification: { type: 'automated_test', requiredTest: 'Provider success with wrong amount and wrong currency', passCondition: 'Entitlement/accounting mutation is rejected for mismatched values.' },
    tags: ['billing', 'amount', 'currency', 'payment'], profiles: ['billing'], pattern: /payment|amount|currency|price|subscription|refund/i,
  }),
  criterion({
    id: 'BILLING_REFUND_LEDGER', category: 'billing', severity: 'blocker', minQuality: 'critical',
    title: 'Refunds are represented as a durable, idempotent ledger that supports multiple partial refunds',
    requirement: 'Track provider refund identity, original payment, amount, currency, status, and cumulative refunded amount.',
    why: 'A single boolean refunded flag cannot model partial refunds or duplicate webhook delivery.',
    applicability: 'Any product that accepts refunds.',
    verification: { type: 'automated_test', requiredTest: 'Duplicate full refund and multiple partial refund scenarios', passCondition: 'Refund rows are unique by provider identity and cumulative state is correct.' },
    tags: ['billing', 'refund', 'ledger', 'partial'], profiles: ['billing'], pattern: /refund|возврат|payment|billing/i,
  }),
  criterion({
    id: 'BILLING_NO_AUTOMATIC_FISCAL_CLAIM', category: 'billing', severity: 'blocker', minQuality: 'critical',
    title: 'Provider refund/payment events never falsely claim that a separate fiscal/tax reconciliation has already been completed',
    requirement: 'Keep provider money movement and fiscal receipt lifecycle as separate auditable states unless the provider contract truly guarantees both.',
    why: 'Accounting and fiscal obligations may require a separate operator/provider action.',
    applicability: 'Systems with external fiscalization, NPD receipts, KKT, tax receipts, or accounting reconciliation.',
    verification: { type: 'automated_test', requiredTest: 'Payment/refund event before fiscal reconciliation', passCondition: 'Fiscal state remains explicitly pending/required until real reconciliation evidence exists.' },
    tags: ['billing', 'fiscal', 'receipt', 'tax'], profiles: ['billing'], pattern: /receipt|fiscal|tax|npd|kkt|refund|payment/i,
  }),
  criterion({
    id: 'BILLING_BUYER_SNAPSHOT', category: 'billing', severity: 'blocker', minQuality: 'critical',
    title: 'Fiscal/accounting buyer identity is snapshotted immutably at transaction time and legacy uncertainty is explicit',
    requirement: 'Persist buyer identity required for the transaction; do not reconstruct historical facts from mutable current workspace data.',
    why: 'Mutable profile fields cannot prove who a historical payment/receipt belonged to.',
    applicability: 'Receipts, invoices, B2B payer identity, accounting records.',
    verification: { type: 'automated_test', requiredTest: 'Workspace changes after payment plus legacy unverified-row scenario', passCondition: 'Historical transaction uses its own verified snapshot or fails closed pending reconciliation.' },
    tags: ['billing', 'buyer', 'snapshot', 'receipt'], profiles: ['billing'], pattern: /buyer|payer|email|inn|company|receipt|invoice/i,
  }),

  criterion({
    id: 'UI_LOADING_STATE', category: 'ui_ux', severity: 'normal', minQuality: 'standard',
    title: 'Async UI exposes a clear loading state and prevents accidental duplicate submission',
    requirement: 'Disable or otherwise guard repeated actions while the same mutation is pending.',
    why: 'Double clicks create duplicate requests and unclear user feedback.',
    applicability: 'Forms, checkout, create/update/delete actions, AI generation, uploads.',
    verification: { type: 'automated_test', requiredTest: 'Repeated-click/loading interaction test when UI test infrastructure exists', passCondition: 'Only one intended mutation is sent and the user sees pending state.' },
    tags: ['ui', 'loading', 'double click', 'spinner'], profiles: ['ui'], pattern: /button|submit|form|loading|create|save|payment|upload/i,
    legacyTitles: ['UI/UX: реализованы состояния загрузки (Loading skeleton / Spinner) и блокировка повторных кликов'],
  }),
  criterion({
    id: 'UI_ERROR_RECOVERY', category: 'ui_ux', severity: 'high', minQuality: 'standard',
    title: 'UI failure states explain the failed action and provide a safe retry or recovery path without false optimistic success',
    requirement: 'Exercise failed network/server mutation and keep local UI consistent with authoritative server state.',
    why: 'Optimistic success after a failed write creates user-visible data loss and confusion.',
    applicability: 'Any remote read/mutation with user-visible state.',
    verification: { type: 'automated_test', requiredTest: 'Network/server failure UI test where practical', passCondition: 'The UI shows failure/recovery and does not permanently display unconfirmed success.' },
    tags: ['ui', 'error', 'recovery', 'optimistic'], profiles: ['ui', 'api'], pattern: /ui|form|mutation|error|toast|network|save/i,
    legacyTitles: ['UI/UX: оформлены понятные Empty State (когда данных нет) и Error Toast при сбое'],
  }),
  criterion({
    id: 'UI_EMPTY_STATE', category: 'ui_ux', severity: 'normal', minQuality: 'standard',
    title: 'Empty data states are intentional, understandable, and do not look like a broken screen',
    requirement: 'Render a dedicated empty state with the relevant next action when data legitimately has zero items.',
    why: 'Blank screens are indistinguishable from failed loading.',
    applicability: 'Lists, dashboards, projects, tickets, keys, receipts, searches.',
    verification: { type: 'manual', passCondition: 'Zero-item state is visibly distinct from loading/error and offers the appropriate next action.' },
    tags: ['ui', 'empty'], profiles: ['ui'], pattern: /list|dashboard|project|ticket|empty|search|table/i,
  }),
  criterion({
    id: 'UI_RESPONSIVE', category: 'ui_ux', severity: 'normal', minQuality: 'standard',
    title: 'The changed UI remains usable on representative mobile and desktop viewports without horizontal overflow',
    requirement: 'Check at least one narrow mobile viewport and one desktop viewport for the modified interface.',
    why: 'Layout regressions often appear only at narrow widths.',
    applicability: 'User-facing layout/component changes.',
    verification: { type: 'manual', passCondition: 'Primary controls remain visible/clickable and content does not unintentionally overflow.' },
    tags: ['ui', 'responsive', 'mobile'], profiles: ['ui'], pattern: /ui|layout|component|modal|page|button|mobile|responsive/i,
    legacyTitles: ['UI/UX: адаптивность проверена на Mobile вьюпорте (390x844) и Desktop (1440px)'],
  }),
  criterion({
    id: 'UI_KEYBOARD_A11Y', category: 'ui_ux', severity: 'normal', minQuality: 'strict',
    title: 'Interactive UI remains keyboard-operable with visible focus and correct dialog Escape/Enter behavior',
    requirement: 'Verify keyboard navigation and semantic interaction for changed controls.',
    why: 'Mouse-only interaction excludes keyboard and assistive-technology users.',
    applicability: 'Dialogs, forms, menus, tabs, interactive custom controls.',
    verification: { type: 'manual', passCondition: 'Tab order, focus visibility, activation, and dialog keyboard behavior are usable.' },
    tags: ['ui', 'a11y', 'keyboard', 'focus'], profiles: ['ui'], pattern: /modal|dialog|form|menu|tab|button|a11y|keyboard/i,
    legacyTitles: ['UI/UX: доступность (a11y) — навигация с клавиатуры (Tab, Enter, Escape) и фокус-стейты'],
  }),

  criterion({
    id: 'PRIVACY_DATA_MINIMIZATION', category: 'privacy', severity: 'blocker', minQuality: 'critical',
    title: 'Only data necessary for the feature is collected, persisted, logged, and forwarded to third parties',
    requirement: 'Review each new field/payload/log line against the feature purpose and remove unnecessary personal or secret data.',
    why: 'Unnecessary data increases breach impact and compliance obligations.',
    applicability: 'Feedback, diagnostics, analytics, AI payloads, integrations, user/account data.',
    verification: { type: 'manual', passCondition: 'Data-flow review identifies each field, purpose, storage, recipient, and retention need.' },
    tags: ['privacy', 'pii', 'minimization', 'data flow'], profiles: ['privacy', 'security'], pattern: /email|user|feedback|log|analytics|ai|personal|pii|contact/i,
  }),
  criterion({
    id: 'PRIVACY_NO_SECRET_URL_LOG', category: 'privacy', severity: 'blocker', minQuality: 'strict',
    title: 'Bearer credentials and sensitive personal data do not leak through URLs, logs, analytics, or client-side persistent storage',
    requirement: 'Keep credentials out of query strings and redact sensitive values from logs/telemetry/storage.',
    why: 'URLs and logs are copied, cached, indexed, and shared widely.',
    applicability: 'Tokens, access links, auth flows, diagnostics, browser storage, analytics.',
    verification: { type: 'automated_test', requiredTest: 'Credential/PII leakage source or runtime test', passCondition: 'Sensitive values are absent from prohibited sinks.' },
    tags: ['privacy', 'secret', 'url', 'log', 'localStorage'], profiles: ['privacy', 'security'], pattern: /token|secret|url|query|log|storage|analytics|pii/i,
  }),
  criterion({
    id: 'PRIVACY_DELETION_SEMANTICS', category: 'privacy', severity: 'high', minQuality: 'critical',
    title: 'Delete/account/workspace removal semantics are explicit for active data, dependent records, external copies, and backups',
    requirement: 'Define what is deleted, retained, anonymized, or asynchronously cleaned and test the active-system behavior.',
    why: 'Partial deletion leaves unexpected personal data and broken foreign references.',
    applicability: 'Account/project/workspace deletion and retention changes.',
    verification: { type: 'automated_test', requiredTest: 'Deletion cascade/retention behavior', passCondition: 'Active-system data matches the documented deletion contract.' },
    tags: ['privacy', 'delete', 'retention'], profiles: ['privacy', 'database'], pattern: /delete|remove|account|workspace|project|retention|purge/i,
  }),

  criterion({
    id: 'JOB_RETRY_IDEMPOTENT', category: 'background_job', severity: 'blocker', minQuality: 'critical',
    title: 'Background job retries are idempotent and cannot duplicate the job\'s durable or external effects',
    requirement: 'Design a stable job/event identity and test repeated execution after partial failure.',
    why: 'At-least-once job delivery is common in real systems.',
    applicability: 'Queues, cron jobs, async workers, email, sync, webhook processing.',
    verification: { type: 'automated_test', requiredTest: 'Retry after partial failure and duplicate delivery', passCondition: 'Final business effect occurs once or is explicitly cumulative by contract.' },
    tags: ['job', 'retry', 'idempotency'], profiles: ['background_job', 'concurrency'], pattern: /job|queue|worker|cron|background|retry|async/i,
  }),
  criterion({
    id: 'JOB_POISON_FAILURE', category: 'background_job', severity: 'high', minQuality: 'critical',
    title: 'Permanently failing jobs stop retrying indefinitely and remain observable for operator recovery',
    requirement: 'Use bounded attempts/dead-letter/error state and preserve enough context to diagnose without leaking secrets.',
    why: 'Poison jobs create retry storms and hide persistent operational defects.',
    applicability: 'Queues and scheduled/background work.',
    verification: { type: 'automated_test', requiredTest: 'Permanent failure exceeds retry budget', passCondition: 'Retries stop at the configured bound and the failure remains observable.' },
    tags: ['job', 'dead letter', 'retry'], profiles: ['background_job'], pattern: /job|queue|worker|retry|dead letter|failure/i,
  }),

  criterion({
    id: 'FILES_PATH_TRAVERSAL', category: 'files', severity: 'blocker', minQuality: 'critical',
    title: 'User-controlled filenames and paths cannot escape the intended storage directory or overwrite arbitrary files',
    requirement: 'Normalize/generated server-side names and reject traversal/path separator tricks.',
    why: 'Path traversal turns upload/extract features into arbitrary file write/read primitives.',
    applicability: 'Uploads, exports, archives, file download, generated artifacts.',
    verification: { type: 'automated_test', requiredTest: '../, absolute path, encoded traversal, separator variants', passCondition: 'All traversal attempts are rejected or safely normalized inside the allowed root.' },
    tags: ['files', 'path traversal', 'upload'], profiles: ['files', 'security'], pattern: /file|upload|download|archive|path|filename|export/i,
  }),
  criterion({
    id: 'FILES_CONTENT_TYPE', category: 'files', severity: 'high', minQuality: 'strict',
    title: 'Uploaded content is validated by actual allowed content/format rather than trusting the client filename or MIME header alone',
    requirement: 'Verify the accepted file type using server-side content parsing/signature rules appropriate to the feature.',
    why: 'Client-controlled extensions and MIME types are trivial to forge.',
    applicability: 'Images, documents, archives, executable-sensitive uploads.',
    verification: { type: 'automated_test', requiredTest: 'Extension/MIME/content mismatch cases', passCondition: 'Disallowed content cannot bypass file-type policy by renaming or MIME spoofing.' },
    tags: ['files', 'mime', 'upload'], profiles: ['files', 'security'], pattern: /upload|file|image|document|mime|content type/i,
  }),

  criterion({
    id: 'REALTIME_AUTH_FIRST_FRAME', category: 'realtime', severity: 'blocker', minQuality: 'critical',
    title: 'Realtime/WebSocket sessions authenticate before protected data is sent or mutations are accepted',
    requirement: 'Require authenticated first-frame/subprotocol/session semantics before board snapshots or commands are processed.',
    why: 'A socket that sends data before auth has already leaked it.',
    applicability: 'WebSocket, SSE with protected subscriptions, realtime sync.',
    verification: { type: 'automated_test', requiredTest: 'Unauthenticated socket connection and pre-auth mutation', passCondition: 'No protected snapshot or mutation is accepted before authentication.' },
    tags: ['realtime', 'websocket', 'auth'], profiles: ['realtime', 'security'], pattern: /websocket|ws|realtime|sync|socket/i,
  }),
  criterion({
    id: 'REALTIME_RECONNECT_RESYNC', category: 'realtime', severity: 'high', minQuality: 'strict',
    title: 'Reconnect performs authoritative resynchronization before replaying or accepting stale local mutations',
    requirement: 'Test disconnection during pending local changes and verify revision-aware recovery.',
    why: 'Reconnect is where duplicate events and stale revisions become real data-loss bugs.',
    applicability: 'Realtime CLI/board sync, live collaboration, long-lived sockets.',
    verification: { type: 'automated_test', requiredTest: 'Disconnect/reconnect with pending mutation', passCondition: 'Client returns to authoritative state without duplicate/lost updates.' },
    tags: ['realtime', 'reconnect', 'resync'], profiles: ['realtime', 'concurrency'], pattern: /websocket|reconnect|resync|sync|revision/i,
  }),

  criterion({
    id: 'DEPLOY_BUILD_CLEAN', category: 'deployment', severity: 'blocker', minQuality: 'standard',
    title: 'Production build, type checks, lint/static checks, and relevant native test suites pass from a clean checkout',
    requirement: 'Run the repository\'s real release commands rather than only a focused test file.',
    why: 'A local edited workspace can hide missing files, case mismatches, or uncommitted generated artifacts.',
    applicability: 'Every release-bound change.',
    verification: { type: 'build', passCondition: 'Required build/type/lint/native test commands complete successfully from the intended source tree.' },
    tags: ['deployment', 'build', 'lint', 'typecheck'], profiles: ['deployment', 'base'], pattern: /build|release|deploy|frontend|typescript|docker/i,
  }),
  criterion({
    id: 'DEPLOY_CASE_SENSITIVE_PATHS', category: 'deployment', severity: 'high', minQuality: 'strict',
    title: 'Tracked file/import casing is correct on case-sensitive filesystems and matches the release artifact',
    requirement: 'Validate exact Git path casing and case-sensitive imports.',
    why: 'Windows/macOS can hide casing defects that fail in Linux containers/CI.',
    applicability: 'Cross-platform repositories, Docker/Linux deployments, renamed files.',
    verification: { type: 'command', passCondition: 'Case-sensitive import/path checks pass and the exact tracked names match deployment expectations.' },
    tags: ['deployment', 'case', 'git', 'linux'], profiles: ['deployment'], pattern: /rename|dockerfile|import|case|linux|windows|git/i,
  }),
  criterion({
    id: 'DEPLOY_HEALTH_READINESS', category: 'deployment', severity: 'high', minQuality: 'strict',
    title: 'Deployment health/readiness checks prove the application can serve traffic after migrations and startup',
    requirement: 'Use a health/readiness path that reflects required dependencies without exposing secrets.',
    why: 'A process can be alive while the application is unusable.',
    applicability: 'Container/service deployment changes.',
    verification: { type: 'automated_test', requiredTest: 'Container/service smoke test', passCondition: 'Migrations/startup complete and readiness succeeds before traffic is considered safe.' },
    tags: ['deployment', 'health', 'readiness', 'docker'], profiles: ['deployment'], pattern: /docker|deploy|entrypoint|health|readiness|startup/i,
  }),

  criterion({
    id: 'SPEC_BEHAVIOR_SYNC', category: 'spec', severity: 'high', minQuality: 'standard',
    title: 'Behavioral specification is updated when the externally observable contract changes',
    requirement: 'Update the living spec/API documentation for changed behavior, states, fields, errors, or lifecycle rules.',
    why: 'Code-only contract changes create immediate future regressions and wrong agent assumptions.',
    applicability: 'Externally observable behavior or architecture changes; not every internal refactor.',
    verification: { type: 'manual', passCondition: 'Relevant specification describes the new observable behavior and does not document obsolete behavior.' },
    tags: ['spec', 'docs', 'contract'], profiles: ['spec', 'base'], pattern: /api|behavior|contract|state|lifecycle|schema|feature|spec/i,
    legacyTitles: ['ТЗ и архитектура: файл спецификации обновлен в openspec/ в репозитории'],
  }),
  criterion({
    id: 'SPEC_DTO_CONTRACTS', category: 'spec', severity: 'high', minQuality: 'strict',
    title: 'Request/response DTOs and shared types match the implemented contract without unsafe any-shaped escape hatches',
    requirement: 'Keep typed schemas aligned across backend/frontend boundaries and avoid replacing contract types with broad any/dict solely to silence checks.',
    why: 'Weak types conceal contract drift until runtime.',
    applicability: 'API DTO, WebSocket events, generated/shared client contracts.',
    verification: { type: 'build', passCondition: 'Strict type/schema checks pass and representative runtime contract tests cover changed fields.' },
    tags: ['spec', 'dto', 'typescript', 'pydantic'], profiles: ['spec', 'api'], pattern: /dto|schema|type|typescript|pydantic|response|request/i,
    legacyTitles: ['ТЗ: строгие DTO-типы запроса и ответа (TypeScript interfaces / Zod / Pydantic)'],
  }),
  criterion({
    id: 'SPEC_ERROR_CONTRACT', category: 'spec', severity: 'normal', minQuality: 'strict',
    title: 'New failure modes have stable documented error semantics for callers and operators',
    requirement: 'Document and test the relevant error code/status/body semantics without inventing a status code contrary to existing project policy.',
    why: 'Unspecified failures lead each client/agent to guess recovery behavior.',
    applicability: 'New API failure modes, provider failures, validation errors, conflict/retry behavior.',
    verification: { type: 'automated_test', requiredTest: 'Representative error-contract tests', passCondition: 'Runtime behavior and documentation agree.' },
    tags: ['spec', 'error', 'api'], profiles: ['spec', 'api'], pattern: /error|failure|status|code|api|conflict/i,
    legacyTitles: ['ТЗ: задокументированы все коды ошибок и форматы ответов (400, 401, 403, 404, 422, 500)'],
  }),
];

// Additional focused criteria keep the catalog broad without making every ticket carry every rule.
const EXTRA_CRITERIA: DoDItem[] = [
  ['AUTH_SESSION_FIXATION','auth','blocker','Session/login transitions rotate or invalidate credentials when privilege context changes','Authentication state changes cannot reuse an attacker-controlled or stale privileged session.','auth login session oauth','auth'],
  ['AUTH_LOGOUT_REVOKE','auth','high','Logout/revoke invalidates the intended server-side credential and protected requests fail afterward','Revocation is observable by the next protected operation.','logout revoke session token','auth'],
  ['AUTH_PASSWORD_RESET','auth','blocker','Password/reset/recovery tokens are single-purpose, time-bounded, and cannot be replayed after use','Recovery links are high-value bearer credentials.','password reset recovery token','auth'],
  ['API_PAGINATION_BOUNDS','api','normal','Pagination and list limits have safe defaults and hard upper bounds','Unbounded list queries create accidental denial of service.','pagination page limit list','api'],
  ['API_SORT_ALLOWLIST','api','high','Client-controlled sort/filter fields are allowlisted and cannot select arbitrary SQL/ORM expressions','Dynamic field selection is an injection and performance boundary.','sort order filter query','api'],
  ['DB_FK_REFERENTIAL','database','high','Foreign-key relationships prevent orphaned records where lifecycle semantics require ownership','Application cleanup alone is not enough for referential integrity.','foreign key relation orphan delete','database'],
  ['DB_MONEY_INTEGER','database','blocker','Money amounts use exact integer-minor-unit or exact decimal semantics with explicit currency','Binary floating point is unsafe for financial accounting.','money amount currency decimal price','billing'],
  ['DB_TIMEZONE','database','high','Persisted timestamps use a single explicit timezone convention and comparisons remain unambiguous','Mixed naive/aware time breaks expiry and ordering logic.','time timestamp timezone expiry date','database'],
  ['CONCURRENCY_LOCK_SCOPE','concurrency','high','Locking/serialization scope matches the business invariant without globally blocking unrelated tenants','Too-narrow locks race; too-broad locks create availability problems.','lock mutex serialize tenant race','concurrency'],
  ['INTEGRATION_TLS_URL','integration','blocker','Security-sensitive provider callbacks and confirmation/navigation URLs satisfy the expected HTTPS/origin policy','Unvalidated provider URLs can downgrade transport or redirect users unsafely.','https url redirect confirmation callback','integration'],
  ['INTEGRATION_RESPONSE_ID','integration','blocker','Provider success requires a non-empty stable provider operation identifier before local success is accepted','Without provider identity, reconciliation and idempotency are impossible.','provider id payment id response external','integration'],
  ['BILLING_ENTITLEMENT_ATOMIC','billing','blocker','Paid entitlement changes are atomic with verified payment state and cannot be granted on pending/canceled/mismatched transactions','Access must reflect verified money state.','payment entitlement subscription access status','billing'],
  ['BILLING_DUPLICATE_WEBHOOK','billing','blocker','Duplicate payment/refund webhooks do not extend access, issue receipts, or apply refunds twice','Providers retry webhook delivery.','payment webhook duplicate refund receipt','billing'],
  ['BILLING_OUT_OF_ORDER_STATUS','billing','blocker','Payment lifecycle cannot regress when older provider events arrive after a final/newer state','Arrival order is not authoritative lifecycle order.','payment status canceled succeeded webhook order','billing'],
  ['PRIVACY_THIRD_PARTY_FLOW','privacy','blocker','New third-party data flows are explicit, configurable where required, and transmit only the documented minimal payload','Integrations and AI providers create separate data recipients.','ai github telegram third party integration pii','privacy'],
  ['PRIVACY_BROWSER_STORAGE','privacy','high','Sensitive or visitor-provided data is not persisted in browser storage longer or more broadly than necessary','localStorage is long-lived and accessible to page JavaScript.','localstorage sessionstorage browser contact token','privacy'],
  ['JOB_CRASH_RECOVERY','background_job','high','Worker restart after a crash resumes or safely reconciles in-flight durable work','Process memory is not a durable job ledger.','worker crash restart recovery job queue','background_job'],
  ['FILES_ARCHIVE_BOMB','files','high','Archive extraction has bounded file count, expansion size, nesting, and traversal protections','Compressed archives can amplify tiny uploads into resource exhaustion.','archive zip extract bomb upload','files'],
  ['REALTIME_EVENT_ID_UNIQUE','realtime','blocker','Realtime mutation event IDs are durably unique in the correct project/tenant scope','Reconnect and retries can replay the same event.','websocket event id duplicate project revision','realtime'],
  ['REALTIME_AUTHZ_MUTATION','realtime','blocker','Realtime mutations enforce the same authorization rules as equivalent REST operations','WebSocket paths must not become a weaker authorization backdoor.','websocket mutation authorization role project','realtime'],
  ['DEPLOY_MIGRATION_BEFORE_TRAFFIC','deployment','blocker','Required schema migrations complete successfully before application instances serve code that depends on them','Mixed schema/code versions create production-only failures.','deploy migration startup entrypoint traffic','deployment'],
  ['DEPLOY_NO_CREATE_ALL','deployment','high','Production startup does not silently mutate schema outside the migration system','Ad-hoc create_all/ALTER logic bypasses migration review and reproducibility.','create_all alter table startup migration','deployment'],
  ['PERF_BOUNDED_RETRY','backend_perf','high','Retry loops use bounded attempts/backoff and respect operation idempotency','Infinite or synchronized retries amplify outages.','retry backoff timeout performance','performance'],
  ['PERF_QUERY_LIMIT','backend_perf','normal','Expensive list/search operations have bounded result sizes and avoid accidental full-table scans','Correctness tests do not reveal runaway production query cost.','search list filter query limit performance','performance'],
].map(([id, category, severity, title, why, patternText, profile]) => criterion({
  id: String(id),
  category: category as DoDCategory,
  severity: severity as DoDSeverity,
  title: String(title),
  requirement: String(title),
  why: String(why),
  applicability: `Apply when the ticket involves ${String(patternText)}.`,
  verification: { type: 'automated_test', requiredTest: `A focused test for ${String(id)}`, passCondition: String(title) },
  tags: String(patternText).split(/\s+/),
  profiles: [String(profile)],
  minQuality: severity === 'blocker' ? 'critical' : severity === 'high' ? 'strict' : 'standard',
  pattern: new RegExp(String(patternText).split(/\s+/).join('|'), 'i'),
}));

GOLDEN_DOD_CATALOG.push(...EXTRA_CRITERIA);

export const PREPACKAGED_DOD_PRESETS: DoDPreset[] = [
  { id: 'preset_base', title: '🧱 Baseline Engineering', description: 'Root cause, regression proof, adjacent safety, and release checks.', icon: '🧱', quality: 'standard', checkIds: ['BASE_ROOT_CAUSE','BASE_REGRESSION_TEST','DEPLOY_BUILD_CLEAN'] },
  { id: 'preset_bug_fix_regression', title: '🐛 Bug Fix & Regression', description: 'Reproduce → fix root cause → prove regression and adjacent behavior.', icon: '🧪', quality: 'strict', checkIds: ['BASE_ROOT_CAUSE','BASE_REGRESSION_TEST','BASE_ADJACENT_REGRESSION','BASE_NO_SILENT_FAILURE','DEPLOY_BUILD_CLEAN','SPEC_BEHAVIOR_SYNC'] },
  { id: 'preset_api_endpoint', title: '⚡ API Endpoint', description: 'Strict request/response contracts, auth boundaries, validation, and mutation safety.', icon: '⚙️', quality: 'strict', checkIds: ['SEC_UNAUTHENTICATED','SEC_CROSS_TENANT','API_STRICT_REQUEST_SCHEMA','API_RESPONSE_CONTRACT','BOUNDARY_REQUIRED_FIELDS','BOUNDARY_MIN_MAX_VALID','BOUNDARY_OUTSIDE_RANGE','SPEC_DTO_CONTRACTS','SPEC_ERROR_CONTRACT'] },
  { id: 'preset_auth_security', title: '🔐 Authentication & Authorization', description: 'Credential, role, cross-tenant, revocation, and secret-storage hardening.', icon: '🔐', quality: 'critical', checkIds: ['SEC_UNAUTHENTICATED','SEC_INVALID_CREDENTIAL','SEC_CROSS_TENANT','SEC_CAPABILITY_SCOPE','SEC_SECRET_STORAGE','AUTH_SESSION_FIXATION','AUTH_LOGOUT_REVOKE'] },
  { id: 'preset_database', title: '🗄️ Database & Persistent Invariants', description: 'Database constraints, atomicity, uniqueness, referential integrity, and indexes.', icon: '🗄️', quality: 'critical', checkIds: ['DB_CONSTRAINT_CRITICAL_INVARIANT','DB_UNIQUENESS','DB_TRANSACTION_ATOMICITY','DB_FK_REFERENTIAL','DB_INDEX_QUERY_PATH'] },
  { id: 'preset_migration', title: '🧬 Schema Migration', description: 'Forward-only history, blank→head, previous→head, single head, legacy data.', icon: '🧬', quality: 'critical', checkIds: ['MIGRATION_FORWARD_ONLY','MIGRATION_BLANK_TO_HEAD','MIGRATION_PREVIOUS_TO_HEAD','MIGRATION_SINGLE_HEAD','DB_CONSTRAINT_CRITICAL_INVARIANT'] },
  { id: 'preset_concurrency', title: '⚔️ Concurrency & Atomicity', description: 'Duplicate requests, stale writers, lock scope, and side-effect ordering.', icon: '⚔️', quality: 'critical', checkIds: ['CONCURRENCY_DUPLICATE_REQUEST','CONCURRENCY_STALE_REVISION','CONCURRENCY_SIDE_EFFECT_ORDER','CONCURRENCY_LOCK_SCOPE','DB_UNIQUENESS','DB_TRANSACTION_ATOMICITY'] },
  { id: 'preset_external_integration', title: '🌐 External API / Webhook', description: 'Timeouts, malformed 2xx, provider errors, authenticity, replay, and ordering.', icon: '🌐', quality: 'critical', checkIds: ['INTEGRATION_TIMEOUT','INTEGRATION_MALFORMED_2XX','INTEGRATION_4XX_5XX','INTEGRATION_WEBHOOK_AUTHENTICITY','INTEGRATION_EVENT_REPLAY','INTEGRATION_OUT_OF_ORDER','INTEGRATION_RESPONSE_ID'] },
  { id: 'preset_billing_transaction', title: '💳 Billing / Payments / Refunds', description: 'Critical money ledger, idempotency, provider verification, refunds, fiscal separation.', icon: '💳', quality: 'critical', checkIds: ['BILLING_DURABLE_LEDGER','BILLING_AMOUNT_CURRENCY','API_MUTATION_IDEMPOTENCY','INTEGRATION_MALFORMED_2XX','INTEGRATION_WEBHOOK_AUTHENTICITY','INTEGRATION_EVENT_REPLAY','INTEGRATION_OUT_OF_ORDER','BILLING_ENTITLEMENT_ATOMIC','BILLING_REFUND_LEDGER','BILLING_NO_AUTOMATIC_FISCAL_CLAIM','BILLING_BUYER_SNAPSHOT','DB_TRANSACTION_ATOMICITY'] },
  { id: 'preset_ui_component', title: '🎨 UI Component / Screen', description: 'Loading, errors, empty state, responsive behavior, keyboard, Unicode.', icon: '🎨', quality: 'strict', checkIds: ['UI_LOADING_STATE','UI_ERROR_RECOVERY','UI_EMPTY_STATE','UI_RESPONSIVE','UI_KEYBOARD_A11Y','BOUNDARY_UNICODE'] },
  { id: 'preset_privacy', title: '🛡️ Privacy / Personal Data', description: 'Data minimization, leakage prevention, browser storage, deletion, third-party flow.', icon: '🛡️', quality: 'critical', checkIds: ['PRIVACY_DATA_MINIMIZATION','PRIVACY_NO_SECRET_URL_LOG','PRIVACY_BROWSER_STORAGE','PRIVACY_THIRD_PARTY_FLOW','PRIVACY_DELETION_SEMANTICS'] },
  { id: 'preset_background_job', title: '🕒 Background Job / Queue', description: 'Retry idempotency, poison jobs, crash recovery, duplicate events.', icon: '🕒', quality: 'critical', checkIds: ['JOB_RETRY_IDEMPOTENT','JOB_POISON_FAILURE','JOB_CRASH_RECOVERY','INTEGRATION_EVENT_REPLAY','CONCURRENCY_SIDE_EFFECT_ORDER'] },
  { id: 'preset_files_upload', title: '📦 Files / Upload / Archive', description: 'Payload bounds, traversal, content validation, archive bombs.', icon: '📦', quality: 'critical', checkIds: ['BOUNDARY_LARGE_PAYLOAD','FILES_PATH_TRAVERSAL','FILES_CONTENT_TYPE','FILES_ARCHIVE_BOMB','PRIVACY_DATA_MINIMIZATION'] },
  { id: 'preset_realtime', title: '🔄 WebSocket / Realtime Sync', description: 'Pre-auth safety, authorization, revisions, event replay, reconnect.', icon: '🔄', quality: 'critical', checkIds: ['REALTIME_AUTH_FIRST_FRAME','REALTIME_AUTHZ_MUTATION','REALTIME_EVENT_ID_UNIQUE','REALTIME_RECONNECT_RESYNC','CONCURRENCY_STALE_REVISION','SEC_CROSS_TENANT'] },
  { id: 'preset_deployment', title: '🚀 Deployment / Release', description: 'Clean build, exact casing, migrations, readiness, production startup discipline.', icon: '🚀', quality: 'strict', checkIds: ['DEPLOY_BUILD_CLEAN','DEPLOY_CASE_SENSITIVE_PATHS','DEPLOY_MIGRATION_BEFORE_TRAFFIC','DEPLOY_NO_CREATE_ALL','DEPLOY_HEALTH_READINESS'] },
  { id: 'preset_fullstack_feature', title: '✨ Full-Stack Feature', description: 'Balanced strict contract for a feature crossing UI, API, persistence, and spec.', icon: '✨', quality: 'strict', checkIds: ['BASE_REGRESSION_TEST','API_STRICT_REQUEST_SCHEMA','SEC_CROSS_TENANT','BOUNDARY_REQUIRED_FIELDS','UI_LOADING_STATE','UI_ERROR_RECOVERY','DB_TRANSACTION_ATOMICITY','SPEC_BEHAVIOR_SYNC','DEPLOY_BUILD_CLEAN'] },
];

const LOCAL_STORAGE_CUSTOM_CHECKS_KEY = 'vibus_custom_dod_catalog_v2';

export function getCustomChecks(): DoDItem[] {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_CUSTOM_CHECKS_KEY) || localStorage.getItem('vibus_custom_dod_catalog_v1');
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((item: Partial<DoDItem>) => criterion({
      id: item.id || `CUSTOM_${Date.now()}`,
      category: item.category || 'regression',
      severity: item.severity || 'normal',
      title: item.title || 'Custom criterion',
      description: item.description,
      requirement: item.requirement || item.title || 'Custom criterion',
      why: item.why || 'User-defined project requirement.',
      applicability: item.applicability || 'When explicitly selected by the user.',
      verification: item.verification || { type: 'manual', passCondition: 'User-defined criterion is demonstrably satisfied.' },
      negativeCase: item.negativeCase,
      positiveControl: item.positiveControl,
      requiredArtifacts: item.requiredArtifacts,
      forbiddenShortcuts: item.forbiddenShortcuts,
      tags: item.tags || ['custom'],
      profiles: item.profiles || ['custom'],
      minQuality: item.minQuality || 'standard',
      legacyTitles: item.legacyTitles,
    }));
  } catch (e) {
    console.warn('Failed to load custom DoD checks from localStorage:', e);
    return [];
  }
}

export function saveCustomCheck(check: Pick<DoDItem, 'title' | 'category' | 'tags'> & Partial<DoDItem>): DoDItem {
  const customChecks = getCustomChecks();
  const created = criterion({
    id: check.id || `CUSTOM_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    category: check.category,
    severity: check.severity || 'normal',
    title: check.title,
    description: check.description,
    requirement: check.requirement || check.title,
    why: check.why || 'User-defined project requirement.',
    applicability: check.applicability || 'When explicitly selected by the user.',
    verification: check.verification || { type: 'manual', passCondition: 'The criterion is demonstrably satisfied.' },
    negativeCase: check.negativeCase,
    positiveControl: check.positiveControl,
    requiredArtifacts: check.requiredArtifacts,
    forbiddenShortcuts: check.forbiddenShortcuts,
    tags: check.tags,
    profiles: check.profiles || ['custom'],
    minQuality: check.minQuality || 'standard',
    pattern: check.pattern,
    legacyTitles: check.legacyTitles,
  });
  customChecks.push(created);
  try { localStorage.setItem(LOCAL_STORAGE_CUSTOM_CHECKS_KEY, JSON.stringify(customChecks)); } catch (e) { console.error('Failed to save custom DoD check:', e); }
  return created;
}

export function deleteCustomCheck(id: string): void {
  try {
    const filtered = getCustomChecks().filter(c => c.id !== id);
    localStorage.setItem(LOCAL_STORAGE_CUSTOM_CHECKS_KEY, JSON.stringify(filtered));
  } catch (e) {
    console.error('Failed to delete custom DoD check:', e);
  }
}

export function getAllAvailableChecks(): DoDItem[] {
  return [...GOLDEN_DOD_CATALOG, ...getCustomChecks()];
}


export function toPersistedCriterion(item: DoDItem): Omit<DoDItem, 'pattern'> {
  const { pattern: _pattern, ...persisted } = item;
  return persisted;
}

export function findDoDItem(titleOrId: string): DoDItem | undefined {
  const needle = titleOrId.trim().toLowerCase();
  return getAllAvailableChecks().find(item =>
    item.id.toLowerCase() === needle ||
    item.title.trim().toLowerCase() === needle ||
    (item.legacyTitles || []).some(title => title.trim().toLowerCase() === needle)
  );
}

export function getPresetById(id: string): DoDPreset | undefined {
  return PREPACKAGED_DOD_PRESETS.find(preset => preset.id === id);
}

const LOCAL_STORAGE_QUALITY_MODE_KEY = 'vibus_engineering_quality_mode_v2';

export function getEngineeringQualityMode(): EngineeringQualityMode {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_QUALITY_MODE_KEY);
    if (raw === 'standard' || raw === 'strict' || raw === 'critical') return raw;
  } catch (_) {}
  return 'strict';
}

export function setEngineeringQualityMode(mode: EngineeringQualityMode): void {
  try { localStorage.setItem(LOCAL_STORAGE_QUALITY_MODE_KEY, mode); } catch (_) {}
}

export function isCriterionIncludedForQuality(item: DoDItem, mode: EngineeringQualityMode): boolean {
  const weight: Record<EngineeringQualityMode, number> = { standard: 1, strict: 2, critical: 3 };
  return weight[item.minQuality] <= weight[mode];
}
