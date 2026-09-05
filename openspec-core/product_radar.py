from __future__ import annotations

from datetime import timedelta
from statistics import median

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

import control_router
import models
from database import get_db


router = APIRouter(prefix="/api/control", tags=["control-radar"])

# These are launch steering defaults, not market benchmarks. They exist so the
# founder can see direction and target attainment without pretending that a tiny
# launch cohort is statistically stable. Every metric also carries sample size
# and confidence, and low-sample signals must never trigger a red "intervene"
# state on their own.
LAUNCH_TARGETS = {
    "activation_24h_pct": 60.0,
    "first_value_hours_max": 24.0,
    "repeat_value_pct": 40.0,
    "signal_to_ticket_pct": 50.0,
    "paid_conversion_pct": 8.0,
    "payment_success_pct": 90.0,
}


MEASURED_SIGNALS = [
    "signup",
    "workspace_created",
    "project_created",
    "feedback_captured",
    "runtime_error_captured",
    "ticket_created",
    "human_acceptance",
    "payment_state",
    "promo_redemption",
    "legal_consent_versions",
]

MISSING_SIGNALS = [
    {
        "key": "landing_view",
        "label": "Landing visits and campaign impressions",
        "why": "Without denominator traffic, acquisition conversion cannot be measured honestly.",
        "next": "Add privacy-light first-party aggregate page-view/source telemetry before paid acquisition.",
    },
    {
        "key": "onboarding_step",
        "label": "Onboarding step drop-off",
        "why": "Signup-to-project activation shows the result but not where onboarding loses people.",
        "next": "Emit allow-listed onboarding milestones without free-form payloads.",
    },
    {
        "key": "feature_usage",
        "label": "Authenticated feature usage",
        "why": "Repeat value can be measured, but feature-level adoption and habit formation remain opaque.",
        "next": "Track a small server-approved event taxonomy for core product actions.",
    },
    {
        "key": "checkout_started_abandoned",
        "label": "Checkout start / abandonment",
        "why": "A pending payment is not the same thing as a user who opened checkout and abandoned it.",
        "next": "Persist checkout-start and provider-return milestones with provider/payment IDs only.",
    },
    {
        "key": "cancellation_reason",
        "label": "Cancellation and churn reason",
        "why": "Revenue churn without reason cannot tell pricing friction from missing value.",
        "next": "Capture a bounded cancellation reason plus optional support note after provider cancellation exists.",
    },
    {
        "key": "support_contact_sla",
        "label": "Support contacts and response SLA",
        "why": "Founder workload and repeated confusion are leading indicators of product friction.",
        "next": "Add internal support notes/tags and response timestamps in the post-MVP Customer 360 layer.",
    },
    {
        "key": "platform_5xx_latency",
        "label": "VibeUs service latency / 5xx / availability",
        "why": "Customer runtime errors belong to customer projects and must not be misread as VibeUs platform failures.",
        "next": "Store aggregate API latency, 5xx rate and readiness/SLO samples for the hosted service.",
    },
    {
        "key": "deployment_release",
        "label": "VibeUs deployment and release events",
        "why": "Product delivery velocity cannot be inferred from customer tickets or repository state stored elsewhere.",
        "next": "Emit immutable deployment/release events from CI/CD into the founder metrics ledger.",
    },
    {
        "key": "experiment_exposure",
        "label": "Experiment exposure / variant",
        "why": "A/B conclusions are invalid without knowing which users actually saw each variant.",
        "next": "Add experiment exposure only when feature flags/experiments become operational.",
    },
]


def _ratio(numerator: int, denominator: int) -> float | None:
    if denominator <= 0:
        return None
    return round((numerator / denominator) * 100.0, 1)


def _change_pct(current: int, previous: int) -> float | None:
    if previous <= 0:
        return None
    return round(((current - previous) / previous) * 100.0, 1)


def _confidence(sample: int) -> str:
    if sample >= 30:
        return "high"
    if sample >= 10:
        return "medium"
    return "low"


def _target_score(value: float | None, target: float, *, lower_is_better: bool = False) -> int | None:
    if value is None:
        return None
    if lower_is_better:
        if value <= target:
            return 100
        if value <= 0:
            return 100
        return max(0, min(100, round((target / value) * 100)))
    if target <= 0:
        return None
    return max(0, min(100, round((value / target) * 100)))


def _status(score: int | None, confidence: str) -> str:
    if score is None or confidence == "low":
        return "insufficient"
    if score >= 90:
        return "healthy"
    if score >= 65:
        return "watch"
    return "intervene"


async def _signal_workspace_ids(db: AsyncSession, start, end) -> set[str]:
    feedback_rows = (await db.execute(
        select(models.Project.workspace_id)
        .join(models.Feedback, models.Feedback.project_id == models.Project.id)
        .where(
            models.Project.workspace_id.is_not(None),
            models.Project.is_deleted == False,
            models.Feedback.created_at >= start,
            models.Feedback.created_at < end,
        )
        .distinct()
    )).scalars().all()

    error_rows = (await db.execute(
        select(models.Project.workspace_id)
        .select_from(models.ErrorOccurrence)
        .join(models.ErrorGroup, models.ErrorGroup.id == models.ErrorOccurrence.group_id)
        .join(models.Project, models.Project.id == models.ErrorGroup.project_id)
        .where(
            models.Project.workspace_id.is_not(None),
            models.Project.is_deleted == False,
            models.ErrorOccurrence.created_at >= start,
            models.ErrorOccurrence.created_at < end,
        )
        .distinct()
    )).scalars().all()

    return {str(item) for item in [*feedback_rows, *error_rows] if item}


async def _activation(db: AsyncSession, start, end) -> dict:
    new_users = list((await db.execute(
        select(models.User.id, models.User.created_at)
        .where(models.User.created_at >= start, models.User.created_at < end)
    )).all())
    if not new_users:
        return {"numerator": 0, "denominator": 0, "pct": None, "confidence": "low"}

    user_ids = [row[0] for row in new_users]
    first_projects = dict((await db.execute(
        select(models.WorkspaceMembership.user_id, func.min(models.Project.created_at))
        .join(models.Project, models.Project.workspace_id == models.WorkspaceMembership.workspace_id)
        .where(
            models.WorkspaceMembership.user_id.in_(user_ids),
            models.Project.is_deleted == False,
        )
        .group_by(models.WorkspaceMembership.user_id)
    )).all())

    activated = 0
    for user_id, created_at in new_users:
        first_project = first_projects.get(user_id)
        if first_project and first_project <= created_at + timedelta(hours=24):
            activated += 1

    denominator = len(new_users)
    return {
        "numerator": activated,
        "denominator": denominator,
        "pct": _ratio(activated, denominator),
        "confidence": _confidence(denominator),
    }


async def _first_value(db: AsyncSession, now) -> dict:
    project_rows = list((await db.execute(
        select(models.Project.id, models.Project.created_at)
        .where(
            models.Project.created_at >= now - timedelta(days=14),
            models.Project.is_deleted == False,
        )
    )).all())
    if not project_rows:
        return {"median_hours": None, "sample": 0, "confidence": "low"}

    project_ids = [row[0] for row in project_rows]
    feedback_first = dict((await db.execute(
        select(models.Feedback.project_id, func.min(models.Feedback.created_at))
        .where(models.Feedback.project_id.in_(project_ids))
        .group_by(models.Feedback.project_id)
    )).all())
    error_first = dict((await db.execute(
        select(models.ErrorGroup.project_id, func.min(models.ErrorOccurrence.created_at))
        .select_from(models.ErrorOccurrence)
        .join(models.ErrorGroup, models.ErrorGroup.id == models.ErrorOccurrence.group_id)
        .where(models.ErrorGroup.project_id.in_(project_ids))
        .group_by(models.ErrorGroup.project_id)
    )).all())

    durations: list[float] = []
    for project_id, created_at in project_rows:
        candidates = [item for item in (feedback_first.get(project_id), error_first.get(project_id)) if item]
        if not candidates:
            continue
        first_signal = min(candidates)
        hours = (first_signal - created_at).total_seconds() / 3600.0
        if hours >= 0:
            durations.append(hours)

    if not durations:
        return {"median_hours": None, "sample": 0, "confidence": "low"}
    value = round(float(median(durations)), 1)
    return {"median_hours": value, "sample": len(durations), "confidence": _confidence(len(durations))}


async def _signal_to_ticket(db: AsyncSession, start, end) -> dict:
    feedback_total = int((await db.execute(
        select(func.count(models.Feedback.id)).where(
            models.Feedback.created_at >= start,
            models.Feedback.created_at < end,
        )
    )).scalar() or 0)
    feedback_linked = int((await db.execute(
        select(func.count(models.Feedback.id)).where(
            models.Feedback.created_at >= start,
            models.Feedback.created_at < end,
            models.Feedback.converted_ticket_id.is_not(None),
        )
    )).scalar() or 0)
    error_total = int((await db.execute(
        select(func.count(models.ErrorGroup.id)).where(
            models.ErrorGroup.first_seen_at >= start,
            models.ErrorGroup.first_seen_at < end,
        )
    )).scalar() or 0)
    error_linked = int((await db.execute(
        select(func.count(models.ErrorGroup.id)).where(
            models.ErrorGroup.first_seen_at >= start,
            models.ErrorGroup.first_seen_at < end,
            models.ErrorGroup.ticket_id.is_not(None),
        )
    )).scalar() or 0)
    total = feedback_total + error_total
    linked = feedback_linked + error_linked
    return {
        "numerator": linked,
        "denominator": total,
        "pct": _ratio(linked, total),
        "confidence": _confidence(total),
        "feedback": {"total": feedback_total, "linked": feedback_linked},
        "runtime_errors": {"groups": error_total, "linked": error_linked},
    }


async def _paid_conversion(db: AsyncSession, now) -> dict:
    eligible = set((await db.execute(
        select(models.Workspace.id)
        .join(models.Project, models.Project.workspace_id == models.Workspace.id)
        .where(
            models.Workspace.created_at <= now - timedelta(days=3),
            models.Project.is_deleted == False,
        )
        .distinct()
    )).scalars().all())
    if not eligible:
        return {"numerator": 0, "denominator": 0, "pct": None, "confidence": "low"}
    paid = set((await db.execute(
        select(models.Payment.workspace_id)
        .where(
            models.Payment.workspace_id.in_(eligible),
            models.Payment.status == "succeeded",
            models.Payment.is_test == False,
        )
        .distinct()
    )).scalars().all())
    return {
        "numerator": len(paid),
        "denominator": len(eligible),
        "pct": _ratio(len(paid), len(eligible)),
        "confidence": _confidence(len(eligible)),
        "eligible_definition": "Workspace older than 3 days with at least one non-deleted project",
    }


async def _payment_success(db: AsyncSession, start, now) -> dict:
    cutoff = now - timedelta(minutes=15)
    rows = list((await db.execute(
        select(models.Payment.status)
        .where(
            models.Payment.created_at >= start,
            models.Payment.created_at <= cutoff,
            models.Payment.is_test == False,
        )
    )).scalars().all())
    succeeded = sum(1 for item in rows if item == "succeeded")
    return {
        "numerator": succeeded,
        "denominator": len(rows),
        "pct": _ratio(succeeded, len(rows)),
        "confidence": _confidence(len(rows)),
        "excludes_last_minutes": 15,
    }


async def _count(db: AsyncSession, stmt) -> int:
    return int((await db.execute(stmt)).scalar() or 0)


@router.get("/radar")
async def product_radar(
    user: models.User = Depends(control_router.require_platform_admin),
    db: AsyncSession = Depends(get_db),
):
    now = models.utcnow()
    current_start = now - timedelta(days=7)
    previous_start = now - timedelta(days=14)
    month_start = now - timedelta(days=30)

    signups_current = await _count(
        db,
        select(func.count(models.User.id)).where(models.User.created_at >= current_start),
    )
    signups_previous = await _count(
        db,
        select(func.count(models.User.id)).where(
            models.User.created_at >= previous_start,
            models.User.created_at < current_start,
        ),
    )

    activation = await _activation(db, current_start, now)
    previous_activation = await _activation(db, previous_start, current_start)
    first_value = await _first_value(db, now)

    value_current = await _signal_workspace_ids(db, current_start, now)
    value_previous = await _signal_workspace_ids(db, previous_start, current_start)
    retained = value_current & value_previous
    repeat_value = {
        "numerator": len(retained),
        "denominator": len(value_previous),
        "pct": _ratio(len(retained), len(value_previous)),
        "confidence": _confidence(len(value_previous)),
    }

    signal_to_ticket = await _signal_to_ticket(db, current_start, now)
    paid_conversion = await _paid_conversion(db, now)
    payment_success = await _payment_success(db, current_start, now)

    feedback_7d = await _count(
        db,
        select(func.count(models.Feedback.id)).where(models.Feedback.created_at >= current_start),
    )
    new_error_groups_7d = await _count(
        db,
        select(func.count(models.ErrorGroup.id)).where(models.ErrorGroup.first_seen_at >= current_start),
    )
    tickets_7d = await _count(
        db,
        select(func.count(models.SpecTicket.id)).where(
            models.SpecTicket.created_at >= current_start,
            models.SpecTicket.is_deleted == False,
        ),
    )
    human_acceptances_7d = await _count(
        db,
        select(func.count(models.AuditEvent.id)).where(
            models.AuditEvent.event_type == "ticket.human_accepted",
            models.AuditEvent.created_at >= current_start,
        ),
    )
    paid_workspaces_7d = await _count(
        db,
        select(func.count(func.distinct(models.Payment.workspace_id))).where(
            models.Payment.status == "succeeded",
            models.Payment.is_test == False,
            models.Payment.created_at >= current_start,
        ),
    )

    pending_payments = await _count(
        db,
        select(func.count(models.Payment.id)).where(
            models.Payment.status == "pending",
            models.Payment.created_at <= now - timedelta(minutes=15),
        ),
    )
    fiscal_attention = await _count(
        db,
        select(func.count(models.Payment.id)).where(
            models.Payment.fiscal_status.in_(["receipt_required", "receipt_refund_required"])
        ),
    )
    refunds_30d = await _count(
        db,
        select(func.count(models.PaymentRefund.id)).where(
            models.PaymentRefund.status == "succeeded",
            models.PaymentRefund.created_at >= month_start,
        ),
    )
    consent_missing = await _count(
        db,
        select(func.count(models.User.id)).where(
            (models.User.terms_version.is_(None)) | (models.User.privacy_version.is_(None))
        ),
    )

    reach_change = _change_pct(signups_current, signups_previous)
    if signups_previous >= 5:
        reach_score = max(0, min(100, round((signups_current / max(signups_previous, 1)) * 100)))
        reach_confidence = _confidence(signups_previous)
    else:
        reach_score = None
        reach_confidence = "low"

    activation_score = _target_score(activation["pct"], LAUNCH_TARGETS["activation_24h_pct"])
    first_value_score = _target_score(
        first_value["median_hours"],
        LAUNCH_TARGETS["first_value_hours_max"],
        lower_is_better=True,
    )
    repeat_score = _target_score(repeat_value["pct"], LAUNCH_TARGETS["repeat_value_pct"])
    delivery_score = _target_score(signal_to_ticket["pct"], LAUNCH_TARGETS["signal_to_ticket_pct"])
    monetization_score = _target_score(paid_conversion["pct"], LAUNCH_TARGETS["paid_conversion_pct"])
    payops_score = _target_score(payment_success["pct"], LAUNCH_TARGETS["payment_success_pct"])

    total_signals = len(MEASURED_SIGNALS) + len(MISSING_SIGNALS)
    coverage_pct = round((len(MEASURED_SIGNALS) / total_signals) * 100.0, 1)
    learning_score = round(coverage_pct)

    dimensions = [
        {
            "key": "reach",
            "label": "Reach",
            "score": reach_score,
            "status": _status(reach_score, reach_confidence),
            "confidence": reach_confidence,
            "sample": signups_previous,
            "value": signups_current,
            "unit": "signups / 7d",
            "trend_pct": reach_change,
            "target": "Do not scale on signup volume alone; compare trend only after a usable prior-week sample.",
            "question": "Are more relevant people entering the product?",
        },
        {
            "key": "activation",
            "label": "Activate",
            "score": activation_score,
            "status": _status(activation_score, activation["confidence"]),
            "confidence": activation["confidence"],
            "sample": activation["denominator"],
            "value": activation["pct"],
            "unit": "% signup → first project ≤24h",
            "trend_pct": (
                round(activation["pct"] - previous_activation["pct"], 1)
                if activation["pct"] is not None and previous_activation["pct"] is not None
                else None
            ),
            "target": f"Launch steering default ≥ {LAUNCH_TARGETS['activation_24h_pct']:.0f}%",
            "question": "Do new users get through setup fast enough?",
        },
        {
            "key": "value",
            "label": "First value",
            "score": first_value_score,
            "status": _status(first_value_score, first_value["confidence"]),
            "confidence": first_value["confidence"],
            "sample": first_value["sample"],
            "value": first_value["median_hours"],
            "unit": "median hours project → first feedback/error",
            "trend_pct": None,
            "target": f"Launch steering default ≤ {LAUNCH_TARGETS['first_value_hours_max']:.0f}h",
            "question": "How quickly does VibeUs produce a real signal?",
        },
        {
            "key": "return",
            "label": "Return",
            "score": repeat_score,
            "status": _status(repeat_score, repeat_value["confidence"]),
            "confidence": repeat_value["confidence"],
            "sample": repeat_value["denominator"],
            "value": repeat_value["pct"],
            "unit": "% prior value workspaces active again",
            "trend_pct": None,
            "target": f"Launch steering default ≥ {LAUNCH_TARGETS['repeat_value_pct']:.0f}%",
            "question": "Does value repeat, or was it a one-off trial?",
        },
        {
            "key": "delivery",
            "label": "Deliver",
            "score": delivery_score,
            "status": _status(delivery_score, signal_to_ticket["confidence"]),
            "confidence": signal_to_ticket["confidence"],
            "sample": signal_to_ticket["denominator"],
            "value": signal_to_ticket["pct"],
            "unit": "% new signals linked to tickets",
            "trend_pct": None,
            "target": f"Launch steering default ≥ {LAUNCH_TARGETS['signal_to_ticket_pct']:.0f}%",
            "question": "Do captured signals enter the engineering loop?",
        },
        {
            "key": "monetize",
            "label": "Monetize",
            "score": monetization_score,
            "status": _status(monetization_score, paid_conversion["confidence"]),
            "confidence": paid_conversion["confidence"],
            "sample": paid_conversion["denominator"],
            "value": paid_conversion["pct"],
            "unit": "% eligible workspaces with real succeeded payment",
            "trend_pct": None,
            "target": f"Initial internal steering target ≥ {LAUNCH_TARGETS['paid_conversion_pct']:.0f}% (not an industry benchmark)",
            "question": "Will delivered value convert into real revenue?",
        },
        {
            "key": "cash_trust",
            "label": "Cash & trust",
            "score": payops_score,
            "status": _status(payops_score, payment_success["confidence"]),
            "confidence": payment_success["confidence"],
            "sample": payment_success["denominator"],
            "value": payment_success["pct"],
            "unit": "% settled payments among attempts older than 15m",
            "trend_pct": None,
            "target": f"Launch steering default ≥ {LAUNCH_TARGETS['payment_success_pct']:.0f}%",
            "question": "Can customers pay without money/fiscal surprises?",
        },
        {
            "key": "learn",
            "label": "Learn",
            "score": learning_score,
            "status": "healthy" if coverage_pct >= 80 else "watch" if coverage_pct >= 60 else "intervene",
            "confidence": "high",
            "sample": total_signals,
            "value": coverage_pct,
            "unit": "% planned steering signals instrumented",
            "trend_pct": None,
            "target": "≥80% before aggressively scaling acquisition",
            "question": "Can we explain why the product moved, not only that it moved?",
        },
    ]

    steering: list[dict] = []

    if pending_payments > 0 or fiscal_attention > 0:
        steering.append({
            "priority": "P0",
            "area": "Cash & trust",
            "title": "Protect payment/fiscal integrity before growth",
            "reason": f"{pending_payments} payments pending >15m; {fiscal_attention} fiscal items need attention.",
            "action": "Resolve provider/fiscal discrepancies before driving more checkout volume.",
            "guardrail": "Never repair this by editing local payment state without provider evidence.",
        })

    if payment_success["denominator"] >= 10 and (payment_success["pct"] or 0) < 90:
        steering.append({
            "priority": "P0",
            "area": "Checkout",
            "title": "Payment completion is below launch guardrail",
            "reason": f"Success {payment_success['pct']}% across {payment_success['denominator']} mature attempts.",
            "action": "Inspect provider declines, redirect failures and checkout UX before increasing traffic.",
            "guardrail": "Separate provider declines from application errors before changing pricing or product positioning.",
        })

    if activation["denominator"] >= 10 and (activation["pct"] or 0) < 35:
        steering.append({
            "priority": "P1",
            "area": "Activation",
            "title": "Fix onboarding before buying more reach",
            "reason": f"Only {activation['pct']}% of new users create a project within 24h.",
            "action": "Watch real onboarding sessions, remove setup decisions and shorten the path to a working project.",
            "guardrail": "Do not compensate a weak activation loop with promotions or ad spend.",
        })

    if first_value["sample"] >= 10 and (first_value["median_hours"] or 0) > 72:
        steering.append({
            "priority": "P1",
            "area": "Time to value",
            "title": "Users wait too long for the first real signal",
            "reason": f"Median project→first feedback/error is {first_value['median_hours']}h.",
            "action": "Improve install guidance, demo/test feedback and integration verification so value appears in the first session.",
            "guardrail": "Optimize for a genuine captured signal, not a cosmetic onboarding-complete event.",
        })

    if repeat_value["denominator"] >= 10 and (repeat_value["pct"] or 0) < 20:
        steering.append({
            "priority": "P1",
            "area": "Retention",
            "title": "Do not scale acquisition until value repeats",
            "reason": f"Only {repeat_value['pct']}% of prior-week value workspaces produced value again this week.",
            "action": "Interview retained vs one-off users and strengthen the recurring workflow that brings teams back.",
            "guardrail": "Retention has priority over top-of-funnel growth once the sample is meaningful.",
        })

    if signal_to_ticket["denominator"] >= 10 and (signal_to_ticket["pct"] or 0) < 25:
        steering.append({
            "priority": "P1",
            "area": "Core loop",
            "title": "Captured signals are not entering delivery",
            "reason": f"Only {signal_to_ticket['pct']}% of new feedback/error groups are linked to tickets.",
            "action": "Inspect triage/conversion friction and clarify the next action directly where the signal appears.",
            "guardrail": "Do not count raw feedback volume as success if it dies before engineering action.",
        })

    if (
        paid_conversion["denominator"] >= 20
        and (paid_conversion["pct"] or 0) < 3
        and (activation["pct"] or 0) >= 50
    ):
        steering.append({
            "priority": "P1",
            "area": "Monetization",
            "title": "Value reaches users but rarely converts to payment",
            "reason": f"Paid conversion is {paid_conversion['pct']}% across {paid_conversion['denominator']} eligible workspaces.",
            "action": "Test packaging, paywall timing, pricing clarity and checkout confidence before changing the core product.",
            "guardrail": "First verify retained value is healthy; low payment with low retention is a product-value problem, not only pricing.",
        })

    if (
        signups_previous >= 5
        and signups_current < signups_previous * 0.7
        and (activation["pct"] or 0) >= 50
        and (repeat_value["pct"] or 0) >= 30
    ):
        steering.append({
            "priority": "P2",
            "area": "Distribution",
            "title": "Core loop looks usable; reach is falling",
            "reason": f"Weekly signups changed {reach_change}% while activation/return remain comparatively healthy.",
            "action": "Increase distribution experiments and source attribution rather than adding product surface area.",
            "guardrail": "Scale one acquisition source at a time so attribution stays interpretable.",
        })

    low_sample_keys = [item["label"] for item in dimensions if item["confidence"] == "low" and item["key"] != "learn"]
    if low_sample_keys:
        steering.append({
            "priority": "P2",
            "area": "Evidence",
            "title": "Keep launch controlled until the sample can steer you",
            "reason": "Low-confidence dimensions: " + ", ".join(low_sample_keys[:5]),
            "action": "Prefer interviews, session observation and small experiments; avoid large pricing/growth pivots from tiny cohorts.",
            "guardrail": "A red-looking metric with <10 observations is a question, not a conclusion.",
        })

    if coverage_pct < 70:
        steering.append({
            "priority": "P2",
            "area": "Instrumentation",
            "title": "Close the highest-value blind spots",
            "reason": f"Only {coverage_pct}% of the planned steering signal map is instrumented.",
            "action": "Prioritize landing/source, onboarding drop-off, checkout abandonment and platform SLO telemetry.",
            "guardrail": "Use bounded event names and avoid collecting free-form user content for analytics.",
        })

    if not steering:
        steering.append({
            "priority": "P3",
            "area": "Steady course",
            "title": "No launch-level intervention is indicated",
            "reason": "Measured guardrails are within their current steering bands and samples are usable.",
            "action": "Hold the product direction, run one hypothesis at a time and watch the next weekly cohort.",
            "guardrail": "Do not optimize every metric simultaneously; preserve causal learning.",
        })

    priority_order = {"P0": 0, "P1": 1, "P2": 2, "P3": 3}
    steering.sort(key=lambda item: priority_order[item["priority"]])

    guardrails = [
        {
            "key": "revenue_integrity",
            "label": "Revenue integrity",
            "status": "intervene" if pending_payments or fiscal_attention else "healthy",
            "detail": f"pending>15m={pending_payments}; fiscal_attention={fiscal_attention}; refunds_30d={refunds_30d}",
            "confidence": "high",
        },
        {
            "key": "consent_integrity",
            "label": "Consent record completeness",
            "status": "intervene" if consent_missing else "healthy",
            "detail": f"users missing Terms/Privacy version={consent_missing}",
            "confidence": "high",
        },
        {
            "key": "platform_slo",
            "label": "Hosted VibeUs availability / latency / 5xx",
            "status": "unknown",
            "detail": "Not yet stored as founder metrics. Customer runtime errors are deliberately excluded from this platform-health judgement.",
            "confidence": "none",
        },
        {
            "key": "support_load",
            "label": "Support load and repeated confusion",
            "status": "unknown",
            "detail": "Internal support contact/SLA events are not yet captured.",
            "confidence": "none",
        },
        {
            "key": "provider_contract",
            "label": "Live payment-provider readiness",
            "status": "manual",
            "detail": "Configuration flags cannot prove merchant approval, geography, recurring support or fiscal contract readiness. Keep this a human launch gate.",
            "confidence": "manual",
        },
    ]

    north_star_change = _change_pct(len(value_current), len(value_previous))
    north_star_confidence = _confidence(max(len(value_current), len(value_previous)))

    return {
        "generated_at": now.isoformat(),
        "phase": "launch",
        "score_method": "Radar score is target attainment for steering, not an industry benchmark. Low-sample dimensions are marked insufficient and must not drive large pivots.",
        "decision_order": [
            "P0 protect trust, money, legal/fiscal integrity",
            "P1 repair activation, time-to-value, repeat value and the core delivery loop",
            "P2 scale distribution only after the core loop is credible",
            "P3 optimize deliberately, one hypothesis at a time",
        ],
        "north_star": {
            "key": "weekly_value_workspaces",
            "label": "Weekly Value Workspaces",
            "value": len(value_current),
            "previous": len(value_previous),
            "change_abs": len(value_current) - len(value_previous),
            "change_pct": north_star_change,
            "confidence": north_star_confidence,
            "definition": "Distinct workspaces with at least one captured feedback item or runtime-error occurrence in the last 7 days.",
            "why": "It measures whether VibeUs is producing the product's core value, not merely attracting logins.",
        },
        "dimensions": dimensions,
        "steering_queue": steering[:6],
        "value_loop": [
            {"key": "signup", "label": "Signups", "value": signups_current, "unit": "users / 7d"},
            {"key": "activate", "label": "Activated ≤24h", "value": activation["numerator"], "unit": "users / 7d"},
            {"key": "value", "label": "Value workspaces", "value": len(value_current), "unit": "workspaces / 7d"},
            {"key": "signals", "label": "New signals", "value": feedback_7d + new_error_groups_7d, "unit": "feedback + error groups / 7d"},
            {"key": "tickets", "label": "Tickets created", "value": tickets_7d, "unit": "tickets / 7d"},
            {"key": "accepted", "label": "Human accepted", "value": human_acceptances_7d, "unit": "tickets / 7d"},
            {"key": "paid", "label": "New paid workspaces", "value": paid_workspaces_7d, "unit": "workspaces / 7d"},
        ],
        "leading_indicators": {
            "signup_growth_pct": reach_change,
            "activation_24h": activation,
            "first_value": first_value,
            "repeat_value": repeat_value,
            "signal_to_ticket": signal_to_ticket,
        },
        "lagging_indicators": {
            "paid_conversion": paid_conversion,
            "payment_success": payment_success,
            "refunds_30d": refunds_30d,
        },
        "guardrails": guardrails,
        "data_coverage": {
            "measured": len(MEASURED_SIGNALS),
            "total": total_signals,
            "pct": coverage_pct,
            "measured_signals": MEASURED_SIGNALS,
            "gaps": MISSING_SIGNALS,
            "privacy_rule": "Prefer first-party bounded event names and IDs; do not collect free-form user content merely for founder analytics.",
        },
        "viewer": user.email,
    }
