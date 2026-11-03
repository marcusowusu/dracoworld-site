import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import argon2 from "argon2";
import cookie from "cookie";
import { pool } from "./db.js";

export const passwordOptions = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
};

const dummyPasswordHash = argon2.hash(randomBytes(32).toString("base64"), passwordOptions);
const secureCookie = process.env.NODE_ENV === "production";
const configuredSessionTtlHours = Number(process.env.SESSION_TTL_HOURS || "168");
if (!Number.isInteger(configuredSessionTtlHours) || configuredSessionTtlHours < 1 || configuredSessionTtlHours > 720) {
  throw new Error("SESSION_TTL_HOURS must be an integer between 1 and 720.");
}

export const sessionCookieName = secureCookie ? "__Host-dw_session" : "dw_session";
export const csrfCookieName = secureCookie ? "__Host-dw_csrf" : "dw_csrf";

export function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function createOpaqueToken() {
  return randomBytes(32).toString("base64url");
}

export function equalHashes(left, right) {
  if (typeof left !== "string" || typeof right !== "string" || left.length !== right.length) {
    return false;
  }
  return timingSafeEqual(Buffer.from(left), Buffer.from(right));
}

export function setSessionCookie(response, rawSessionId, expiresAt) {
  response.cookie(sessionCookieName, rawSessionId, {
    httpOnly: true,
    secure: secureCookie,
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export function clearSessionCookie(response) {
  response.clearCookie(sessionCookieName, {
    httpOnly: true,
    secure: secureCookie,
    sameSite: "lax",
    path: "/",
  });
  response.clearCookie(csrfCookieName, {
    httpOnly: false,
    secure: secureCookie,
    sameSite: "strict",
    path: "/",
  });
}

export function setCsrfCookie(response, csrfToken, expiresAt) {
  response.cookie(csrfCookieName, csrfToken, {
    httpOnly: false,
    secure: secureCookie,
    sameSite: "strict",
    path: "/",
    expires: expiresAt,
  });
}

export function readCsrfCookie(request) {
  return cookie.parse(request.headers.cookie || "")[csrfCookieName] || null;
}

export async function createSession(queryable, customerId) {
  const rawSessionId = createOpaqueToken();
  const csrfToken = createOpaqueToken();
  const expiresAt = new Date(Date.now() + sessionTtlMs());

  await queryable.query(
    `INSERT INTO sessions (id_hash, customer_id, csrf_token_hash, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [digest(rawSessionId), customerId, digest(csrfToken), expiresAt],
  );

  return { rawSessionId, csrfToken, expiresAt };
}

export function sessionTtlMs() {
  return configuredSessionTtlHours * 60 * 60 * 1000;
}

export async function verifyPassword(password, passwordHash) {
  const hash = passwordHash || await dummyPasswordHash;
  const valid = await argon2.verify(hash, password);
  return Boolean(passwordHash && valid);
}

export function readSessionCookie(request) {
  return cookie.parse(request.headers.cookie || "")[sessionCookieName] || null;
}

export async function loadSession(request, _response, next) {
  request.auth = null;
  const rawSessionId = readSessionCookie(request);
  if (!rawSessionId) {
    next();
    return;
  }

  try {
    const { rows } = await pool.query(
      `SELECT s.id_hash, s.csrf_token_hash, s.expires_at,
              c.id, c.full_name, c.email, c.phone, c.membership_number, c.role, c.status,
              c.reward_points, c.email_verified_at, mt.code AS tier_code,
              mt.name AS tier_name, mt.points_multiplier
       FROM sessions s
       JOIN customers c ON c.id = s.customer_id
       JOIN membership_tiers mt ON mt.id = c.membership_tier_id
       WHERE s.id_hash = $1 AND s.expires_at > now()`,
      [digest(rawSessionId)],
    );
    if (rows[0] && rows[0].status === "active" && rows[0].email_verified_at) {
      request.auth = {
        sessionIdHash: rows[0].id_hash,
        csrfTokenHash: rows[0].csrf_token_hash,
        expiresAt: rows[0].expires_at,
        customer: {
          id: rows[0].id,
          fullName: rows[0].full_name,
          email: rows[0].email,
          phone: rows[0].phone,
          membershipNumber: rows[0].membership_number,
          role: rows[0].role,
          rewardPoints: rows[0].reward_points,
          tierCode: rows[0].tier_code,
          tierName: rows[0].tier_name,
          pointsMultiplier: rows[0].points_multiplier,
        },
      };
    }
    next();
  } catch (error) {
    next(error);
  }
}
