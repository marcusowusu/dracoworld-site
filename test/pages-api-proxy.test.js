import assert from "node:assert/strict";
import { test } from "node:test";
import { onRequest } from "../functions/api/[[path]].js";

test("Pages API proxy targets its configured origin and preserves API request data", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  let upstreamRequest;
  globalThis.fetch = async (url, options) => {
    upstreamRequest = { url: String(url), ...options };
    return new Response("accepted", { status: 201 });
  };

  const response = await onRequest({
    env: { API_ORIGIN: "https://api.example.test" },
    request: new Request("https://store.example.test/api/auth/login?continue=%2Faccount", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: "dw_csrf=csrf-value; __Host-dw_session=session-value",
        origin: "https://store.example.test",
        "x-csrf-token": "csrf-value",
        "x-forwarded-host": "attacker.example",
        "x-forwarded-for": "192.0.2.1",
      },
      body: JSON.stringify({ email: "customer@example.test" }),
    }),
  });

  assert.equal(upstreamRequest.url, "https://api.example.test/api/auth/login?continue=%2Faccount");
  assert.equal(upstreamRequest.method, "POST");
  assert.equal(upstreamRequest.redirect, "manual");
  assert.equal(upstreamRequest.cache, "no-store");
  assert.equal(upstreamRequest.headers.get("cookie"), "dw_csrf=csrf-value; __Host-dw_session=session-value");
  assert.equal(upstreamRequest.headers.get("origin"), "https://store.example.test");
  assert.equal(upstreamRequest.headers.get("x-csrf-token"), "csrf-value");
  assert.equal(upstreamRequest.headers.get("x-forwarded-host"), null);
  assert.equal(upstreamRequest.headers.get("x-forwarded-for"), null);
  assert.equal(upstreamRequest.headers.get("cache-control"), "no-store");
  assert.equal(await new Response(upstreamRequest.body).text(), JSON.stringify({ email: "customer@example.test" }));
  assert.equal(response.status, 201);
  assert.equal(response.headers.get("cache-control"), "no-store, private, max-age=0, must-revalidate");
  assert.equal(response.headers.get("pragma"), "no-cache");
  assert.equal(await response.text(), "accepted");
});

test("Pages API proxy keeps double-slash paths on the configured origin", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  let upstreamUrl;
  globalThis.fetch = async (url) => {
    upstreamUrl = new URL(url);
    return new Response(null, { status: 204 });
  };

  await onRequest({
    env: { API_ORIGIN: "https://api.example.test" },
    request: new Request("https://store.example.test/api//attacker.example/path"),
  });

  assert.equal(upstreamUrl.origin, "https://api.example.test");
  assert.equal(upstreamUrl.pathname, "/api//attacker.example/path");
});

test("Pages API proxy preserves separate Set-Cookie response headers", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = async () => {
    const headers = new Headers();
    headers.append("set-cookie", "__Host-dw_session=session; Path=/; HttpOnly; Secure; SameSite=Lax");
    headers.append("set-cookie", "__Host-dw_csrf=csrf; Path=/; Secure; SameSite=Strict");
    return new Response(null, { headers });
  };

  const response = await onRequest({
    env: { API_ORIGIN: "https://api.example.test" },
    request: new Request("https://store.example.test/api/auth/login"),
  });

  assert.deepEqual(response.headers.getSetCookie(), [
    "__Host-dw_session=session; Path=/; HttpOnly; Secure; SameSite=Lax",
    "__Host-dw_csrf=csrf; Path=/; Secure; SameSite=Strict",
  ]);
});

test("Pages API proxy rejects missing or unsafe upstream origin bindings", async () => {
  const request = new Request("https://store.example.test/api/health");

  for (const API_ORIGIN of [undefined, "http://api.example.test", "https://api.example.test/base", "https://user:pass@api.example.test"]) {
    await assert.rejects(onRequest({ env: { API_ORIGIN }, request }));
  }
});
