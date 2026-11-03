# DracoWorld deployment

This deployment keeps the existing storefront on Cloudflare Pages, runs the Express API as a Render web service, and uses a separately provisioned managed PostgreSQL database. The Pages Function at `functions/api/[[path]].js` proxies `/api/*` requests through the same public origin; browser code never receives the API origin or database, email, or rate-limit secrets.

No services, databases, email providers, or deployments are provisioned by this repository. Complete the provider setup below before using production authentication.

## 1. Provision PostgreSQL

Create a managed PostgreSQL database with TLS enabled and network access restricted to the Render service where supported. Use a dedicated database and least-privilege database user. Configure backups and recovery before storing customer data.

Copy the database's connection string into Render's `DATABASE_URL` secret. The Render configuration sets `DATABASE_SSL=true`, which requires verified TLS. Do not put a real connection string in this repository or Cloudflare Pages.

## 2. Configure the Render API service

Connect this repository to Render and use the included `render.yaml` Blueprint configuration. It runs `npm ci`, executes `npm run migrate` as the pre-deploy command, starts the service with `npm start`, and checks `/api/health`. The `starter` plan is specified because Render pre-deploy commands require a paid instance.

Set these Render environment variables before the first deployment:

| Variable | Required value |
| --- | --- |
| `DATABASE_URL` | Managed PostgreSQL connection string; keep secret. |
| `PUBLIC_ORIGIN` | Exact canonical storefront origin, e.g. `https://www.example.com`, with no path or trailing slash. |
| `RATE_LIMIT_SECRET` | At least 32 cryptographically random bytes; keep secret and consistent across API instances. |
| `SMTP_HOST` | SMTP server hostname. |
| `SMTP_PORT` | SMTP port (typically `587` for STARTTLS or `465` for implicit TLS). |
| `SMTP_SECURE` | `true` for implicit TLS, otherwise `false` for STARTTLS. |
| `SMTP_USER` | SMTP authentication username. |
| `SMTP_PASS` | SMTP authentication password; keep secret. |
| `SMTP_FROM` | Verified sender address/name. |

`NODE_ENV=production`, `TRUST_PROXY=false`, `DATABASE_SSL=true`, `DB_POOL_MAX=10`, and `SESSION_TTL_HOURS=168` are set in `render.yaml`. `PORT` is assigned by Render and must not be overridden. `TRUST_PROXY` deliberately remains disabled: the service's complete trusted proxy chain has not been verified. Do not enable it to infer client addresses or affect rate limits without first verifying Render's actual ingress and forwarded-header behavior.

`RATE_LIMIT_SECRET` can be generated locally with Node.js:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

Keep the value in Render's environment settings, not in source control. Configure SMTP credentials through Render's secret environment settings. Without working SMTP, verification, invitation, and password-reset email cannot be delivered; successful provider configuration is not implied by this setup.

## 3. Run database migrations

The Render pre-deploy command runs the existing migration runner, `npm run migrate`, before starting a new service version. The runner wraps migration tracking and SQL in a transaction and takes a PostgreSQL transaction-scoped advisory lock so overlapping runs serialize safely. It is safe to rerun: applied migrations are recorded in `schema_migrations`, and the transaction releases its lock on completion or failure.

For a manual initial run, use the same command with the production `DATABASE_URL` and `DATABASE_SSL=true` environment securely supplied to the operator's environment. Never paste credentials into shell history or commit them. Review migration output and verify the service health check after deployment. Do not run ad hoc SQL to mark unapplied migrations as complete.

## 4. Configure Cloudflare Pages

Deploy the existing storefront as a Pages project with the repository's root as its build output directory and no build command required for the static files. Ensure Pages Functions are enabled and include `functions/api/[[path]].js` in the deployed source.

In the Pages project's **server-side environment variables and secrets**, set:

| Name | Value |
| --- | --- |
| `API_ORIGIN` | The Render API's HTTPS origin only, e.g. `https://dracoworld-api.onrender.com`. No path, credentials, query, or trailing slash. |

Set the binding in both Preview and Production environments to the appropriate fixed Render service origin. This is a Pages Function environment binding, not a `VITE_*`, `NEXT_PUBLIC_*`, or browser-visible variable. Requests cannot change the upstream host: the proxy constructs the upstream URL from this server-side binding plus the incoming API path and query.

Use the approved canonical storefront hostname consistently for `PUBLIC_ORIGIN` and Cloudflare Pages. The proxy preserves the request method, path, query, body, cookies, `Origin`, and CSRF headers. It does not forward client-supplied host or forwarded-IP headers. API responses are marked `no-store`; separate `Set-Cookie` headers are retained.

## 5. Production verification and administration

Before accepting customer registrations:

1. Confirm the Render deployment and `/api/health` health check succeed against the provisioned PostgreSQL database.
2. Confirm `DATABASE_SSL=true`, the production `PUBLIC_ORIGIN`, and the Pages `API_ORIGIN` match the real provider URLs.
3. Configure and verify SMTP delivery to the real storefront origin.
4. Test registration, verification email, login/logout, CSRF-protected requests, password reset, and rate limiting on the production hostname.
5. Confirm cookies are `Secure`, `HttpOnly` where applicable, and use the `__Host-` prefix in production.
6. Create an administrator only by first registering and verifying an account, then having a trusted operator grant its role as documented in [AUTHENTICATION_SETUP.md](./AUTHENTICATION_SETUP.md). There is no default administrator.

The application does not configure a PostgreSQL provider, SMTP/email delivery, custom domain, or administrator account. Those remain explicit operator setup tasks.
