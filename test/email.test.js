import assert from "node:assert/strict";
import { test } from "node:test";
import {
  EmailDeliveryError,
  EmailNotConfiguredError,
  requireEmailConfiguration,
  sendAccountEmail,
  sendVerificationEmail,
} from "../server/email.js";

const emailSettings = ["RESEND_API_KEY", "EMAIL_FROM"];

async function withEmailSettings(settings, callback) {
  const originalSettings = Object.fromEntries(
    emailSettings.map((name) => [name, process.env[name]]),
  );
  const originalFetch = globalThis.fetch;
  const originalConsoleError = console.error;
  const originalPublicOrigin = process.env.PUBLIC_ORIGIN;
  const originalTimeout = AbortSignal.timeout;

  for (const name of emailSettings) {
    if (settings[name] === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = settings[name];
    }
  }
  console.error = () => {};

  try {
    await callback();
  } finally {
    for (const [name, value] of Object.entries(originalSettings)) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
    globalThis.fetch = originalFetch;
    console.error = originalConsoleError;
    AbortSignal.timeout = originalTimeout;
    if (originalPublicOrigin === undefined) {
      delete process.env.PUBLIC_ORIGIN;
    } else {
      process.env.PUBLIC_ORIGIN = originalPublicOrigin;
    }
  }
}

const testSettings = {
  RESEND_API_KEY: "test-resend-key",
  EMAIL_FROM: "DracoWorld <noreply@example.test>",
};

test("sends account email through Resend and preserves verification links", async () => {
  await withEmailSettings(testSettings, async () => {
    const requests = [];
    globalThis.fetch = async (url, options) => {
      requests.push({ url, options });
      return { ok: true, json: async () => ({ id: "email-id" }) };
    };

    await sendAccountEmail({
      to: "customer@example.test",
      subject: "Test email",
      text: "Plain text",
      html: "<p>HTML</p>",
    });
    process.env.PUBLIC_ORIGIN = "https://store.example.test";
    await sendVerificationEmail({
      email: "customer@example.test",
      name: "Customer",
      token: "verification-token",
    });

    assert.equal(requests.length, 2);
    assert.equal(requests[0].url, "https://api.resend.com/emails");
    assert.equal(requests[0].options.method, "POST");
    assert.equal(requests[0].options.headers.Authorization, "Bearer test-resend-key");
    assert.ok(requests[0].options.signal instanceof AbortSignal);
    assert.deepEqual(JSON.parse(requests[0].options.body), {
      from: testSettings.EMAIL_FROM,
      to: ["customer@example.test"],
      subject: "Test email",
      text: "Plain text",
      html: "<p>HTML</p>",
    });
    const verification = JSON.parse(requests[1].options.body);
    assert.match(verification.text, /https:\/\/store\.example\.test\/api\/auth\/verify\?token=verification-token/);
    assert.match(verification.html, /Verify your email address/);
  });
});

test("missing Resend configuration fails before making a request", async () => {
  await withEmailSettings({}, async () => {
    globalThis.fetch = async () => {
      assert.fail("fetch must not be called without configuration");
    };
    assert.throws(requireEmailConfiguration, EmailNotConfiguredError);
    await assert.rejects(sendAccountEmail({}), EmailNotConfiguredError);
  });
});

test("HTTP errors become generic delivery errors without logging provider details", async () => {
  await withEmailSettings(testSettings, async () => {
    const logs = [];
    console.error = (...values) => logs.push(values.join(" "));
    globalThis.fetch = async () => ({
      ok: false,
      status: 401,
      json: async () => {
        assert.fail("provider error bodies must not be read");
      },
    });

    await assert.rejects(sendAccountEmail({ to: "customer@example.test" }), {
      name: "EmailDeliveryError",
      message: "The verification email could not be delivered.",
    });
    assert.deepEqual(logs, ["Email delivery failed."]);
    assert.doesNotMatch(logs.join(" "), /test-resend-key|customer@example\.test/);
  });
});

test("network errors become generic delivery errors", async () => {
  await withEmailSettings(testSettings, async () => {
    globalThis.fetch = async () => {
      throw new Error("network detail with test-resend-key");
    };

    await assert.rejects(sendAccountEmail({ to: "customer@example.test" }), EmailDeliveryError);
  });
});

test("request timeouts become generic delivery errors", async () => {
  await withEmailSettings(testSettings, async () => {
    AbortSignal.timeout = (milliseconds) => {
      assert.equal(milliseconds, 10_000);
      const controller = new AbortController();
      controller.abort(new DOMException("request timed out", "TimeoutError"));
      return controller.signal;
    };
    globalThis.fetch = async (_url, { signal }) => {
      assert.ok(signal.aborted);
      throw signal.reason;
    };

    await assert.rejects(sendAccountEmail({ to: "customer@example.test" }), EmailDeliveryError);
  });
});

test("invalid provider success responses are not treated as delivered", async () => {
  await withEmailSettings(testSettings, async () => {
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({ message: "provider detail and secret" }),
    });

    await assert.rejects(sendAccountEmail({ to: "customer@example.test" }), EmailDeliveryError);
  });
});
