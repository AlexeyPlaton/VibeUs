from __future__ import annotations

import hashlib
import json
from typing import Any

SAFE_CRITERIA_ADAPTERS = {"pytest", "node_test", "npm_script", "file_exists"}
TRUSTED_CRITERIA_EVIDENCE_ADAPTERS = SAFE_CRITERIA_ADAPTERS | {"human_review"}
LOCAL_VERIFIER_ID = "vibus-cli-v6.2"


def _canonical_bytes(value: dict[str, Any]) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def criterion_requires_verified_evidence(contract: dict, quality_mode: str) -> bool:
    if quality_mode == "standard":
        return False
    severity = str((contract or {}).get("severity") or "normal").lower()
    return severity in {"blocker", "high"}


def contract_binding_material(key: str, contract: dict) -> dict[str, str]:
    contract = contract or {}
    verification = contract.get("verification") if isinstance(contract.get("verification"), dict) else {}
    return {
        "criterion_key": str(key),
        "criterion_id": str(contract.get("id") or key),
        "severity": str(contract.get("severity") or "normal").lower(),
        "requirement": str(contract.get("requirement") or ""),
        "pass_condition": str(verification.get("passCondition") or verification.get("pass_condition") or ""),
        "adapter": str(verification.get("adapter") or "").strip(),
        "target": str(verification.get("target") or "").strip(),
    }


def criteria_contract_fingerprint(key: str, contract: dict) -> str:
    return hashlib.sha256(_canonical_bytes(contract_binding_material(key, contract))).hexdigest()


def sign_criteria_receipt(receipt: dict) -> dict:
    unsigned = dict(receipt)
    unsigned.pop("receipt_sha256", None)
    return {**unsigned, "receipt_sha256": hashlib.sha256(_canonical_bytes(unsigned)).hexdigest()}


def _digest_is_valid(receipt: dict) -> bool:
    digest = str(receipt.get("receipt_sha256") or "").lower()
    if len(digest) != 64 or any(ch not in "0123456789abcdef" for ch in digest):
        return False
    unsigned = {k: v for k, v in receipt.items() if k != "receipt_sha256"}
    return hashlib.sha256(_canonical_bytes(unsigned)).hexdigest() == digest


def receipt_matches_contract(key: str, contract: dict, receipt: dict) -> bool:
    if not isinstance(contract, dict) or not isinstance(receipt, dict) or not _digest_is_valid(receipt):
        return False
    expected = contract_binding_material(key, contract)
    if str(receipt.get("criterion_key") or "") != expected["criterion_key"]:
        return False
    if str(receipt.get("criterion_id") or "") != expected["criterion_id"]:
        return False
    if str(receipt.get("contract_sha256") or "").lower() != criteria_contract_fingerprint(key, contract):
        return False
    if receipt.get("verified") is not True or receipt.get("result") != "PASS":
        return False

    adapter = str(receipt.get("adapter") or "")
    provenance = str(receipt.get("provenance") or "")
    if adapter == "human_review":
        return provenance == "human_review" and str(receipt.get("verifier") or "").startswith("user:")

    if adapter not in SAFE_CRITERIA_ADAPTERS:
        return False
    if adapter != expected["adapter"] or str(receipt.get("target") or "") != expected["target"]:
        return False
    if provenance != "local_cli" or receipt.get("verifier") != LOCAL_VERIFIER_ID:
        return False
    if receipt.get("exit_code") != 0 or receipt.get("timed_out") is True:
        return False
    return True


def criteria_auto_review_ready(ticket) -> tuple[bool, list[str]]:
    checklists = dict(getattr(ticket, "checklists", None) or {})
    if not checklists or any(value is not True for value in checklists.values()):
        return False, ["all DoD items must be claimed complete"]
    quality_mode = str(getattr(ticket, "quality_mode", None) or "strict").lower()
    if quality_mode == "standard":
        return True, []
    contracts = dict(getattr(ticket, "criteria_contract", None) or {})
    evidence = dict(getattr(ticket, "criteria_evidence", None) or {})
    missing: list[str] = []
    for key in checklists:
        contract = contracts.get(key) or {}
        if not criterion_requires_verified_evidence(contract, quality_mode):
            continue
        if not receipt_matches_contract(key, contract, evidence.get(key) or {}):
            missing.append(key)
    return not missing, missing


def validated_machine_receipt(payload: dict, contract: dict) -> tuple[str, dict]:
    key = str(payload.get("key") or "").strip()
    receipt = payload.get("receipt")
    if not key or len(key) > 500 or not isinstance(receipt, dict):
        raise ValueError("invalid evidence payload")
    adapter = str(receipt.get("adapter") or "")
    if adapter not in SAFE_CRITERIA_ADAPTERS:
        raise ValueError("verification adapter is not allowlisted")
    if not receipt_matches_contract(key, contract, receipt):
        raise ValueError("evidence receipt is not bound to the current criterion contract")
    safe_fields = (
        "criterion_key", "criterion_id", "contract_sha256", "provenance", "adapter", "target", "verifier",
        "started_at", "completed_at", "verified", "result", "exit_code", "observed", "stdout", "stderr",
        "timed_out", "repo_head", "repo_dirty", "repo_fingerprint", "receipt_sha256",
    )
    return key, {k: receipt.get(k) for k in safe_fields if k in receipt}
