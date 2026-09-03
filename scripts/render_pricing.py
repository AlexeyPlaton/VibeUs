#!/usr/bin/env python3
"""Render the public pricing Markdown from the same env values used by VibeUs billing.

Static Markdown cannot read process environment at request time, so production UI
uses GET /api/public/pricing directly. This script keeps repository/release docs in
sync with a selected .env file and can fail CI when a generated file is stale.
"""
from __future__ import annotations

import argparse
from decimal import Decimal, InvalidOperation
from pathlib import Path

DEFAULTS = {
    "BILLING_PERIOD_DAYS": "30",
    "PRICE_RUB_SOLO": "1490.00",
    "PRICE_RUB_STUDIO": "4990.00",
    "PRICE_USD_SOLO": "29.00",
    "PRICE_USD_STUDIO": "79.00",
    "PRICING_DEFAULT_MARKET": "ru",
    "ENABLE_GLOBAL_PRICING": "false",
}


def parse_env(path: Path) -> dict[str, str]:
    values = dict(DEFAULTS)
    if not path.exists():
        raise SystemExit(f"Env file not found: {path}")
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        if key in values:
            values[key] = value.strip().strip('"').strip("'")
    return values


def money(value: str, currency: str) -> str:
    try:
        d = Decimal(value)
    except InvalidOperation as exc:
        raise SystemExit(f"Invalid {currency} price: {value}") from exc
    if d <= 0:
        raise SystemExit(f"Price must be positive: {value}")
    whole = int(d.quantize(Decimal("1")))
    if currency == "RUB":
        return f"{whole:,}".replace(",", " ") + " ₽"
    return f"${whole:,}"


def render(values: dict[str, str], source: str) -> str:
    days = int(values["BILLING_PERIOD_DAYS"])
    global_enabled = values["ENABLE_GLOBAL_PRICING"].lower() in {"1", "true", "yes", "on"}
    return f"""# VibeUs pricing — generated\n\n> GENERATED FILE. Do not edit prices here.\n> Source: `{source}`. Runtime UI and payment code use the backend pricing catalog exposed by `GET /api/public/pricing`.\n\n| Market | Free | Solo | Studio | Access period |\n|---|---:|---:|---:|---:|\n| Russia / RUB | 0 ₽ | {money(values['PRICE_RUB_SOLO'], 'RUB')} | {money(values['PRICE_RUB_STUDIO'], 'RUB')} | {days} days |\n| International / USD | $0 | {money(values['PRICE_USD_SOLO'], 'USD')} | {money(values['PRICE_USD_STUDIO'], 'USD')} | {days} days |\n\n- Default market: `{values['PRICING_DEFAULT_MARKET']}`.\n- International pricing visible: `{'yes' if global_enabled else 'no'}`.\n- Paid access uses manual {days}-day activation/renewal unless a separate recurring product is explicitly introduced later.\n- Project limits are defined by the application entitlement catalog (Free 1 / Solo 10 / Studio 50).\n\n## Change procedure\n\n1. Change pricing only in the deployment env (`PRICE_RUB_*`, `PRICE_USD_*`, `BILLING_PERIOD_DAYS`).\n2. Restart/redeploy the API so `/api/public/pricing` reflects the new catalog.\n3. Regenerate this file:\n   `python scripts/render_pricing.py --env-file .env.production`\n4. Run the release gate. Frontend source must not contain duplicated numeric paid prices.\n"""


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--env-file", default="deploy/env.production.example")
    parser.add_argument("--output", default="docs/pricing.generated.md")
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()

    env_path = Path(args.env_file)
    out_path = Path(args.output)
    content = render(parse_env(env_path), args.env_file)
    if args.check:
        current = out_path.read_text(encoding="utf-8") if out_path.exists() else ""
        if current != content:
            print(f"STALE: {out_path}. Regenerate from {env_path}.")
            return 1
        print(f"OK: {out_path} matches {env_path}")
        return 0

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(content, encoding="utf-8")
    print(f"Wrote {out_path} from {env_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
