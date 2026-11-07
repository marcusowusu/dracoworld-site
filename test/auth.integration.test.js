import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

test("customer sessions isolate dashboard data and protect privileged fields", {
  skip: !testDatabaseUrl,
}, async (t) => {
  const database = new URL(testDatabaseUrl);
  assert.match(database.pathname, /test/i, "TEST_DATABASE_URL must target a database with 'test' in its name");
  process.env.DATABASE_URL = testDatabaseUrl;
  process.env.NODE_ENV = "test";
  process.env.RATE_LIMIT_SECRET = randomBytes(32).toString("base64url");
  process.env.PUBLIC_ORIGIN = "http://127.0.0.1";
  for (const setting of ["RESEND_API_KEY", "EMAIL_FROM"]) {
    delete process.env[setting];
  }

  const [{ pool }, { default: app }, argon2, { digest, passwordOptions }] = await Promise.all([
    import("../server/db.js"),
    import("../server/app.js"),
    import("argon2"),
    import("../server/security.js"),
  ]);
  const migrations = await pool.query(
    "SELECT 1 FROM schema_migrations WHERE name = '001_initial_auth.sql'",
  );
  assert.equal(migrations.rowCount, 1, "apply npm run migrate to the test database first");
  const defaultAdministrators = await pool.query(
    "SELECT count(*)::integer AS count FROM customers WHERE role = 'admin'",
  );
  assert.equal(defaultAdministrators.rows[0].count, 0, "the migration must not create an administrator");

  const suffix = randomBytes(8).toString("hex");
  const emails = [
    `customer-a-${suffix}@test.invalid`,
    `customer-b-${suffix}@test.invalid`,
    `admin-${suffix}@test.invalid`,
  ];
  const invitedEmail = `invite-${suffix}@test.invalid`;
  const verifiedEmail = `verified-${suffix}@test.invalid`;
  const revokedEmail = `revoked-${suffix}@test.invalid`;
  const expiredEmail = `expired-${suffix}@test.invalid`;
  const ids = [];
  let premiumTierCode;
  let server;
  let origin;

  t.after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (ids.length) {
      await pool.query("DELETE FROM invitations WHERE created_by = ANY($1::uuid[])", [ids]);
      await pool.query("DELETE FROM customer_orders WHERE customer_id = ANY($1::uuid[])", [ids]);
      await pool.query("DELETE FROM customer_preorders WHERE customer_id = ANY($1::uuid[])", [ids]);
      await pool.query("DELETE FROM customer_addresses WHERE customer_id = ANY($1::uuid[])", [ids]);
      await pool.query("DELETE FROM customer_wishlist WHERE customer_id = ANY($1::uuid[])", [ids]);
      await pool.query("DELETE FROM sessions WHERE customer_id = ANY($1::uuid[])", [ids]);
      await pool.query("DELETE FROM customers WHERE id = ANY($1::uuid[])", [ids]);
    }
    if (premiumTierCode) {
      await pool.query("DELETE FROM membership_tiers WHERE code = $1", [premiumTierCode]);
    }
    await pool.end();
  });

  const standardTier = await pool.query(
    "SELECT id FROM membership_tiers WHERE code = 'standard'",
  );
  const premiumTier = await pool.query(
    `INSERT INTO membership_tiers (code, name, invitation_assignable)
     VALUES ($1, 'Integration Premium', TRUE) RETURNING id`,
    [`integration-${suffix}`],
  );
  premiumTierCode = `integration-${suffix}`;
  const password = "Integration-Test-Password-2026!";
  const passwordHash = await argon2.hash(password, passwordOptions);

  for (const [index, email] of emails.entries()) {
    const { rows } = await pool.query(
      `INSERT INTO customers (
         full_name, email, password_hash, email_verified_at, role, membership_tier_id
       ) VALUES ($1, $2, $3, now(), $4, $5) RETURNING id`,
      [
        `Integration Customer ${index}`,
        email,
        passwordHash,
        index === 2 ? "admin" : "customer",
        standardTier.rows[0].id,
      ],
    );
    ids.push(rows[0].id);
  }
  const unverifiedCustomer = await pool.query(
    `INSERT INTO customers (full_name, email, password_hash, membership_tier_id)
     VALUES ('Unverified Customer', $1, $2, $3) RETURNING id`,
    [verifiedEmail, passwordHash, standardTier.rows[0].id],
  );
  ids.push(unverifiedCustomer.rows[0].id);

  await pool.query(
    `INSERT INTO customer_orders
       (customer_id, external_reference, status, total_amount)
     VALUES ($1, $2, 'processing', 125.00), ($3, $4, 'processing', 250.00)`,
    [ids[0], `A-${suffix}`, ids[1], `B-${suffix}`],
  );
  await pool.query(
    `INSERT INTO customer_preorders
       (customer_id, external_reference, product_name, status)
     VALUES ($1, $2, 'A pre-order', 'Production Started'),
            ($3, $4, 'B pre-order', 'Order Confirmed')`,
    [ids[0], `PA-${suffix}`, ids[1], `PB-${suffix}`],
  );
  await pool.query(
    `INSERT INTO customer_addresses
       (customer_id, recipient_name, address_line_1, city, country)
     VALUES ($1, 'Customer A', 'A private address', 'Accra', 'Ghana'),
            ($2, 'Customer B', 'B private address', 'Kumasi', 'Ghana')`,
    [ids[0], ids[1]],
  );
  await pool.query(
    `INSERT INTO customer_wishlist(customer_id, product_id)
     VALUES ($1, 'logo-sleeve-sweatshirt'), ($2, 'raglan-tee-black')`,
    [ids[0], ids[1]],
  );

  const inviteToken = randomBytes(32).toString("base64url");
  await pool.query(
    `INSERT INTO invitations (email, token_hash, membership_tier_id, expires_at, created_by)
     VALUES ($1, $2, $3, now() + interval '1 day', $4)`,
    [invitedEmail, digest(inviteToken), premiumTier.rows[0].id, ids[2]],
  );
  const revokedInvite = await pool.query(
    `INSERT INTO invitations (email, token_hash, membership_tier_id, expires_at, created_by)
     VALUES ($1, $2, $3, now() + interval '1 day', $4) RETURNING id`,
    [revokedEmail, digest(randomBytes(32).toString("base64url")), standardTier.rows[0].id, ids[2]],
  );
  await pool.query(
    `INSERT INTO invitations (email, token_hash, membership_tier_id, expires_at, created_by, created_at)
     VALUES ($1, $2, $3, now() - interval '1 day', $4, now() - interval '2 days')`,
    [expiredEmail, digest(randomBytes(32).toString("base64url")), standardTier.rows[0].id, ids[2]],
  );
  const verificationToken = randomBytes(32).toString("base64url");
  await pool.query(
    `INSERT INTO email_verification_tokens (token_hash, customer_id, expires_at)
     VALUES ($1, $2, now() + interval '1 day')`,
    [digest(verificationToken), unverifiedCustomer.rows[0].id],
  );

  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  origin = `http://127.0.0.1:${server.address().port}`;
  process.env.PUBLIC_ORIGIN = origin;

  const storefront = await fetch(origin);
  assert.equal(storefront.status, 200);
  assert.match(await storefront.text(), /DRACOWORLD — More Than Just Clothing/);
  for (const assetPath of ["/account.js", "/admin.js", "/admin.html", "/assets/dracoworld-logo.v1.png"]) {
    const asset = await fetch(`${origin}${assetPath}`);
    assert.equal(asset.status, 200, `${assetPath} should be served by Express`);
  }

  async function request(path, { method = "GET", body, session, csrf, redirect } = {}) {
    const headers = { Accept: "application/json", Origin: origin };
    if (method !== "GET") headers["Content-Type"] = "application/json";
    if (session) headers.Cookie = session;
    if (csrf) headers["X-CSRF-Token"] = csrf;
    return fetch(`${origin}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect,
    });
  }

  async function login(email) {
    const response = await request("/api/auth/login", {
      method: "POST",
      body: { email, password },
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    const cookieHeaders = response.headers.getSetCookie();
    const sessionCookie = cookieHeaders.find((value) => value.startsWith("dw_session="))?.split(";")[0];
    const csrfCookie = cookieHeaders.find((value) => value.startsWith("dw_csrf="))?.split(";")[0];
    assert.ok(sessionCookie);
    assert.ok(csrfCookie);
    assert.equal(csrfCookie.slice("dw_csrf=".length), body.csrfToken);
    return { body, session: `${sessionCookie}; ${csrfCookie}` };
  }

  const customerA = await login(emails[0]);
  const dashboardAResponse = await request("/api/me/dashboard", { session: customerA.session });
  assert.equal(dashboardAResponse.status, 200);
  const dashboardA = await dashboardAResponse.json();
  assert.equal(dashboardA.customer.membership.name, "Member");
  assert.deepEqual(dashboardA.orders.map((order) => order.id), [`A-${suffix}`]);
  assert.deepEqual(dashboardA.preorders.map((item) => item.id), [`PA-${suffix}`]);
  assert.deepEqual(dashboardA.addresses.map((address) => address.address_line_1), ["A private address"]);
  assert.deepEqual(dashboardA.wishlist.map((item) => item.productId), ["logo-sleeve-sweatshirt"]);
  assert.equal(JSON.stringify(dashboardA).includes("B private address"), false);
  assert.equal(JSON.stringify(customerA.body).includes("password_hash"), false);

  const sessionId = customerA.session.match(/dw_session=([^;]+)/)[1];
  const csrf = customerA.body.csrfToken;
  const storedSession = await pool.query(
    "SELECT id_hash, csrf_token_hash FROM sessions WHERE customer_id = $1",
    [ids[0]],
  );
  assert.equal(storedSession.rows[0].id_hash, digest(sessionId));
  assert.equal(storedSession.rows[0].csrf_token_hash, digest(csrf));
  assert.notEqual(storedSession.rows[0].id_hash, sessionId);

  const forbiddenProfileUpdate = await request("/api/me/profile", {
    method: "PATCH",
    body: { fullName: "Changed", role: "admin", membershipTierId: premiumTier.rows[0].id },
    session: customerA.session,
    csrf,
  });
  assert.equal(forbiddenProfileUpdate.status, 400);
  const stillCustomer = await pool.query("SELECT role FROM customers WHERE id = $1", [ids[0]]);
  assert.equal(stillCustomer.rows[0].role, "customer");
  const missingCsrf = await request("/api/me/profile", {
    method: "PATCH",
    body: { fullName: "No CSRF" },
    session: customerA.session,
  });
  assert.equal(missingCsrf.status, 403);
  const addWishlistItem = await request("/api/me/wishlist", {
    method: "POST",
    body: { productId: "raglan-tee-cream" },
    session: customerA.session,
    csrf,
  });
  assert.equal(addWishlistItem.status, 201);

  const forbiddenAdminRequest = await request("/api/admin/invitations", { session: customerA.session });
  assert.equal(forbiddenAdminRequest.status, 403);

  const customerB = await login(emails[1]);
  const dashboardBResponse = await request("/api/me/dashboard", { session: customerB.session });
  const dashboardB = await dashboardBResponse.json();
  assert.deepEqual(dashboardB.orders.map((order) => order.id), [`B-${suffix}`]);
  assert.deepEqual(dashboardB.addresses.map((address) => address.address_line_1), ["B private address"]);
  assert.deepEqual(dashboardB.wishlist.map((item) => item.productId), ["raglan-tee-black"]);
  const removeOtherCustomersItem = await request("/api/me/wishlist/raglan-tee-black", {
    method: "DELETE",
    session: customerA.session,
    csrf,
  });
  assert.equal(removeOtherCustomersItem.status, 204);
  const dashboardBAfterRemoval = await request("/api/me/dashboard", { session: customerB.session });
  assert.deepEqual((await dashboardBAfterRemoval.json()).wishlist.map((item) => item.productId), ["raglan-tee-black"]);

  const admin = await login(emails[2]);
  const tiersResponse = await request("/api/admin/membership-tiers", { session: admin.session });
  assert.equal(tiersResponse.status, 200);
  assert.ok((await tiersResponse.json()).tiers.some((tier) => tier.id === premiumTier.rows[0].id));

  const inviteResponse = await request(`/api/auth/invitations/${inviteToken}`);
  assert.equal(inviteResponse.status, 200);
  assert.equal((await inviteResponse.json()).email, invitedEmail);
  const acceptResponse = await request(`/api/auth/invitations/${inviteToken}/accept`, {
    method: "POST",
    body: {
      fullName: "Invited Customer",
      password,
      passwordConfirmation: password,
    },
  });
  assert.equal(acceptResponse.status, 200);
  const accepted = await acceptResponse.json();
  ids.push(accepted.customer.id);
  assert.equal(accepted.customer.membership.name, "Integration Premium");
  assert.equal(accepted.customer.role, "customer");
  const invitationsList = await request("/api/admin/invitations", { session: admin.session });
  const listedInvitations = (await invitationsList.json()).invitations;
  assert.equal(listedInvitations.find((item) => item.email === invitedEmail).status, "accepted");
  assert.equal(listedInvitations.find((item) => item.email === expiredEmail).status, "expired");
  const revokeResponse = await request(`/api/admin/invitations/${revokedInvite.rows[0].id}/revoke`, {
    method: "POST",
    body: {},
    session: admin.session,
    csrf: admin.body.csrfToken,
  });
  assert.equal(revokeResponse.status, 204);

  const verificationResponse = await request(`/api/auth/verify?token=${encodeURIComponent(verificationToken)}`, {
    redirect: "manual",
  });
  assert.equal(verificationResponse.status, 303);
  assert.equal(verificationResponse.headers.get("location"), `${origin}/?verified=1`);
  const verificationCookies = verificationResponse.headers.getSetCookie();
  const verificationSession = verificationCookies.find((value) => value.startsWith("dw_session="))?.split(";")[0];
  const verificationCsrf = verificationCookies.find((value) => value.startsWith("dw_csrf="))?.split(";")[0];
  assert.ok(verificationSession);
  assert.ok(verificationCsrf);
  const restoredSession = await request("/api/auth/session", {
    session: `${verificationSession}; ${verificationCsrf}`,
  });
  assert.equal((await restoredSession.json()).authenticated, true);
  const reusedVerification = await request(`/api/auth/verify?token=${encodeURIComponent(verificationToken)}`);
  assert.equal(reusedVerification.status, 400);

  const resetToken = randomBytes(32).toString("base64url");
  await pool.query(
    `INSERT INTO password_reset_tokens (token_hash, customer_id, expires_at)
     VALUES ($1, $2, now() + interval '1 hour')`,
    [digest(resetToken), ids[1]],
  );
  const newPassword = "New-Integration-Password-2027!";
  const passwordReset = await request("/api/auth/password-reset/confirm", {
    method: "POST",
    body: {
      token: resetToken,
      password: newPassword,
      passwordConfirmation: newPassword,
    },
  });
  assert.equal(passwordReset.status, 200);
  const resetHash = await pool.query("SELECT password_hash FROM customers WHERE id = $1", [ids[1]]);
  assert.equal(await argon2.verify(resetHash.rows[0].password_hash, newPassword), true);
  const revokedSession = await request("/api/me/dashboard", { session: customerB.session });
  assert.equal(revokedSession.status, 401);
  const reuseResponse = await request(`/api/auth/invitations/${inviteToken}/accept`, {
    method: "POST",
    body: {
      fullName: "Invited Customer Again",
      password,
      passwordConfirmation: password,
    },
  });
  assert.equal(reuseResponse.status, 400);

  const missingEmailConfiguration = await request("/api/auth/register", {
    method: "POST",
    body: {
      fullName: "Unconfigured Registration",
      email: `smtp-${suffix}@test.invalid`,
      password,
      passwordConfirmation: password,
    },
  });
  assert.equal(missingEmailConfiguration.status, 503);

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const invalidLogin = await request("/api/auth/login", {
      method: "POST",
      body: { email: "not-an-email", password: "x" },
    });
    assert.equal(invalidLogin.status, 400);
  }
  const rateLimitedLogin = await request("/api/auth/login", {
    method: "POST",
    body: { email: "not-an-email", password: "x" },
  });
  assert.equal(rateLimitedLogin.status, 429);

  const logoutResponse = await request("/api/auth/logout", {
    method: "POST",
    body: {},
    session: customerA.session,
    csrf,
  });
  assert.equal(logoutResponse.status, 200);
  const afterLogout = await request("/api/me/dashboard", { session: customerA.session });
  assert.equal(afterLogout.status, 401);
});
