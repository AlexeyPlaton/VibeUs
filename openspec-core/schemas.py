from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from typing import Optional, List, Dict, Any, Literal
from datetime import datetime
from enum import Enum

from legal_acceptance_context import set_pending_legal_acceptance

class RoleEnum(str, Enum):
    owner = "owner"
    admin = "admin"
    member = "member"
    viewer = "viewer"
    reviewer = "reviewer"
    team = "team"
    tester = "tester"

class TtlEnum(str, Enum):
    d1 = "24h"
    d7 = "7d"
    d30 = "30d"
    forever = "forever"

class StatusEnum(str, Enum):
    backlog = "backlog"
    in_progress = "in_progress"
    review = "review"
    done = "done"
    new = "new"
    pending = "pending"
    succeeded = "succeeded"
    canceled = "canceled"

class TicketStatusEnum(str, Enum):
    backlog = "backlog"
    in_progress = "in_progress"
    review = "review"
    done = "done"

class PriorityEnum(str, Enum):
    critical = "critical"
    high = "high"
    medium = "medium"
    low = "low"

class TicketPriorityEnum(str, Enum):
    low = "low"
    medium = "medium"
    high = "high"

class TierEnum(str, Enum):
    free = "free"
    solo = "solo"
    studio = "studio"
    business = "business"
    pro = "pro"

class BillingTierEnum(str, Enum):
    solo = "solo"
    studio = "studio"

class StrictBaseModel(BaseModel):
    model_config = ConfigDict(extra="forbid", from_attributes=True)

class UserCreate(StrictBaseModel):
    email: str = Field(..., min_length=5, max_length=254, pattern=r"^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+$")
    password: str = Field(..., min_length=12, max_length=128)
    legal_locale: Literal["en", "ru"]
    accept_terms: bool
    acknowledge_privacy: bool
    consent_personal_data: bool = False
    terms_version: str = Field(..., min_length=1, max_length=32)
    privacy_version: str = Field(..., min_length=1, max_length=32)
    personal_data_consent_version: Optional[str] = Field(default=None, min_length=1, max_length=32)

    @model_validator(mode="after")
    def check_legal_acceptance(self) -> "UserCreate":
        if not self.accept_terms:
            raise ValueError("Acceptance of terms is required")
        if not self.acknowledge_privacy:
            raise ValueError("Privacy Policy acknowledgement is required")
        if self.legal_locale == "ru":
            if not self.consent_personal_data:
                raise ValueError("Separate personal-data consent is required for the Russian legal flow")
            if not self.personal_data_consent_version:
                raise ValueError("personal_data_consent_version is required for the Russian legal flow")
        elif self.consent_personal_data or self.personal_data_consent_version:
            raise ValueError("Personal-data consent is not accepted as the legal basis for the English account flow")

        set_pending_legal_acceptance({
            "email": self.email,
            "legal_locale": self.legal_locale,
            "terms_version": self.terms_version,
            "privacy_version": self.privacy_version,
            "consent_personal_data": self.consent_personal_data,
            "personal_data_consent_version": self.personal_data_consent_version,
        })
        return self

    @field_validator("email", mode="before")
    @classmethod
    def normalize_email(cls, v: Any) -> str:
        if isinstance(v, str):
            return v.strip().lower()
        return v

    @field_validator("password")
    @classmethod
    def validate_password(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("Password cannot be blank or whitespace only")
        return v

    @field_validator("accept_terms")
    @classmethod
    def require_terms(cls, v: bool) -> bool:
        if v is not True:
            raise ValueError("Terms must be accepted to create an account")
        return v

    @field_validator("acknowledge_privacy")
    @classmethod
    def require_privacy_acknowledgement(cls, v: bool) -> bool:
        if v is not True:
            raise ValueError("Privacy Policy must be acknowledged to create an account")
        return v

class UserLogin(StrictBaseModel):
    email: str
    password: str

    @field_validator("email", mode="before")
    @classmethod
    def normalize_email(cls, v: Any) -> str:
        return v.strip().lower() if isinstance(v, str) else v

class UserResponse(StrictBaseModel):
    id: str
    email: str
    is_active: bool
    created_at: datetime

class TokenResponse(StrictBaseModel):
    access_token: str
    token_type: str = 'bearer'

class WorkspaceCreate(StrictBaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    first_touch_source: Optional[str] = Field(default=None, max_length=128)

    @field_validator("name")
    @classmethod
    def validate_name(cls, v: str) -> str:
        s = v.strip()
        if not s:
            raise ValueError("Workspace name cannot be blank")
        return v

class WorkspaceResponse(StrictBaseModel):
    id: str
    name: str
    owner_email: str
    subscription_tier: TierEnum
    subscription_status: str = "inactive"
    current_period_start: Optional[datetime] = None
    current_period_end: Optional[datetime] = None
    cancel_at_period_end: bool = False
    tickets_used_this_month: int
    is_lifetime_free: bool = False
    promo_code_used: Optional[str] = None
    first_touch_source: Optional[str] = None
    first_touch_at: Optional[datetime] = None
    created_at: datetime

class AccessLinkRoleEnum(str, Enum):
    reviewer = "reviewer"
    tester = "tester"
    team = "team"

class AccessLinkCreate(StrictBaseModel):
    label: Optional[str] = ''
    role: AccessLinkRoleEnum = AccessLinkRoleEnum.reviewer
    ttl: TtlEnum = TtlEnum.d7
    single_use: bool = False

class AccessLinkResponse(StrictBaseModel):
    id: str
    project_id: str
    token: str
    label: str
    role: AccessLinkRoleEnum
    ttl: TtlEnum
    single_use: bool
    is_activated: bool
    expires_at: Optional[datetime] = None
    created_at: datetime

class AccessLinkListItemResponse(StrictBaseModel):
    id: str
    project_id: str
    label: str
    role: AccessLinkRoleEnum
    ttl: TtlEnum
    single_use: bool
    is_activated: bool
    expires_at: Optional[datetime] = None
    created_at: datetime

class AccessLinkVerifyRequest(StrictBaseModel):
    token: str
    fingerprint: Optional[str] = None

class AccessLinkVerifyResponse(StrictBaseModel):
    valid: bool
    role: Optional[AccessLinkRoleEnum] = None
    project_slug: Optional[str] = None
    access_token: Optional[str] = None
    error: Optional[str] = None

class PreviewSessionExchangeRequest(StrictBaseModel):
    tunnel_id: str = Field(..., min_length=8, max_length=128)
    token: str = Field(..., min_length=16, max_length=512)
    fingerprint: Optional[str] = Field(default=None, max_length=128)

class PreviewSessionExchangeResponse(StrictBaseModel):
    ok: bool = True
    project_slug: str
    role: AccessLinkRoleEnum
    expires_at: datetime

class RedeemPromoRequest(StrictBaseModel):
    code: str = Field(..., min_length=3, max_length=128)

class RedeemPromoResponse(WorkspaceResponse):
    promo_campaign: Optional[str] = None
    promo_duration_days: Optional[int] = None

class CreateCheckoutRequest(StrictBaseModel):
    workspace_id: str
    tier: BillingTierEnum = BillingTierEnum.solo
    success_url: Optional[str] = 'http://localhost:8000/billing/success?session_id={CHECKOUT_SESSION_ID}'
    cancel_url: Optional[str] = 'http://localhost:8000/billing/cancel'

class CreatePortalRequest(StrictBaseModel):
    workspace_id: str
    return_url: Optional[str] = 'http://localhost:8000'

class CreateYookassaPaymentRequest(StrictBaseModel):
    workspace_id: str
    tier: BillingTierEnum = BillingTierEnum.solo
    return_url: Optional[str] = 'http://localhost:8000/billing/success'
    is_b2b: Optional[bool] = False
    company_inn: Optional[str] = None
    company_name: Optional[str] = None

    @model_validator(mode="after")
    def validate_b2b_fields(self):
        if self.is_b2b:
            inn = (self.company_inn or "").strip()
            name = (self.company_name or "").strip()
            if not inn or not name:
                raise ValueError("B2B requests require non-empty company_inn and company_name")
        return self

class PaymentResponse(StrictBaseModel):
    id: str
    provider: str
    provider_payment_id: str
    workspace_id: str
    plan: str
    amount_minor: int
    currency: str
    status: str
    tax_mode: str
    fiscal_status: str
    receipt_url: Optional[str] = None
    receipt_issued_at: Optional[datetime] = None
    buyer_email: Optional[str] = None
    buyer_is_b2b: bool = False
    buyer_inn: Optional[str] = None
    buyer_name: Optional[str] = None
    buyer_snapshot_verified: bool = False
    entitlement_period_start: Optional[datetime] = None
    entitlement_period_end: Optional[datetime] = None
    created_at: datetime

class ProjectCreate(StrictBaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    slug: str = Field(..., min_length=3, max_length=63, pattern=r"^[a-z0-9]+(-[a-z0-9]+)*$")
    description: str = ''
    workspace_id: str
    public_widget_origins: Optional[list[str]] = None

    @field_validator("name")
    @classmethod
    def validate_name(cls, v: str) -> str:
        s = v.strip()
        if not s:
            raise ValueError("Project name cannot be blank")
        return v

class ProjectResponse(StrictBaseModel):
    id: str
    workspace_id: Optional[str] = None
    name: str
    slug: str
    description: str
    telemetry_enabled: bool = False
    ai_data_sharing: bool = False
    runtime_error_tracking_enabled: bool = False
    columns: list[dict] = Field(default_factory=list)
    created_at: datetime

class FeedbackCategoryEnum(str, Enum):
    bug = "bug"
    idea = "idea"
    praise = "praise"
    question = "question"

class ProjectCreateResponse(ProjectResponse):
    token: str = ''
    public_widget_key: str = ''
    ingest_key: str = ''

class WorkspaceSummaryResponse(WorkspaceResponse):
    effective_tier: TierEnum = TierEnum.free
    project_count: int = 0
    project_limit: int = 1

class ProjectDashboardItem(StrictBaseModel):
    id: str
    workspace_id: str
    name: str
    slug: str
    description: str = ''
    public_widget_key: Optional[str] = None
    ingest_key_configured: bool = False
    api_token_configured: bool = True
    telemetry_enabled: bool = False
    ai_data_sharing: bool = False
    runtime_error_tracking_enabled: bool = False
    created_at: datetime

class RotateApiTokenResponse(StrictBaseModel):
    token: str

class RotatePublicWidgetKeyResponse(StrictBaseModel):
    public_widget_key: str

class RotateIngestKeyResponse(StrictBaseModel):
    ingest_key: str

class RuntimeErrorTrackingSettingsUpdate(StrictBaseModel):
    runtime_error_tracking_enabled: bool

class FeedbackCreate(StrictBaseModel):
    text: str = Field(..., min_length=1, max_length=10000)
    author: Optional[str] = Field(default='Посетитель', max_length=80)
    contact: Optional[str] = Field(default='', max_length=254)
    quote: Optional[str] = Field(default='', max_length=2000)
    category: Optional[FeedbackCategoryEnum] = FeedbackCategoryEnum.idea
    request_id: Optional[str] = Field(default=None, max_length=64, pattern=r"^[A-Za-z0-9_.:-]+$")

    @field_validator("text")
    @classmethod
    def validate_text(cls, v: str) -> str:
        s = v.strip()
        if not s:
            raise ValueError("Feedback text cannot be blank")
        return v

class TicketCreate(StrictBaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    summary: str = Field(default='', max_length=50000)
    source_quote: str = ''
    status: TicketStatusEnum = TicketStatusEnum.backlog
    priority: TicketPriorityEnum = TicketPriorityEnum.medium
    checklists: dict = Field(default_factory=dict)
    criteria_contract: dict = Field(default_factory=dict)
    quality_mode: str = Field(default='strict', pattern=r'^(standard|strict|critical)$')
    rework_notes: str = ''
    comments: list[dict] = Field(default_factory=list)
    bug_context: dict = Field(default_factory=dict)
    key: Optional[str] = None

    @field_validator("title")
    @classmethod
    def validate_title(cls, v: str) -> str:
        s = v.strip()
        if not s:
            raise ValueError("Ticket title cannot be blank")
        return v

    @field_validator("checklists")
    @classmethod
    def validate_checklists(cls, v: dict) -> dict:
        if len(v) > 100:
            raise ValueError("Checklists cannot have more than 100 items")
        return v

    @field_validator("criteria_contract")
    @classmethod
    def validate_criteria_contract(cls, v: dict) -> dict:
        if len(v) > 100:
            raise ValueError("Criteria contract cannot have more than 100 items")
        for key, item in v.items():
            if not isinstance(key, str) or not key.strip() or len(key) > 500:
                raise ValueError("Invalid criterion key")
            if not isinstance(item, dict):
                raise ValueError("Each criterion contract item must be an object")
        return v

class TicketUpdate(StrictBaseModel):
    title: Optional[str] = Field(default=None, min_length=1, max_length=200)
    summary: Optional[str] = Field(default=None, max_length=50000)
    source_quote: Optional[str] = None
    status: Optional[TicketStatusEnum] = None
    priority: Optional[TicketPriorityEnum] = None
    assignee: Optional[str] = None
    node_id: Optional[str] = None
    checklists: Optional[dict] = None
    criteria_contract: Optional[dict] = None
    quality_mode: Optional[str] = Field(default=None, pattern=r'^(standard|strict|critical)$')
    rework_notes: Optional[str] = None
    comments: Optional[list[dict]] = None
    order: Optional[int] = None
    is_archived: Optional[bool] = None
    bug_context: Optional[dict] = None
    github_issue_url: Optional[str] = None
    github_issue_number: Optional[int] = None

    @field_validator("criteria_contract")
    @classmethod
    def validate_optional_criteria_contract(cls, v: Optional[dict]) -> Optional[dict]:
        if v is None:
            return v
        if len(v) > 100:
            raise ValueError("Criteria contract cannot have more than 100 items")
        for key, item in v.items():
            if not isinstance(key, str) or not key.strip() or len(key) > 500:
                raise ValueError("Invalid criterion key")
            if not isinstance(item, dict):
                raise ValueError("Each criterion contract item must be an object")
        return v

    @field_validator("title")
    @classmethod
    def validate_title(cls, v: Optional[str]) -> Optional[str]:
        if v is not None:
            s = v.strip()
            if not s:
                raise ValueError("Ticket title cannot be blank")
        return v

    @field_validator("checklists")
    @classmethod
    def validate_checklists(cls, v: Optional[dict]) -> Optional[dict]:
        if v is not None and len(v) > 100:
            raise ValueError("Checklists cannot have more than 100 items")
        return v

class TicketReviewActionRequest(StrictBaseModel):
    action: Literal["accept", "rework"]
    rework_notes: str = Field(default="", max_length=10000)

    @model_validator(mode="after")
    def validate_review_action(self):
        if self.action == "rework" and not self.rework_notes.strip():
            raise ValueError("rework_notes is required for rework action")
        return self

class NodeCreate(StrictBaseModel):
    title: str = Field(..., min_length=1, max_length=120)
    description: str = ''
    parent_id: Optional[str] = None
    content_markdown: str = ''
    discussions: list[dict] = Field(default_factory=list)

    @field_validator("title")
    @classmethod
    def validate_title(cls, v: str) -> str:
        s = v.strip()
        if not s:
            raise ValueError("Node title cannot be blank")
        return v

class NodeUpdate(StrictBaseModel):
    title: Optional[str] = Field(default=None, min_length=1, max_length=120)
    description: Optional[str] = None
    parent_id: Optional[str] = None
    content_markdown: Optional[str] = None
    discussions: Optional[list[dict]] = None
    is_deleted: Optional[bool] = None

    @field_validator("title")
    @classmethod
    def validate_title(cls, v: Optional[str]) -> Optional[str]:
        if v is not None:
            s = v.strip()
            if not s:
                raise ValueError("Node title cannot be blank")
        return v

class TicketResponse(StrictBaseModel):
    id: str
    key: Optional[str] = None
    node_id: Optional[str] = None
    title: str
    summary: str
    source_quote: str = ''
    assignee: str = ''
    status: TicketStatusEnum
    priority: TicketPriorityEnum
    order: int
    checklists: dict = Field(default_factory=dict)
    criteria_contract: dict = Field(default_factory=dict)
    criteria_evidence: dict = Field(default_factory=dict)
    quality_mode: str = 'strict'
    rework_notes: str = ''
    bug_context: dict = Field(default_factory=dict)
    is_archived: bool = False
    revision: int = 0
    github_issue_url: Optional[str] = None
    github_issue_number: Optional[int] = None
    comments: list[dict] = Field(default_factory=list)
    created_at: datetime

class NodeResponse(StrictBaseModel):
    id: str
    title: str
    description: str
    parent_id: Optional[str] = None
    content_markdown: str = ''
    discussions: list[dict] = Field(default_factory=list)
    tickets: list[TicketResponse] = Field(default_factory=list)

class BoardResponse(StrictBaseModel):
    project_id: str
    revision: int = 0
    subscription_tier: TierEnum = TierEnum.free
    columns: list[dict] = Field(default_factory=list)
    custom_roles: list[dict] = Field(default_factory=list)
    custom_boards: list[dict] = Field(default_factory=list)
    group_chat: dict = Field(default_factory=dict)
    subscribers: list[dict] = Field(default_factory=list)
    telemetry_enabled: bool = False
    ai_data_sharing: bool = False
    nodes: list[NodeResponse] = Field(default_factory=list)
    feedbacks: list[dict] = Field(default_factory=list)

class TicketMoveRequest(StrictBaseModel):
    node_id: str
    order: Optional[int] = 0

class TicketBatchRequest(StrictBaseModel):
    operation: str

class ProjectSettingsUpdate(StrictBaseModel):
    columns: Optional[list] = None
    custom_roles: Optional[list] = None
    custom_boards: Optional[list] = None
    subscribers: Optional[list] = None
    group_chat: Optional[dict] = None
    telemetry_enabled: Optional[bool] = None
    ai_data_sharing: Optional[bool] = None

class DiscussionCreate(StrictBaseModel):
    quote: str = ""
    text: str = ""
    author: Optional[str] = ""

class DiscussionCommentCreate(StrictBaseModel):
    text: str = ""
    author: Optional[str] = ""

class DiscussionUpdate(StrictBaseModel):
    quote: Optional[str] = None
    text: Optional[str] = None
    status: Optional[str] = None
    resolved: Optional[bool] = None

class DiscussionConvertToTicket(StrictBaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    priority: Optional[str] = "medium"
    summary: Optional[str] = ""

class FeedbackConvertToTicket(StrictBaseModel):
    node_id: str
    title: str = Field(..., min_length=1, max_length=200)
    priority: Optional[str] = "medium"
    summary: Optional[str] = ""

class GitHubConfigRequest(StrictBaseModel):
    github_repo: Optional[str] = None
    github_token: Optional[str] = None
    github_sync_enabled: bool = False

class GitHubConfigResponse(StrictBaseModel):
    github_repo: Optional[str] = None
    has_token: bool = False
    github_sync_enabled: bool = False

class GitHubSyncResponse(StrictBaseModel):
    status: StatusEnum
    synced_count: int
    issues: list[dict] = Field(default_factory=list)

class TunnelIssueRequest(StrictBaseModel):
    target_host: str = "127.0.0.1"
    target_port: int = 5173
    ttl: Optional[str] = "7d"
    role: Optional[str] = "reviewer"
    single_use: Optional[bool] = False

    @field_validator("target_host")
    @classmethod
    def validate_host(cls, v: str) -> str:
        if v not in ("127.0.0.1", "localhost"):
            raise ValueError("Target host must be a loopback address (127.0.0.1 or localhost)")
        return v

    @field_validator("target_port")
    @classmethod
    def validate_port(cls, v: int) -> int:
        dangerous_ports = {0, 22, 25, 53, 2375, 5432}
        if v in dangerous_ports or v < 1 or v > 65535:
            raise ValueError(f"Port {v} is dangerous or invalid")
        return v

    @field_validator("ttl")
    @classmethod
    def validate_ttl(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and v not in ("1h", "24h", "7d", "30d", "forever"):
            raise ValueError("TTL must be one of: 1h, 24h, 7d, 30d, forever")
        return v

    @field_validator("role")
    @classmethod
    def validate_role(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and v not in ("viewer", "reviewer", "editor", "team", "client", "qa", "developer"):
            raise ValueError("Role must be valid")
        return v

class ErrorStackFrame(StrictBaseModel):
    filename: str = Field(..., min_length=1, max_length=1024)
    lineno: int = Field(..., ge=0, le=10_000_000)
    function: str = Field(..., min_length=1, max_length=256)
    code: Optional[str] = Field(default=None, max_length=1000)

class ErrorIngestPayload(StrictBaseModel):
    service: str = Field(default="backend", max_length=64)
    exception_type: str = Field(..., min_length=1, max_length=128)
    message: str = Field(..., min_length=1, max_length=4000)
    route: Optional[str] = Field(default=None, max_length=256)
    method: Optional[str] = Field(default=None, max_length=16)
    status_code: Optional[int] = Field(default=500, ge=100, le=599)
    environment: str = Field(default="production", max_length=32)
    release: Optional[str] = Field(default=None, max_length=64)
    request_id: Optional[str] = Field(default=None, max_length=64, pattern=r"^[A-Za-z0-9_.:-]+$")
    stack: list[ErrorStackFrame] = Field(default_factory=list, max_length=64)

class ErrorIngestResponse(StrictBaseModel):
    success: bool = True
    group_id: str
    occurrence_id: str
    fingerprint: str
    occurrences_count: int
    is_regression: bool = False
    ticket_id: Optional[str] = None
    ticket_key: Optional[str] = None

class ErrorGroupItem(StrictBaseModel):
    id: str
    project_id: str
    fingerprint: str
    service: str
    exception_type: str
    normalized_message: str
    route: Optional[str] = None
    top_frame: Optional[str] = None
    status: str
    occurrences_count: int
    first_seen_at: datetime
    last_seen_at: datetime
    ticket_id: Optional[str] = None
    ticket_key: Optional[str] = None

class ErrorOccurrenceItem(StrictBaseModel):
    id: str
    request_id: Optional[str] = None
    environment: str = "production"
    release: Optional[str] = None
    method: Optional[str] = None
    route: Optional[str] = None
    status_code: int = 500
    stack: list[dict[str, Any]] = Field(default_factory=list)
    created_at: datetime

class ErrorGroupDetailResponse(StrictBaseModel):
    id: str
    project_id: str
    fingerprint: str
    service: str
    exception_type: str
    normalized_message: str
    route: Optional[str] = None
    top_frame: Optional[str] = None
    status: str
    occurrences_count: int
    first_seen_at: datetime
    last_seen_at: datetime
    ticket_id: Optional[str] = None
    ticket_key: Optional[str] = None
    latest_occurrence: Optional[ErrorOccurrenceItem] = None
    ticket_title: Optional[str] = None
    ticket_status: Optional[str] = None

class ErrorGroupStatusUpdate(StrictBaseModel):
    status: Literal['open', 'resolved', 'ignored']