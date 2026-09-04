from __future__ import annotations

from datetime import datetime
from typing import Optional

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, JSON, String, Text

from models import Base, utcnow
from security import decrypt_field, encrypt_field


DEFAULT_PROTECTED_PATHS = [
    ".env",
    ".env.",
    ".git/",
    ".github/workflows/",
    "deploy/",
    "docker-compose.prod.yml",
    "nginx.prod.conf",
    "openspec-core/alembic/versions/",
]


class ProjectAutomationConfig(Base):
    __tablename__ = "project_automation_configs"

    project_id = Column(
        String,
        ForeignKey("projects.id", ondelete="CASCADE"),
        primary_key=True,
    )
    autonomy_mode = Column(String(32), nullable=False, default="assisted")
    agent_kind = Column(String(32), nullable=False, default="web_ai")
    dispatch_label = Column(String(64), nullable=False, default="")
    auto_issue_sync = Column(Boolean, nullable=False, default=True)
    auto_dispatch_on_handoff = Column(Boolean, nullable=False, default=False)
    create_pr_from_patch = Column(Boolean, nullable=False, default=True)
    observe_ci = Column(Boolean, nullable=False, default=True)
    observe_preview = Column(Boolean, nullable=False, default=True)
    auto_move_to_review = Column(Boolean, nullable=False, default=True)
    max_repair_attempts = Column(Integer, nullable=False, default=2)
    merge_policy = Column(String(32), nullable=False, default="human_accept")
    protected_paths = Column(JSON, nullable=False, default=lambda: list(DEFAULT_PROTECTED_PATHS))
    github_webhook_secret_encrypted = Column(Text, nullable=True)
    created_at = Column(DateTime, nullable=False, default=utcnow)
    updated_at = Column(DateTime, nullable=False, default=utcnow, onupdate=utcnow)

    @property
    def github_webhook_secret(self) -> Optional[str]:
        return decrypt_field(self.github_webhook_secret_encrypted)

    @github_webhook_secret.setter
    def github_webhook_secret(self, value: Optional[str]) -> None:
        self.github_webhook_secret_encrypted = encrypt_field(value) if value else None


class TicketAutomationState(Base):
    __tablename__ = "ticket_automation_states"

    ticket_id = Column(
        String,
        ForeignKey("spec_tickets.id", ondelete="CASCADE"),
        primary_key=True,
    )
    project_id = Column(
        String,
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    provider = Column(String(32), nullable=False, default="web_ai")
    base_branch = Column(String(255), nullable=True)
    base_sha = Column(String(64), nullable=True)
    branch_name = Column(String(255), nullable=True)
    github_pr_number = Column(Integer, nullable=True)
    github_pr_url = Column(String(1024), nullable=True)
    head_sha = Column(String(64), nullable=True, index=True)
    ci_state = Column(String(32), nullable=False, default="not_started")
    preview_url = Column(String(2048), nullable=True)
    orchestration_status = Column(String(64), nullable=False, default="idle")
    repair_attempts = Column(Integer, nullable=False, default=0)
    last_failed_head_sha = Column(String(64), nullable=True)
    last_check_summary = Column(JSON, nullable=False, default=dict)
    last_error = Column(Text, nullable=True)
    created_at = Column(DateTime, nullable=False, default=utcnow)
    updated_at = Column(DateTime, nullable=False, default=utcnow, onupdate=utcnow)
