# VibeUs production deployment contract

1. `vibeus.pro` (or your chosen main hostname) serves the account UI and API.
2. Live Preview uses a **different registrable domain**, e.g. `vibeus-preview.net`.
3. The current realtime/tunnel managers are process-local. Run **one** VibeUs
   application worker until Redis-backed connection/tunnel routing exists.
4. PostgreSQL, backups, logs, object storage, queues/caches that contain RF
   personal data must be included in the RF localization/data map review.
5. Set `BILLING_TAX_MODE` to the merchant's real fiscal model. For the NPD
   launch use `npd`: do not send a 54-FZ receipt block to YooKassa; after each
   successful payment register the income and issue the buyer receipt in
   `Мой налог`. `YOOKASSA_VAT_CODE` and `YOOKASSA_PAYMENT_SUBJECT` are required
   only for `BILLING_TAX_MODE=kkt_54fz`.
6. Do not enable external AI data sharing or foreign observability by default.
7. Apply Alembic migrations before starting the application.
8. Run the release gate documented in `RELEASE_IMPLEMENTATION_GUIDE.md`.
9. Treat pricing as deployment configuration, not frontend constants. Copy the
   `BILLING_PERIOD_DAYS`, `PRICING_*`, `PRICE_RUB_*` and `PRICE_USD_*` values
   from the maintained environment template into the actual `.env.production`.
10. Before release, render/check the static pricing reference against that same
    env file: `python scripts/render_pricing.py --env-file .env.production` and
    `python scripts/render_pricing.py --env-file .env.production --check`. Runtime
    UI reads `/api/public/pricing` directly, so no Vite rebuild-time price copy is
    required for amount consistency.

## Current scaling rule

Use:

```bash
uvicorn main:app --host 0.0.0.0 --port 8000 --workers 1
```

Do **not** increase workers behind a load balancer yet: active WebSocket and
Live Preview tunnel state is held in process memory in this release candidate.

## NPD receipt operations

For a self-employed NPD deployment, fiscal state is operator-controlled, not customer-controlled.

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml exec api \
  python manage_receipts.py list

docker compose --env-file .env.production -f docker-compose.prod.yml exec api \
  python manage_receipts.py issue --payment-id <PAYMENT_UUID> \
  --receipt-url 'https://lknpd.nalog.ru/.../print'
```

The `issue` command accepts only successful NPD payments and records an audit event.
