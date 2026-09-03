from sqlalchemy import Column, String, Text, Boolean, Integer, ForeignKey, JSON, DateTime, UniqueConstraint, CheckConstraint
from sqlalchemy.orm import declarative_base, relationship
from datetime import datetime, timezone
from typing import Optional
import uuid

def utcnow():
    return datetime.now(timezone.utc).replace(tzinfo=None)

Base = declarative_base()

class User(Base):
    __tablename__ = 'users'
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    email = Column(String, unique=True, nullable=False, index=True)
    hashed_password = Column(String, nullable=True)
    is_active = Column(Boolean, default=True)
    terms_version = Column(String(32), nullable=True)
    terms_accepted_at = Column(DateTime, nullable=True)
    privacy_version = Column(String(32), nullable=True)
    privacy_acknowledged_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=utcnow)

    memberships = relationship('WorkspaceMembership', back_populates='user', cascade='all, delete-orphan')
    sessions = relationship('Session', back_populates='user', cascade='all, delete-orphan')

class Session(Base):
    __tablename__ = 'sessions'
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String, ForeignKey('users.id'), nullable=False, index=True)
    token = Column(String, unique=True, nullable=False, index=True)
    created_at = Column(DateTime, default=utcnow)
    expires_at = Column(DateTime, nullable=False)
    revoked_at = Column(DateTime, nullable=True)

    user = relationship('User', back_populates='sessions')

class WorkspaceMembership(Base):
    __tablename__ = 'workspace_memberships'
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    workspace_id = Column(String, ForeignKey('workspaces.id'), nullable=False, index=True)
    user_id = Column(String, ForeignKey('users.id'), nullable=False, index=True)
    role = Column(String, nullable=False, default='member') # owner, admin, member, tester, reviewer, viewer
    created_at = Column(DateTime, default=utcnow)

    workspace = relationship('Workspace', back_populates='memberships')
    user = relationship('User', back_populates='memberships')

class Workspace(Base):
    __tablename__ = 'workspaces'
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    name = Column(String, nullable=False)
    owner_email = Column(String, nullable=False, default='demo@vibeus.pro', index=True)
    api_key_digest = Column(String, unique=True, nullable=True)
    yookassa_payment_method_id = Column(String(256), nullable=True)
    
    # Billing & Tier Limits: free, solo, studio, business
    subscription_tier = Column(String, default='free')
    subscription_status = Column(String, default='inactive')  # inactive, active, canceled, past_due
    current_period_start = Column(DateTime, nullable=True)
    current_period_end = Column(DateTime, nullable=True)
    cancel_at_period_end = Column(Boolean, default=False)
    billing_provider = Column(String, default='free', nullable=True)
    stripe_customer_id = Column(String, nullable=True)
    tickets_used_this_month = Column(Integer, default=0)
    tickets_usage_period_start = Column(DateTime, nullable=True, default=utcnow)
    
    # B2B Legal Entity Info (Юрлица)
    company_inn = Column(String, nullable=True)
    company_name = Column(String, nullable=True)
    
    is_lifetime_free = Column(Boolean, default=False)
    promo_code_used = Column(String, nullable=True)
    
    # Recurring & Payment Method Refusal (152-ФЗ / Защита прав потребителей с 01.03.2026)
    payment_method_refused = Column(Boolean, default=False)
    payment_method_refused_at = Column(DateTime, nullable=True)
    
    # Attribution & Analytics (First-touch persistence)
    first_touch_source = Column(String(128), nullable=True)
    first_touch_at = Column(DateTime, nullable=True)
    
    created_at = Column(DateTime, default=utcnow)
    
    projects = relationship('Project', back_populates='workspace', cascade='all, delete-orphan')
    memberships = relationship('WorkspaceMembership', back_populates='workspace', cascade='all, delete-orphan')
    payments = relationship('Payment', back_populates='workspace', cascade='all, delete-orphan')

class Project(Base):
    __tablename__ = 'projects'
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    workspace_id = Column(String, ForeignKey('workspaces.id'), nullable=True)
    
    name = Column(String, nullable=False)
    description = Column(Text, default='')
    api_token_digest = Column(String, unique=True, nullable=True, index=True)
    slug = Column(String, unique=True, nullable=False, index=True)
    columns = Column(JSON, default=list)
    custom_roles = Column(JSON, default=list)
    custom_boards = Column(JSON, default=list)
    group_chat = Column(JSON, default=dict)
    subscribers = Column(JSON, default=list)
    feedbacks = Column(JSON, default=list)
    ticket_seq = Column(Integer, default=0)
    revision = Column(Integer, default=0)
    is_deleted = Column(Boolean, default=False)
    telemetry_enabled = Column(Boolean, default=False)
    ai_data_sharing = Column(Boolean, default=False)
    # Public widget key is intentionally browser-visible. Keep the raw value so
    # the workspace owner can copy it again from the dashboard. The digest stays
    # as the lookup/verification primitive and for compatibility with old rows.
    public_widget_key = Column(String, nullable=True)
    public_widget_key_digest = Column(String, nullable=True, index=True)
    public_widget_origins = Column(JSON, default=list)
    runtime_error_tracking_enabled = Column(Boolean, default=False, nullable=False)
    # Runtime ingest credentials are secrets: keep only the digest at rest.
    ingest_key_digest = Column(String, unique=True, nullable=True, index=True)
    
    # GitHub Integration
    github_repo = Column(String, nullable=True) # e.g. "owner/repo"
    github_token_encrypted = Column(Text, nullable=True) # GitHub PAT
    github_sync_enabled = Column(Boolean, default=False)
    
    @property
    def github_token(self) -> Optional[str]:
        from security import decrypt_field
        return decrypt_field(self.github_token_encrypted)

    @github_token.setter
    def github_token(self, val: Optional[str]):
        from security import encrypt_field
        self.github_token_encrypted = encrypt_field(val) if val else None

    created_at = Column(DateTime, default=utcnow)
    
    workspace = relationship('Workspace', back_populates='projects')
    nodes = relationship('SpecNode', back_populates='project', cascade='all, delete-orphan')
    access_links = relationship('ProjectAccessLink', back_populates='project', cascade='all, delete-orphan')
    feedback_items = relationship('Feedback', back_populates='project', cascade='all, delete-orphan')
    error_groups = relationship('ErrorGroup', back_populates='project', cascade='all, delete-orphan')

class ProjectAccessLink(Base):
    __tablename__ = 'project_access_links'
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    project_id = Column(String, ForeignKey('projects.id'), nullable=False)
    token_hash = Column(String, unique=True, nullable=False, index=True)
    label = Column(String, default='')
    role = Column(String, default='reviewer') # team, reviewer, tester
    ttl = Column(String, default='7d') # 24h, 7d, 30d, forever
    single_use = Column(Boolean, default=False)
    is_activated = Column(Boolean, default=False)
    activated_fingerprint = Column(String, nullable=True)
    activated_at = Column(DateTime, nullable=True)
    expires_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=utcnow)
    
    project = relationship('Project', back_populates='access_links')

    @property
    def token_digest(self):
        return self.token_hash

    @token_digest.setter
    def token_digest(self, val):
        self.token_hash = val

class SpecNode(Base):
    __tablename__ = 'spec_nodes'
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    project_id = Column(String, ForeignKey('projects.id'), nullable=False)
    parent_id = Column(String, ForeignKey('spec_nodes.id'), nullable=True)
    title = Column(String, nullable=False)
    description = Column(Text, default='')
    content_markdown = Column(Text, default='')
    discussions = Column(JSON, default=list)
    is_deleted = Column(Boolean, default=False)
    
    project = relationship('Project', back_populates='nodes')
    tickets = relationship('SpecTicket', back_populates='node', cascade='all, delete-orphan')

class SpecTicket(Base):
    __tablename__ = 'spec_tickets'
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    node_id = Column(String, ForeignKey('spec_nodes.id'), nullable=False)
    key = Column(String, index=True, nullable=True)
    title = Column(String, nullable=False)
    summary = Column(Text, default='')
    source_quote = Column(Text, default='')
    assignee = Column(String, default='')
    bug_context = Column(JSON, default=dict)
    status = Column(String, default='backlog')
    priority = Column(String, default='medium')
    checklists = Column(JSON, default=dict)
    # Criteria Contract v2.1: claims remain in checklists; structured requirements and evidence are separate.
    criteria_contract = Column(JSON, default=dict)
    criteria_evidence = Column(JSON, default=dict)
    quality_mode = Column(String(16), nullable=False, default='strict')
    rework_notes = Column(Text, default='')
    is_archived = Column(Boolean, default=False)
    is_deleted = Column(Boolean, default=False)
    
    # GitHub issue sync tracking
    github_issue_url = Column(String, nullable=True)
    github_issue_number = Column(Integer, nullable=True)
    
    comments = Column(JSON, default=list)
    order = Column(Integer, default=0)
    revision = Column(Integer, default=0)
    created_at = Column(DateTime, default=utcnow)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)
    
    node = relationship('SpecNode', back_populates='tickets')

class Payment(Base):
    __tablename__ = 'payments'
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    provider = Column(String, nullable=False, default='yookassa') # yookassa, stripe, b2b
    provider_payment_id = Column(String, unique=True, nullable=False, index=True)
    workspace_id = Column(String, ForeignKey('workspaces.id'), nullable=False, index=True)
    plan = Column(String, nullable=False) # solo, studio
    amount_minor = Column(Integer, nullable=False) # in rubles or cents
    currency = Column(String, nullable=False, default='RUB')
    status = Column(String, nullable=False, default='pending') # pending, succeeded, canceled, refunded
    is_test = Column(Boolean, default=False)
    
    # Fiscal mode is snapshotted per payment so later deployment config changes
    # cannot reinterpret an already-created checkout.
    tax_mode = Column(String(16), nullable=False, default='npd')
    # Fiscal & NPD Tracking (receipt registration status: receipt_not_required, receipt_required, receipt_issued)
    fiscal_status = Column(String(32), nullable=False, default='receipt_not_required')
    receipt_url = Column(String(512), nullable=True)
    receipt_issued_at = Column(DateTime, nullable=True)

    # Buyer fiscal identity snapshotted at payment creation
    buyer_email = Column(String(255), nullable=True)
    buyer_is_b2b = Column(Boolean, default=False, nullable=False)
    buyer_inn = Column(String(32), nullable=True)
    buyer_name = Column(String(255), nullable=True)
    buyer_snapshot_verified = Column(Boolean, default=False, nullable=False)
    
    entitlement_period_start = Column(DateTime, nullable=True)
    entitlement_period_end = Column(DateTime, nullable=True)
    processed_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=utcnow)

    __table_args__ = (
        CheckConstraint("tax_mode IN ('npd', 'kkt_54fz')", name="ck_payments_tax_mode"),
        CheckConstraint("fiscal_status IN ('receipt_not_required', 'receipt_required', 'receipt_issued', 'receipt_refund_required', 'receipt_refunded')", name="ck_payments_fiscal_status"),
        CheckConstraint("fiscal_status != 'receipt_required' OR (status = 'succeeded' AND tax_mode = 'npd')", name="ck_payments_receipt_required_state"),
        CheckConstraint("fiscal_status != 'receipt_issued' OR (status = 'succeeded' AND tax_mode = 'npd' AND receipt_url IS NOT NULL AND receipt_issued_at IS NOT NULL)", name="ck_payments_receipt_issued_proof"),
        CheckConstraint("fiscal_status != 'receipt_refund_required' OR (status IN ('succeeded', 'refunded') AND tax_mode = 'npd')", name="ck_payments_receipt_refund_required_state"),
        CheckConstraint("buyer_snapshot_verified = 0 OR (buyer_email IS NOT NULL AND TRIM(buyer_email) != '')", name="ck_payments_verified_buyer_email"),
        CheckConstraint("buyer_snapshot_verified = 0 OR buyer_is_b2b = 0 OR (buyer_inn IS NOT NULL AND TRIM(buyer_inn) != '' AND buyer_name IS NOT NULL AND TRIM(buyer_name) != '')", name="ck_payments_verified_b2b_buyer"),
    )

    workspace = relationship('Workspace', back_populates='payments')
    refunds = relationship('PaymentRefund', back_populates='payment', cascade='all, delete-orphan')

class PaymentRefund(Base):
    __tablename__ = 'payment_refunds'
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    provider_refund_id = Column(String, unique=True, nullable=False, index=True)
    payment_id = Column(String, ForeignKey('payments.id'), nullable=False, index=True)
    amount_minor = Column(Integer, nullable=False)
    currency = Column(String, nullable=False, default='RUB')
    status = Column(String, nullable=False, default='succeeded') # pending, succeeded, canceled
    description = Column(String, nullable=True)
    created_at = Column(DateTime, default=utcnow)

    payment = relationship('Payment', back_populates='refunds')

class TunnelSession(Base):
    __tablename__ = 'tunnel_sessions'
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    tunnel_id = Column(String, unique=True, nullable=False, index=True)
    project_id = Column(String, ForeignKey('projects.id'), nullable=False, index=True)
    connect_token_digest = Column(String, nullable=False)
    target_port = Column(Integer, default=5173)
    status = Column(String, default='active') # active, closed, revoked
    is_connected = Column(Boolean, default=False)
    expires_at = Column(DateTime, nullable=False)
    created_at = Column(DateTime, default=utcnow)


class PreviewSession(Base):
    __tablename__ = 'preview_sessions'
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    session_digest = Column(String, unique=True, nullable=False, index=True)
    tunnel_id = Column(String, ForeignKey('tunnel_sessions.tunnel_id'), nullable=False, index=True)
    access_link_id = Column(String, ForeignKey('project_access_links.id'), nullable=False, index=True)
    created_at = Column(DateTime, default=utcnow)
    expires_at = Column(DateTime, nullable=False)
    revoked_at = Column(DateTime, nullable=True)

class AuditEvent(Base):
    __tablename__ = 'audit_events'
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    event_id = Column(String(128), unique=True, nullable=True)
    workspace_id = Column(String, ForeignKey('workspaces.id'), nullable=True, index=True)
    project_id = Column(String, ForeignKey('projects.id'), nullable=True, index=True)
    user_id = Column(String, ForeignKey('users.id'), nullable=True, index=True)
    event_type = Column(String, nullable=False, index=True)
    ip_address = Column(String, nullable=True)
    details = Column(JSON, default=dict)
    created_at = Column(DateTime, default=utcnow)

class PromoCode(Base):
    __tablename__ = 'promo_codes'
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    code_digest = Column(String, unique=True, nullable=False, index=True)
    tier = Column(String, nullable=False, default='solo') # solo, studio, business
    duration_days = Column(Integer, nullable=True, default=30)
    grants_lifetime = Column(Boolean, nullable=False, default=False)
    campaign = Column(String(80), nullable=True, index=True)
    is_active = Column(Boolean, default=True)
    max_uses = Column(Integer, default=1)
    times_used = Column(Integer, default=0)
    expires_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=utcnow)

class PromoRedemption(Base):
    __tablename__ = 'promo_redemptions'
    __table_args__ = (
        UniqueConstraint('promo_code_id', 'workspace_id', name='uq_promo_redemption_code_workspace'),
        UniqueConstraint('promo_code_id', 'user_id', name='uq_promo_redemption_code_user'),
    )
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    promo_code_id = Column(String, ForeignKey('promo_codes.id'), nullable=False, index=True)
    workspace_id = Column(String, ForeignKey('workspaces.id'), nullable=False, index=True)
    user_id = Column(String, ForeignKey('users.id'), nullable=True, index=True)
    campaign = Column(String(80), nullable=True, index=True)
    tier = Column(String, nullable=False)
    duration_days = Column(Integer, nullable=True)
    redeemed_at = Column(DateTime, default=utcnow, nullable=False)

class Feedback(Base):
    __tablename__ = 'feedbacks'
    __table_args__ = (
        UniqueConstraint("project_id", "idempotency_key", name="uq_feedbacks_project_idempotency"),
    )

    id = Column(String, primary_key=True, default=lambda: f"fb_{uuid.uuid4().hex[:12]}")
    project_id = Column(String, ForeignKey('projects.id', ondelete='CASCADE'), nullable=False, index=True)
    idempotency_key = Column(String(128), nullable=True)
    text = Column(Text, nullable=False)
    category = Column(String(64), default='idea')
    status = Column(String(32), default='new')
    converted_ticket_id = Column(String, nullable=True)
    created_at = Column(DateTime, default=utcnow)
    details = Column(JSON, nullable=True)

    project = relationship('Project', back_populates='feedback_items')

class ErrorGroup(Base):
    __tablename__ = 'error_groups'
    __table_args__ = (
        UniqueConstraint('project_id', 'fingerprint', name='uq_project_error_fingerprint'),
    )

    id = Column(String, primary_key=True, default=lambda: f"errgrp_{uuid.uuid4().hex[:12]}")
    project_id = Column(String, ForeignKey('projects.id', ondelete='CASCADE'), nullable=False, index=True)
    fingerprint = Column(String(64), nullable=False, index=True)
    service = Column(String(64), nullable=False, default='backend')
    exception_type = Column(String(128), nullable=False)
    normalized_message = Column(Text, nullable=False)
    route = Column(String(256), nullable=True)
    top_frame = Column(String(256), nullable=True)
    status = Column(String(32), nullable=False, default='open') # open, resolved, ignored
    occurrences_count = Column(Integer, default=1)
    first_seen_at = Column(DateTime, default=utcnow)
    last_seen_at = Column(DateTime, default=utcnow)
    ticket_id = Column(String, ForeignKey('spec_tickets.id', ondelete='SET NULL'), nullable=True)

    project = relationship('Project', back_populates='error_groups')
    ticket = relationship('SpecTicket')
    occurrences = relationship('ErrorOccurrence', back_populates='group', cascade='all, delete-orphan')

class ErrorOccurrence(Base):
    __tablename__ = 'error_occurrences'
    id = Column(String, primary_key=True, default=lambda: f"errevt_{uuid.uuid4().hex[:12]}")
    group_id = Column(String, ForeignKey('error_groups.id', ondelete='CASCADE'), nullable=False, index=True)
    request_id = Column(String(64), nullable=True, index=True)
    environment = Column(String(32), default='production')
    release = Column(String(64), nullable=True)
    method = Column(String(16), nullable=True)
    route = Column(String(256), nullable=True)
    status_code = Column(Integer, default=500)
    stack = Column(JSON, default=list)
    created_at = Column(DateTime, default=utcnow)

    group = relationship('ErrorGroup', back_populates='occurrences')


