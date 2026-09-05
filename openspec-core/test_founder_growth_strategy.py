from __future__ import annotations

import pytest
from pydantic import ValidationError

import founder_growth_strategy as growth


def definition(**overrides):
    data = {
        "key": "article_one",
        "wave": 1,
        "phase": "Learning",
        "priority": 10,
        "kind": "publication",
        "channel": "Private channel placeholder",
        "market": "test",
        "title": "Private strategy item",
        "goal": "Validate the workflow",
        "trigger": "After a measured signal",
        "planned": "A founder-only planned brief",
        "format": "Article",
        "preflight": ["Check current rules"],
        "success_signal": "Measured product value",
        "destination": "",
        "rules_note": "Current third-party rules win",
    }
    data.update(overrides)
    return growth.StrategyDefinition(**data)


def test_import_rejects_duplicate_private_strategy_keys():
    item = definition()
    with pytest.raises(ValidationError):
        growth.StrategyImportRequest(items=[item, item])


def test_actual_completion_evidence_closes_card_automatically():
    source = definition().model_dump(mode="json")

    preparing = growth.merge_strategy_item(source, {"workflow_state": "preparing", "actual": ""})
    assert preparing["status"] == "preparing"

    done = growth.merge_strategy_item(
        source,
        {
            "workflow_state": "preparing",
            "actual": "The founder pasted the actual published/completed content.",
            "link": "https://example.test/result",
            "completed_at": "2026-09-05T10:00:00",
        },
    )
    assert done["status"] == "done"
    assert done["completed_at"] == "2026-09-05T10:00:00"


def test_clearing_actual_reopens_card_to_saved_workflow_state():
    source = definition().model_dump(mode="json")
    reopened = growth.merge_strategy_item(
        source,
        {"workflow_state": "preparing", "actual": ""},
    )
    assert reopened["status"] == "preparing"


def test_markdown_contains_radar_plan_actual_evidence_and_ai_guardrails():
    source = definition().model_dump(mode="json")
    item = growth.merge_strategy_item(
        source,
        {
            "workflow_state": "preparing",
            "actual": "Final founder-entered publication text.",
            "link": "https://example.test/article",
            "result": "Observed three qualified replies.",
            "completed_at": "2026-09-05T12:00:00",
        },
    )
    payload = {
        "generated_at": "2026-09-05T12:10:00",
        "items": [item],
        "counts": {"todo": 0, "preparing": 0, "done": 1, "skipped": 0},
        "total": 1,
        "needs_import": False,
        "next": [],
        "radar": {
            "north_star": {"name": "Weekly Value Workspaces", "value": 3, "previous": 1, "change_pct": 200, "confidence": "medium"},
            "dimensions": [{"label": "Activate", "status": "watch", "value": 50, "unit": "%", "score": 60, "confidence": "medium", "sample": 8, "trend_pct": 10, "target": ">=60%"}],
            "steering_queue": [{"priority": "P1", "area": "Activation", "title": "Improve first value", "reason": "sample signal", "action": "observe onboarding", "guardrail": "do not scale reach yet"}],
            "guardrails": [],
            "data_coverage": {"pct": 80},
        },
    }

    markdown = growth.render_strategy_markdown(payload)
    assert "# VibeUs Founder Strategy + Product Radar" in markdown
    assert "Weekly Value Workspaces" in markdown
    assert "- [x]" in markdown
    assert "founder-entered" in markdown.lower()
    assert "Final founder-entered publication text." in markdown
    assert "https://example.test/article" in markdown
    assert "Observed three qualified replies." in markdown
    assert "do not scale reach yet" in markdown
    assert "impression" in markdown.lower()


def test_empty_private_strategy_markdown_is_explicit_not_fake_seed_data():
    payload = {
        "generated_at": "2026-09-05T12:10:00",
        "items": [],
        "counts": {"todo": 0, "preparing": 0, "done": 0, "skipped": 0},
        "total": 0,
        "needs_import": True,
        "next": [],
        "radar": {"north_star": {}, "dimensions": [], "steering_queue": [], "guardrails": [], "data_coverage": {}},
    }
    markdown = growth.render_strategy_markdown(payload)
    assert "No private strategy pack has been imported yet" in markdown
    assert "definitions are not bundled in the public repository" in markdown


def test_module_does_not_ship_a_concrete_private_strategy_catalog():
    assert not hasattr(growth, "GROWTH_STRATEGY")
