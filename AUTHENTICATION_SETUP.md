# DracoWorld authentication setup

The storefront remains plain HTML, CSS, and browser JavaScript. The Node.js/Express service serves those existing files and provides the `/api` endpoints. PostgreSQL stores customer accounts, membership, invitations, sessions, customer data, and token/rate-limit records. Keep the website and API on the same HTTPS origin so the session cookie is first-party.

## Local setup

Requirements: Node.js 20+, PostgreSQL 13+, and an SMTP account for verification, reset, and invitation email.

1. Copy `.env.example` to `.env` and set `DATABASE_URL`, `PUBLIC_ORIGIN`, and the SMTP settings. Never commit `.env`.
2. Install dependencies with `npm install`.
3. Apply the database migration with `npm run migrate`.
4. Start the website and API with `npm start`, then open the configured origin.

The API will return `503` for email-dependent actions until SMTP is configured. The database migration is not run automatically during server startup.

The integration test requires a separate, disposable PostgreSQL database whose name contains `test`. Apply the migration with `DATABASE_URL` set to that database, then set `TEST_DATABASE_URL` to the same URL and run `npm test`. The test creates and removes its own fixture records.

## Environment

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string; provide it through the deployment secret manager. |
| `PUBLIC_ORIGIN` | Exact public origin, including scheme and port when needed. Used for origin checks and email links. |
| `RATE_LIMIT_SECRET` | At least 32 random bytes, shared by all API instances, used to HMAC database rate-limit keys. |
| `NODE_ENV` | Set to `production` behind HTTPS to enable secure `__Host-` cookies. |
| `PORT` | Express listening port. |
| `TRUST_PROXY` | Set to `true` only when deployed behind a trusted single-hop reverse proxy. |
| `SESSION_TTL_HOURS` | Session lifetime, bounded by the server to 1–720 hours. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | SMTP transport and sender identity. |
| `DATABASE_SSL` | Set to `true` when the PostgreSQL provider requires verified TLS. |

For the approved Cloudflare Pages + Render architecture, follow [DEPLOYMENT.md](./DEPLOYMENT.md). The Pages Function proxies `/api/*` on the storefront origin to the fixed server-side Render origin; do not point browser requests directly at a separate cross-origin API.

Generate `RATE_LIMIT_SECRET` with a cryptographically secure random generator (for example, Node's `crypto.randomBytes(32)`) and store it in the deployment secret manager.

## Database and initial administrator

`migrations/001_initial_auth.sql` creates the customer, membership-tier, session, invitation, email-verification, password-reset, address, wishlist, order, pre-order, and database-backed rate-limit tables. Public registrations receive the `standard` tier. Additional invitation-authorized tiers can be added by a trusted database operator, for example:

```sql
INSERT INTO membership_tiers (code, name, description, invitation_assignable)
VALUES ('premium', 'Premium', 'Approved DracoWorld membership', TRUE);
```

There is deliberately no default administrator. First create and verify an account, then have a trusted operator grant administrator access directly in the database:

```sql
UPDATE customers
SET role = 'admin', updated_at = now()
WHERE lower(email) = lower('verified-admin@example.com')
  AND email_verified_at IS NOT NULL;
```

Confirm exactly one row was updated. Administrator invitation tools are at `/admin.html`; both the page and API require an authenticated `admin` role. Customers cannot set their own role or membership tier through account APIs.

## Email and account flow

- Public registration creates an unverified account on the `standard` tier and emails a 24-hour, one-use verification link.
- Invitation links are random, stored only as hashes, expire at the administrator-selected time (maximum 90 days), and can only be accepted once.
- Password reset links are random, hashed in the database, expire after one hour, and revoke existing sessions when used.
- SMTP delivery errors are surfaced to the requesting user and logged without logging tokens or credentials.

The browser uses `POST /api/auth/register`, `POST /api/auth/login`, and `POST /api/auth/logout`; verification is completed by the emailed `/api/auth/verify?token=...` link. Password recovery uses `POST /api/auth/password-reset/request` and `POST /api/auth/password-reset/confirm`. Invitation acceptance uses `GET /api/auth/invitations/:token` and `POST /api/auth/invitations/:token/accept`. The signed-in dashboard reads `/api/me/dashboard`; administrator invitation management is under `/api/admin/invitations`.

## Deployment checks

- Configure PostgreSQL backups, TLS, restricted network access, and a least-privilege database user before serving customers.
- Configure SMTP sender authentication and verify delivery to the public site origin before enabling registration.
- Use HTTPS in production; the session cookie is `HttpOnly`, `Secure`, and `SameSite=Lax`. The CSRF cookie is `SameSite=Strict`, and state-changing requests also require a matching origin and CSRF header.
- The database-backed auth rate limiter is shared across service instances.
- Customer dashboard queries are keyed by the authenticated customer ID. Orders and pre-orders have storage models but are not yet connected to a checkout/order-management provider; they remain empty until trusted order integration writes them. The current dashboard displays only records returned for that customer.
- Address display and wishlist APIs are account-scoped. Order imports, address editing, reward accounting, and tier-benefit rules require integration with DracoWorld's future operational systems.
