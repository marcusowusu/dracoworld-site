import assert from "node:assert/strict";
import { test } from "node:test";

process.env.DATABASE_URL ||= "postgres://test:test@127.0.0.1:5432/dracoworld_test";
process.env.RATE_LIMIT_SECRET ||= "test-only-rate-limit-secret-at-least-32-bytes";
process.env.PUBLIC_ORIGIN ||= "https://store.example.test";
process.env.TRUST_PROXY ||= "false";

const { handleError } = await import("../server/http.js");

test("unexpected auth errors do not log URL tokens or request credentials", () => {
  const invitationToken = "invitation-bearer-token-0123456789";
  const verificationToken = "verification-bearer-token-0123456789";
  const resetToken = "password-reset-bearer-token-0123456789";
  const apiKey = "api-key-secret-value";
  const sessionId = "session-cookie-secret";
  const csrfToken = "csrf-cookie-secret";
  const logs = [];
  const originalConsoleError = console.error;
  const response = {
    headers: {},
    statusCode: undefined,
    body: undefined,
    set(name, value) {
      this.headers[name] = value;
      return this;
    },
    status(statusCode) {
      this.statusCode = statusCode;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
  const request = {
    method: "POST",
    path: `/api/auth/invitations/${invitationToken}/accept`,
    originalUrl: `/api/auth/invitations/${invitationToken}/accept?token=${verificationToken}&reset_token=${resetToken}`,
    headers: {
      authorization: `Bearer ${apiKey}`,
      cookie: `dw_session=${sessionId}; dw_csrf=${csrfToken}`,
    },
  };
  const error = new Error(
    `Unexpected provider failure: ${invitationToken} ${verificationToken} ${resetToken} ${apiKey} ${sessionId} ${csrfToken}`,
  );

  console.error = (...values) => logs.push(values);
  try {
    handleError(error, request, response, () => {});
  } finally {
    console.error = originalConsoleError;
  }

  const loggedText = JSON.stringify(logs);
  for (const secret of [
    invitationToken,
    verificationToken,
    resetToken,
    apiKey,
    sessionId,
    csrfToken,
  ]) {
    assert.equal(loggedText.includes(secret), false, `${secret} must not appear in logs`);
    assert.equal(JSON.stringify(response.body).includes(secret), false, `${secret} must not appear in the response`);
  }
  assert.equal(response.statusCode, 500);
  assert.deepEqual(response.body, {
    error: "internal_error",
    message: "The request could not be completed. Please try again later.",
  });
  assert.match(response.headers["X-Request-Id"], /^[0-9a-f-]{36}$/);
  assert.deepEqual(logs[0], [
    "Request failed:",
    {
      requestId: response.headers["X-Request-Id"],
      method: "POST",
      status: 500,
      type: "Error",
    },
  ]);
});
