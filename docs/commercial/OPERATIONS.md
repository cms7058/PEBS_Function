# PEBS account and commerce operations

This release adds real accounts, server-enforced per-account projects/private books/skills, membership records, email verification and payment adapters. The local app remains bound to localhost; it has not been published or enabled for real payment acceptance.

## First administrator

Start the application and open “初始化管理员 / Set up administrator”. Read `data/accounts/bootstrap-token` locally, enter it in the setup form and choose your own email/password. The token is never returned by an API. Setup is disabled once an administrator exists. Existing engineering projects are copied to this administrator's tenant after a backup in `data/accounts/legacy-projects-backup`. The platform catalog remains restricted to administrators. No default password is created.

## Storage and deployment

Local development uses a transactional SQLite ledger under `data/accounts/accounts.sqlite3`, with private file permissions. Set `DATABASE_URL=postgresql://...` to use PostgreSQL with the same schema; install dependencies from `scripts/service-requirements.txt` in the Python runtime used by the service. The PostgreSQL adapter is implemented but has not been exercised against a live PostgreSQL server in this local installation. Use PostgreSQL, managed backups, TLS and persistent tenant storage before multi-instance production deployment. File stores and background workers currently run in one service instance; use a single application instance until shared object storage and distributed job coordination are introduced.

Set `APP_ENV=production` and `APP_URL=https://your-domain`. Production cookies require HTTPS. The reverse proxy should serve built frontend assets and route `/api` to the Rust service. Raw book PDFs must not be served as static files: the legacy `public/handbook.pdf` was moved to `data/platform-source/handbook.pdf` and all reading now requires authenticated API requests. Do not expose `data/`, environment files, private configuration or backups over HTTP.

## Email

Configure SMTP host, port, username, password, sender address and SSL/STARTTLS in Administration → Email & payments. Register and reset codes expire after five minutes, are single-use, allow at most five incorrect attempts, and are rate-limited. Configure your domain's SPF/DKIM/DMARC with the email provider before launch.

Environment variables take precedence over saved configuration. Prefix the configuration names with `PEBS_`, for example `PEBS_SMTP_HOST`, `PEBS_SMTP_PORT`, `PEBS_SMTP_USER`, `PEBS_SMTP_PASSWORD`, `PEBS_SMTP_FROM`, `PEBS_SMTP_SECURITY`. Test-only `PEBS_MAIL_MODE=file` writes codes to a private outbox and is rejected in production; it is not enabled for the user's normal installation.

## Membership and credits

The public catalog has two plans. In Chinese, normal is ¥159/month or ¥1590/year and high is ¥599/month or ¥5990/year. In English, the same plans are $19/month or $190/year and $99/month or $990/year. normal includes the normal skill tier; high includes normal + high. Ultra remains only as a disabled legacy record and cannot be purchased. An administrator can edit both CNY and USD prices, quotas and availability. Orders keep the exact plan snapshot, amount and currency at creation.

New verified users receive 20 credits valid for seven days. Initial monthly credit allowances are normal 150 and high 600; normal has 10 project spaces and 1024 MB private storage, while high has 50 project spaces and 4096 MB private storage. These are operator-controlled pilot settings and need provider-cost validation before commercial launch. Guidance, material generation and skill application reserve two credits. Book skill generation reserves `ceil((estimated_input_tokens + estimated_output_tokens)/2000)`, minimum two. The estimate is shown before confirmation. These are product credits, not a claim to charge exact provider token usage. Annual membership renews analysis credits monthly. Credits do not accumulate. Renewal extends the same tier without resetting current credits. In-term tier changes require operator handling. Expired accounts retain data access/export; new AI tasks are blocked. No automatic recurring debit is implemented.

Failed tasks release credits. Running tasks interrupted by a service restart are marked failed and their reserved credits are released during startup. Do not use local Codex as the user-facing production model service. It remains available for administrator authoring; regular user AI requests require a configured server model API.

## Payment adapters

No public “mark paid” or simulated-success endpoint exists. Membership is opened only after signed payment notifications match the immutable order amount, currency, channel and merchant/session identity. Notifications are idempotent. Unconfigured channels cannot create payable orders.

- WeChat Native Pay: configure app ID, merchant ID, merchant certificate serial, RSA merchant private key, API v3 key, and a pinned platform public key/certificate with its serial. Register `https://your-domain/api/payments/webhook/wechat`. Rotate the pinned platform key when WeChat rotates it; otherwise signatures are rejected. This adapter uses the public-key/certificate notification verification mode configured by the merchant.
- Alipay web checkout: configure app ID, RSA2 private key and Alipay public key. Register `https://your-domain/api/payments/webhook/alipay`. Use the public-key integration mode. Certificate-mode apps need a certificate-mode adapter before use.
- Apple Pay: use Stripe-hosted Checkout with the operator's eligible Stripe account; configure its secret key and webhook signing secret. Register `https://your-domain/api/payments/webhook/applepay` for `checkout.session.completed` and `checkout.session.async_payment_succeeded`. Apple Pay appears only on eligible devices/cards and for eligible merchant regions; hosted checkout can also offer cards. This is web payment, not StoreKit/iOS in-app purchase integration.

Complete merchant onboarding, select supported currencies/regions and test real provider sandbox notifications before accepting payments. Administration supports recording an externally completed full refund with its receipt and reason, preserving refund history and restoring the corresponding membership snapshot. It cannot transfer funds; complete the refund in the payment provider first. Older orders with later purchases or manually modified membership require separate reconciliation. Automated provider refunds are not enabled. Never regard the browser's return URL as proof of payment.

## Launch requirements still outside local configuration

Supply the operator's legal entity, support email/contact, retention policy and final refund terms in the public terms/privacy text. Verify rights for commercial book processing and any sharing of source materials. Configure provider data-processing agreements and disclose where model requests are processed. Replace local file stores/background job coordination for multi-instance operation. Complete real SMTP delivery and provider sandbox checkout/refund tests. Reconfirm separate iOS purchase requirements when developing the app.

## Verification

`python3 scripts/check_accounts.py` uses an isolated store to check OTP expiry/consumption, roles, session revocation, credit reservation/release, signed Stripe events, amount mismatch, payment replay and membership rollover. `python3 scripts/check_commerce_api.py` starts a temporary localhost server to verify HTTP authorization, per-account project/book separation, source hiding, CSRF, payment unavailability and administrator access. Neither sends real email nor pays real money. Rust regression tests still validate all five supported regression models.
