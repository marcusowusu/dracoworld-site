import assert from "node:assert/strict";
import { test } from "node:test";
import { smtpTransportTlsOptions } from "../server/email.js";

const smtpSettingNames = [
  "SMTP_HOST",
  "SMTP_PORT",
  "SMTP_SECURE",
  "SMTP_USER",
  "SMTP_PASS",
  "SMTP_FROM",
];

test("SMTP transport retains implicit TLS on port 465", () => {
  assert.deepEqual(smtpTransportTlsOptions(465, true), {
    port: 465,
    secure: true,
    requireTLS: false,
  });
});

test("SMTP transport requires STARTTLS when implicit TLS is disabled", () => {
  assert.deepEqual(smtpTransportTlsOptions(587, false), {
    port: 587,
    secure: false,
    requireTLS: true,
  });
});

test("invalid SMTP settings fail closed with a safe configuration error", async () => {
  const originalSettings = Object.fromEntries(
    smtpSettingNames.map((name) => [name, process.env[name]]),
  );
  for (const name of smtpSettingNames) {
    delete process.env[name];
  }
  process.env.SMTP_HOST = "smtp.example.test";
  process.env.SMTP_PORT = "587";
  process.env.SMTP_SECURE = "not-a-boolean";
  process.env.SMTP_USER = "test-user";
  process.env.SMTP_PASS = "test-password";
  process.env.SMTP_FROM = "store@example.test";

  try {
    const email = await import(`../server/email.js?invalid-smtp-${Date.now()}`);
    assert.equal(email.smtpConfigured, false);
    assert.throws(() => email.requireEmailConfiguration(), {
      name: "EmailNotConfiguredError",
      message: /Email delivery is not configured/,
    });
  } finally {
    for (const [name, value] of Object.entries(originalSettings)) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  }
});
