from types import SimpleNamespace
from pathlib import Path
import sys

CORE = Path(__file__).resolve().parents[3] / "openspec-core"
if str(CORE) not in sys.path:
    sys.path.insert(0, str(CORE))

from criteria_evidence import (
    criteria_auto_review_ready,
    criteria_contract_fingerprint,
    receipt_matches_contract,
    sign_criteria_receipt,
    validated_machine_receipt,
)

KEY = "Refund ledger proof"
CONTRACT = {
    "id": "BILLING_REFUND_LEDGER",
    "severity": "blocker",
    "requirement": "Refund accounting remains durable and idempotent.",
    "verification": {"adapter": "pytest", "target": "tests/test_refund.py::test_refund", "passCondition": "pytest exits 0"},
}


def machine_receipt(**overrides):
    value = {
        "criterion_key": KEY,
        "criterion_id": CONTRACT["id"],
        "contract_sha256": criteria_contract_fingerprint(KEY, CONTRACT),
        "provenance": "local_cli",
        "adapter": "pytest",
        "target": "tests/test_refund.py::test_refund",
        "verifier": "vibus-cli-v6.2",
        "started_at": "2026-09-02T00:00:00Z",
        "completed_at": "2026-09-02T00:00:01Z",
        "verified": True,
        "result": "PASS",
        "exit_code": 0,
        "timed_out": False,
    }
    value.update(overrides)
    return sign_criteria_receipt(value)


def test_contract_fingerprint_is_stable_across_backend_and_js_contract():
    parity = {
        "id": "BILLING_REFUND_LEDGER",
        "severity": "blocker",
        "requirement": "Refund accounting remains durable and idempotent.",
        "verification": {"adapter": "pytest", "target": "tests/test_refund.py::test_refund", "passCondition": "pytest exits 0"},
    }
    assert criteria_contract_fingerprint(KEY, parity) == "8e36db4591ac669bf2ef190d4b654bde8c2b532a6b5c06551e48661e72ff3ce6"


def test_valid_machine_receipt_is_bound_to_exact_contract():
    receipt = machine_receipt()
    assert receipt_matches_contract(KEY, CONTRACT, receipt)
    key, safe = validated_machine_receipt({"key": KEY, "receipt": receipt}, CONTRACT)
    assert key == KEY
    assert safe["contract_sha256"] == criteria_contract_fingerprint(KEY, CONTRACT)


def test_substitution_attacks_fail_even_with_recomputed_digest():
    assert not receipt_matches_contract(KEY, CONTRACT, machine_receipt(adapter="file_exists", target="README.md"))
    assert not receipt_matches_contract(KEY, CONTRACT, machine_receipt(target="tests/test_other.py"))
    assert not receipt_matches_contract(KEY, CONTRACT, machine_receipt(criterion_id="OTHER"))
    assert not receipt_matches_contract(KEY, CONTRACT, machine_receipt(criterion_key="Other key"))


def test_stale_contract_fingerprint_and_replay_fail():
    receipt = machine_receipt()
    changed = {**CONTRACT, "requirement": CONTRACT["requirement"] + " Include cumulative partial refunds."}
    assert criteria_contract_fingerprint(KEY, changed) != receipt["contract_sha256"]
    assert not receipt_matches_contract(KEY, changed, receipt)


def test_legacy_v61_shape_is_not_trusted():
    legacy = {"verified": True, "result": "PASS", "adapter": "pytest", "receipt_sha256": "a" * 64}
    assert not receipt_matches_contract(KEY, CONTRACT, legacy)


def test_exit_code_and_timeout_are_part_of_machine_evidence_semantics():
    assert not receipt_matches_contract(KEY, CONTRACT, machine_receipt(exit_code=1))
    assert not receipt_matches_contract(KEY, CONTRACT, machine_receipt(timed_out=True))


def test_human_receipt_is_server_bound_and_machine_endpoint_does_not_accept_it():
    human = sign_criteria_receipt({
        "criterion_key": KEY,
        "criterion_id": CONTRACT["id"],
        "contract_sha256": criteria_contract_fingerprint(KEY, CONTRACT),
        "provenance": "human_review",
        "adapter": "human_review",
        "target": "browser-session",
        "verifier": "user:abc",
        "verified": True,
        "result": "PASS",
    })
    assert receipt_matches_contract(KEY, CONTRACT, human)
    try:
        validated_machine_receipt({"key": KEY, "receipt": human}, CONTRACT)
    except ValueError:
        pass
    else:
        raise AssertionError("machine evidence endpoint accepted human_review receipt")


def test_review_policy_revalidates_receipt_against_current_contract():
    ticket = SimpleNamespace(
        quality_mode="strict",
        checklists={KEY: True},
        criteria_contract={KEY: CONTRACT},
        criteria_evidence={KEY: machine_receipt()},
    )
    assert criteria_auto_review_ready(ticket) == (True, [])
    ticket.criteria_evidence = {KEY: machine_receipt(target="tests/test_other.py")}
    ready, missing = criteria_auto_review_ready(ticket)
    assert ready is False and KEY in missing
