import { Router } from "express";
import { z } from "zod";
import argon2 from "argon2";
import { inTransaction, pool } from "./db.js";
import {
  clearSessionCookie,
  createOpaqueToken,
  createSession,
  digest,
  equalHashes,
  passwordOptions,
  readCsrfCookie,
  setCsrfCookie,
  setSessionCookie,
  verifyPassword,
} from "./security.js";
import {
  asyncRoute,
  HttpError,
  rateLimit,
  requireAuth,
  requireCsrf,
  requireJsonOrigin,
} from "./http.js";
import {
  requireEmailConfiguration,
  sendPasswordResetEmail,
  sendVerificationEmail,
} from "./email.js";

const router = Router();
const emailSchema = z.string().trim().email().max(254).transform((email) => email.toLowerCase());
const passwordSchema = z.string().min(12).max(128);
const passwordPair = z.object({
  password: passwordSchema,
  passwordConfirmation: z.string().min(1).max(128),
}).strict().refine((value) => value.password === value.passwordConfirmation, {
  path: ["passwordConfirmation"],
  message: "Passwords do not match.",
});
const registrationSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  email: emailSchema,
  ...passwordPair.shape,
}).strict().refine((value) => value.password === value.passwordConfirmation, {
  path: ["passwordConfirmation"],
  message: "Passwords do not match.",
});
const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(128),
}).strict();
const tokenSchema = z.string().min(32).max(128);
const resetSchema = z.object({
  token: tokenSchema,
  ...passwordPair.shape,
}).strict().refine((value) => value.password === value.passwordConfirmation, {
  path: ["passwordConfirmation"],
  message: "Passwords do not match.",
});

const loginRateLimit = rateLimit({
  scope: "login",
  max: 8,
  windowMs: 15 * 60 * 1000,
  identity: (request) => `${request.ip}:${String(request.body?.email || "").trim().toLowerCase()}`,
});
const loginIpRateLimit = rateLimit({
  scope: "login-ip",
  max: 30,
  windowMs: 15 * 60 * 1000,
});
const registrationRateLimit = rateLimit({
  scope: "registration",
  max: 5,
  windowMs: 60 * 60 * 1000,
});
const resetRateLimit = rateLimit({
  scope: "password-reset",
  max: 4,
  windowMs: 60 * 60 * 1000,
  identity: (request) => `${request.ip}:${String(request.body?.email || "").trim().toLowerCase()}`,
});
const resetIpRateLimit = rateLimit({
  scope: "password-reset-ip",
  max: 15,
  windowMs: 60 * 60 * 1000,
});
const tokenRateLimit = rateLimit({
  scope: "email-token",
  max: 8,
  windowMs: 15 * 60 * 1000,
});

function publicCustomer(row) {
  return {
    id: row.id,
    fullName: row.full_name,
    email: row.email,
    phone: row.phone,
    membershipNumber: row.membership_number,
    role: row.role,
    membership: {
      code: row.tier_code,
      name: row.tier_name,
      pointsMultiplier: Number(row.points_multiplier),
    },
    rewardPoints: row.reward_points,
  };
}

function sessionResponse(response, session, customer) {
  setSessionCookie(response, session.rawSessionId, session.expiresAt);
  setCsrfCookie(response, session.csrfToken, session.expiresAt);
  return response.json({
    authenticated: true,
    csrfToken: session.csrfToken,
    customer,
  });
}

async function createVerificationToken(client, customerId) {
  const token = createOpaqueToken();
  await client.query(
    `INSERT INTO email_verification_tokens (token_hash, customer_id, expires_at)
     VALUES ($1, $2, now() + interval '24 hours')`,
    [digest(token), customerId],
  );
  return token;
}

router.post(
  "/register",
  requireJsonOrigin,
  registrationRateLimit,
  asyncRoute(async (request, response) => {
    const input = registrationSchema.parse(request.body);
    requireEmailConfiguration();
    const passwordHash = await argon2.hash(input.password, passwordOptions);
    const customer = await inTransaction(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO customers (full_name, email, password_hash, membership_tier_id)
         SELECT $1, $2, $3, id FROM membership_tiers WHERE code = 'standard'
         RETURNING id, full_name, email`,
        [input.fullName, input.email, passwordHash],
      );
      if (!rows[0]) {
        throw new Error("The standard membership tier is missing; apply the database migrations.");
      }
      const token = await createVerificationToken(client, rows[0].id);
      return { ...rows[0], token };
    });

    await sendVerificationEmail({
      email: customer.email,
      name: customer.full_name,
      token: customer.token,
    });
    response.status(201).json({
      message: "Account created. Check your email to verify your address before signing in.",
    });
  }),
);

router.post(
  "/resend-verification",
  requireJsonOrigin,
  tokenRateLimit,
  asyncRoute(async (request, response) => {
    const email = emailSchema.parse(request.body?.email);
    requireEmailConfiguration();
    const customer = await inTransaction(async (client) => {
      const { rows } = await client.query(
        `SELECT id, full_name, email FROM customers
         WHERE email = $1 AND email_verified_at IS NULL AND status = 'active'
         FOR UPDATE`,
        [email],
      );
      if (!rows[0]) return null;
      await client.query(
        `UPDATE email_verification_tokens
         SET consumed_at = now()
         WHERE customer_id = $1 AND consumed_at IS NULL`,
        [rows[0].id],
      );
      return { ...rows[0], token: await createVerificationToken(client, rows[0].id) };
    });
    if (customer) {
      await sendVerificationEmail({
        email: customer.email,
        name: customer.full_name,
        token: customer.token,
      });
    }
    response.json({ message: "If the account can be verified, a new link will be sent." });
  }),
);

router.get(
  "/verify",
  tokenRateLimit,
  asyncRoute(async (request, response) => {
    const token = tokenSchema.parse(request.query.token);
    const session = await inTransaction(async (client) => {
      const { rows } = await client.query(
        `SELECT t.token_hash, c.id
         FROM email_verification_tokens t
         JOIN customers c ON c.id = t.customer_id
         WHERE t.token_hash = $1 AND t.consumed_at IS NULL
           AND t.expires_at > now() AND c.email_verified_at IS NULL
           AND c.status = 'active'
         FOR UPDATE OF t, c`,
        [digest(token)],
      );
      if (!rows[0]) {
        throw new HttpError(400, "verification_link_invalid", "This verification link is invalid or expired.");
      }
      await client.query(
        "UPDATE email_verification_tokens SET consumed_at = now() WHERE token_hash = $1",
        [rows[0].token_hash],
      );
      await client.query(
        "UPDATE customers SET email_verified_at = now(), updated_at = now() WHERE id = $1",
        [rows[0].id],
      );
      return createSession(client, rows[0].id);
    });
    setSessionCookie(response, session.rawSessionId, session.expiresAt);
    setCsrfCookie(response, session.csrfToken, session.expiresAt);
    response.redirect(303, new URL("/?verified=1", process.env.PUBLIC_ORIGIN).toString());
  }),
);

router.post(
  "/login",
  requireJsonOrigin,
  loginIpRateLimit,
  loginRateLimit,
  asyncRoute(async (request, response) => {
    const input = loginSchema.parse(request.body);
    const { rows } = await pool.query(
      `SELECT c.id, c.full_name, c.email, c.phone, c.membership_number, c.password_hash, c.role,
              c.reward_points, c.email_verified_at, c.status,
              mt.code AS tier_code, mt.name AS tier_name, mt.points_multiplier
       FROM customers c JOIN membership_tiers mt ON mt.id = c.membership_tier_id
       WHERE c.email = $1`,
      [input.email],
    );
    const customer = rows[0];
    if (!await verifyPassword(input.password, customer?.password_hash)) {
      throw new HttpError(401, "invalid_credentials", "Email or password is incorrect.");
    }
    if (!customer.email_verified_at) {
      throw new HttpError(403, "email_not_verified", "Verify your email address before signing in.");
    }
    if (customer.status !== "active") {
      throw new HttpError(403, "account_unavailable", "This account is currently unavailable.");
    }

    const session = await createSession(pool, customer.id);
    return sessionResponse(response, session, publicCustomer(customer));
  }),
);

router.get("/session", (request, response) => {
  if (!request.auth) {
    response.json({ authenticated: false });
    return;
  }
  const csrfToken = readCsrfCookie(request);
  response.json({
    authenticated: true,
    csrfToken: csrfToken && equalHashes(digest(csrfToken), request.auth.csrfTokenHash) ? csrfToken : null,
    customer: {
      id: request.auth.customer.id,
      fullName: request.auth.customer.fullName,
      email: request.auth.customer.email,
      phone: request.auth.customer.phone,
      membershipNumber: request.auth.customer.membershipNumber,
      role: request.auth.customer.role,
      membership: {
        code: request.auth.customer.tierCode,
        name: request.auth.customer.tierName,
        pointsMultiplier: Number(request.auth.customer.pointsMultiplier),
      },
      rewardPoints: request.auth.customer.rewardPoints,
    },
  });
});

router.post(
  "/logout",
  requireJsonOrigin,
  requireAuth,
  requireCsrf,
  asyncRoute(async (request, response) => {
    await pool.query("DELETE FROM sessions WHERE id_hash = $1", [request.auth.sessionIdHash]);
    clearSessionCookie(response);
    response.json({ authenticated: false });
  }),
);

router.post(
  "/password-reset/request",
  requireJsonOrigin,
  resetIpRateLimit,
  resetRateLimit,
  asyncRoute(async (request, response) => {
    const email = emailSchema.parse(request.body?.email);
    requireEmailConfiguration();
    const reset = await inTransaction(async (client) => {
      const { rows } = await client.query(
        `SELECT id, full_name, email FROM customers
         WHERE email = $1 AND email_verified_at IS NOT NULL AND status = 'active'`,
        [email],
      );
      if (!rows[0]) return null;
      const token = createOpaqueToken();
      await client.query(
        `INSERT INTO password_reset_tokens (token_hash, customer_id, expires_at)
         VALUES ($1, $2, now() + interval '1 hour')`,
        [digest(token), rows[0].id],
      );
      return { ...rows[0], token };
    });
    if (reset) {
      await sendPasswordResetEmail({
        email: reset.email,
        name: reset.full_name,
        token: reset.token,
      });
    }
    response.json({ message: "If the account exists, a password reset link will be sent." });
  }),
);

router.post(
  "/password-reset/confirm",
  requireJsonOrigin,
  tokenRateLimit,
  asyncRoute(async (request, response) => {
    const input = resetSchema.parse(request.body);
    const passwordHash = await argon2.hash(input.password, passwordOptions);
    await inTransaction(async (client) => {
      const { rows } = await client.query(
        `SELECT token_hash, customer_id FROM password_reset_tokens
         WHERE token_hash = $1 AND consumed_at IS NULL AND expires_at > now()
         FOR UPDATE`,
        [digest(input.token)],
      );
      if (!rows[0]) {
        throw new HttpError(400, "reset_link_invalid", "This password reset link is invalid or expired.");
      }
      await client.query(
        "UPDATE password_reset_tokens SET consumed_at = now() WHERE token_hash = $1",
        [rows[0].token_hash],
      );
      await client.query(
        "UPDATE customers SET password_hash = $1, updated_at = now() WHERE id = $2",
        [passwordHash, rows[0].customer_id],
      );
      await client.query("DELETE FROM sessions WHERE customer_id = $1", [rows[0].customer_id]);
    });
    response.json({ message: "Your password has been reset. Sign in with your new password." });
  }),
);

router.get(
  "/invitations/:token",
  tokenRateLimit,
  asyncRoute(async (request, response) => {
    const token = tokenSchema.parse(request.params.token);
    const { rows } = await pool.query(
      `SELECT i.email, i.expires_at, mt.name AS tier_name
       FROM invitations i JOIN membership_tiers mt ON mt.id = i.membership_tier_id
       WHERE i.token_hash = $1 AND i.status = 'pending' AND i.expires_at > now()`,
      [digest(token)],
    );
    if (!rows[0]) {
      throw new HttpError(404, "invitation_unavailable", "This invitation is invalid, expired, or already used.");
    }
    response.json({
      email: rows[0].email,
      tierName: rows[0].tier_name,
      expiresAt: rows[0].expires_at,
    });
  }),
);

router.post(
  "/invitations/:token/accept",
  requireJsonOrigin,
  registrationRateLimit,
  asyncRoute(async (request, response) => {
    const token = tokenSchema.parse(request.params.token);
    const input = z.object({
      fullName: z.string().trim().min(2).max(120),
      ...passwordPair.shape,
    }).strict().refine((value) => value.password === value.passwordConfirmation, {
      path: ["passwordConfirmation"],
      message: "Passwords do not match.",
    }).parse(request.body);
    const passwordHash = await argon2.hash(input.password, passwordOptions);

    const result = await inTransaction(async (client) => {
      const { rows } = await client.query(
        `SELECT id, email, membership_tier_id FROM invitations
         WHERE token_hash = $1 AND status = 'pending' AND expires_at > now()
         FOR UPDATE`,
        [digest(token)],
      );
      if (!rows[0]) {
        throw new HttpError(400, "invitation_unavailable", "This invitation is invalid, expired, or already used.");
      }
      const invitation = rows[0];
      const { rows: customerRows } = await client.query(
        `INSERT INTO customers (
           full_name, email, password_hash, email_verified_at, membership_tier_id
         ) VALUES ($1, $2, $3, now(), $4)
         RETURNING id, full_name, email, phone, membership_number, role, reward_points`,
        [input.fullName, invitation.email, passwordHash, invitation.membership_tier_id],
      );
      await client.query(
        `UPDATE invitations SET status = 'accepted', accepted_by = $1, accepted_at = now()
         WHERE id = $2`,
        [customerRows[0].id, invitation.id],
      );
      const { rows: tierRows } = await client.query(
        "SELECT code AS tier_code, name AS tier_name, points_multiplier FROM membership_tiers WHERE id = $1",
        [invitation.membership_tier_id],
      );
      return {
        customer: { ...customerRows[0], ...tierRows[0] },
        session: await createSession(client, customerRows[0].id),
      };
    });

    return sessionResponse(response, result.session, publicCustomer(result.customer));
  }),
);

export default router;
