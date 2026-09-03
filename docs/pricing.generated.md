# VibeUs pricing — generated

> GENERATED FILE. Do not edit prices here.
> Source: `deploy/env.production.example`. Runtime UI and payment code use the backend pricing catalog exposed by `GET /api/public/pricing`.

| Market | Free | Solo | Studio | Access period |
|---|---:|---:|---:|---:|
| Russia / RUB | 0 ₽ | 1 490 ₽ | 4 990 ₽ | 30 days |
| International / USD | $0 | $29 | $79 | 30 days |

- Default market: `ru`.
- International pricing visible: `no`.
- Paid access uses manual 30-day activation/renewal unless a separate recurring product is explicitly introduced later.
- Project limits are defined by the application entitlement catalog (Free 1 / Solo 10 / Studio 50).

## Change procedure

1. Change pricing only in the deployment env (`PRICE_RUB_*`, `PRICE_USD_*`, `BILLING_PERIOD_DAYS`).
2. Restart/redeploy the API so `/api/public/pricing` reflects the new catalog.
3. Regenerate this file:
   `python scripts/render_pricing.py --env-file .env.production`
4. Run the release gate. Frontend source must not contain duplicated numeric paid prices.
