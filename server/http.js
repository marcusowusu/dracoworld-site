import { createHmac, randomUUID } from "node:crypto";
import { pool } from "./db.js";
import { digest, equalHashes, readCsrfCookie } from "./security.js";

const rateLimitSecret = process.env.RATE_LIMIT_SECRET;
if (!rateLimitSecret || Buffer.byteLength(rateLimitSecret) < 32) {
  throw new Error("RATE_LIMIT_SECRET must contain at least 32 bytes.");
}

if (!process.env.PUBLIC_ORIGIN) {
  throw new Error("PUBLIC_ORIGIN must be set to the website's exact origin.");
}
const publicOrigin = new URL(process.env.PUBLIC_ORIGIN);
if (publicOrigin.origin !== process.env.PUBLIC_ORIGIN.replace(/\/$/, "")) {
  throw new Error("PUBLIC_ORIGIN must contain only the website origin, without a path.");
}
if (process.env.NODE_ENV === "production" && publicOrigin.protocol !== "https:") {
  throw new Error("PUBLIC_ORIGIN must use HTTPS in production.");
}
if (!["true", "false"].includes(process.env.TRUST_PROXY || "false")) {
  throw new Error("TRUST_PROXY must be set to true or false.");
}

export class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function asyncRoute(handler) {
  return (request, response, next) => {
    Promise.resolve(handler(request, response, next)).catch(next);
  };
}

export function requireJsonOrigin(request, _response, next) {
  if (request.method !== "DELETE" && !request.is("application/json")) {
    next(new HttpError(415, "json_required", "Send this request as JSON."));
    return;
  }

  const origin = request.get("origin");
  let allowedOrigin;
  try {
    allowedOrigin = new URL(process.env.PUBLIC_ORIGIN).origin;
  } catch {
    next(new Error("PUBLIC_ORIGIN must be a valid absolute URL."));
    return;
  }

  if (!origin || origin !== allowedOrigin) {
    next(new HttpError(403, "origin_not_allowed", "This request origin is not allowed."));
    return;
  }
  if (request.get("sec-fetch-site") && request.get("sec-fetch-site") !== "same-origin") {
    next(new HttpError(403, "cross_site_request", "Cross-site requests are not allowed."));
    return;
  }
  next();
}

export function requireAuth(request, _response, next) {
  if (!request.auth) {
    next(new HttpError(401, "authentication_required", "Please sign in to continue."));
    return;
  }
  next();
}

export function requireAdmin(request, _response, next) {
  if (request.auth?.customer.role !== "admin") {
    next(new HttpError(403, "administrator_required", "Administrator access is required."));
    return;
  }
  next();
}

export function requireCsrf(request, _response, next) {
  const token = request.get("x-csrf-token");
  const cookieToken = readCsrfCookie(request);
  if (!request.auth || !token || !equalHashes(digest(token), request.auth.csrfTokenHash)) {
    next(new HttpError(403, "csrf_validation_failed", "Refresh your session and try again."));
    return;
  }
  if (!cookieToken || !equalHashes(digest(token), digest(cookieToken))) {
    next(new HttpError(403, "csrf_validation_failed", "Refresh your session and try again."));
    return;
  }
  next();
}

export function rateLimit({ scope, max, windowMs, identity = (request) => request.ip }) {
  return asyncRoute(async (request, _response, next) => {
    const keyHash = createHmac("sha256", rateLimitSecret)
      .update(`${scope}:${identity(request)}`)
      .digest("hex");
    const { rows } = await pool.query(
      `INSERT INTO auth_rate_limits (key_hash, window_started_at, request_count, expires_at)
       VALUES ($1, now(), 1, now() + ($2 * interval '1 millisecond'))
       ON CONFLICT (key_hash) DO UPDATE SET
         request_count = CASE
           WHEN auth_rate_limits.expires_at <= now() THEN 1
           ELSE auth_rate_limits.request_count + 1
         END,
         window_started_at = CASE
           WHEN auth_rate_limits.expires_at <= now() THEN now()
           ELSE auth_rate_limits.window_started_at
         END,
         expires_at = CASE
           WHEN auth_rate_limits.expires_at <= now()
             THEN now() + ($2 * interval '1 millisecond')
           ELSE auth_rate_limits.expires_at
         END
       RETURNING request_count`,
      [keyHash, windowMs],
    );

    if (rows[0].request_count > max) {
      next(new HttpError(429, "too_many_requests", "Too many attempts. Please wait and try again."));
      return;
    }
    next();
  });
}

function safeErrorType(error) {
  if (error instanceof TypeError) return "TypeError";
  if (error instanceof RangeError) return "RangeError";
  if (error instanceof SyntaxError) return "SyntaxError";
  if (error instanceof ReferenceError) return "ReferenceError";
  if (error instanceof URIError) return "URIError";
  if (error instanceof EvalError) return "EvalError";
  if (error instanceof AggregateError) return "AggregateError";
  return error instanceof Error ? "Error" : "UnknownError";
}

export function handleError(error, request, response, _next) {
  if (response.headersSent) {
    return;
  }

  if (error instanceof HttpError) {
    response.status(error.status).json({ error: error.code, message: error.message });
    return;
  }

  if (error?.type === "entity.parse.failed") {
    response.status(400).json({
      error: "invalid_json",
      message: "The request body must be valid JSON.",
    });
    return;
  }

  if (error?.type === "entity.too.large") {
    response.status(413).json({
      error: "request_too_large",
      message: "The request body is too large.",
    });
    return;
  }

  if (error?.status === 404 || error?.code === "ENOENT") {
    response.status(404).json({
      error: "not_found",
      message: "The requested resource was not found.",
    });
    return;
  }

  if (error?.name === "EmailNotConfiguredError") {
    response.status(503).json({
      error: "email_not_configured",
      message: "Email delivery is not configured. Contact the site administrator.",
    });
    return;
  }

  if (error?.name === "EmailDeliveryError") {
    response.status(503).json({
      error: "email_delivery_failed",
      message: "Email delivery failed. Please retry or contact the site administrator.",
    });
    return;
  }

  if (error?.name === "ZodError") {
    response.status(400).json({
      error: "invalid_input",
      message: "Check the submitted information and try again.",
    });
    return;
  }

  if (error?.code === "23505") {
    response.status(409).json({
      error: "conflict",
      message: "That request conflicts with an existing record.",
    });
    return;
  }

  const methods = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]);
  const method = methods.has(request.method) ? request.method : "UNKNOWN";
  const requestId = randomUUID();
  response.set("X-Request-Id", requestId);
  console.error("Request failed:", {
    requestId,
    method,
    status: 500,
    type: safeErrorType(error),
  });
  response.status(500).json({
    error: "internal_error",
    message: "The request could not be completed. Please try again later.",
  });
}
