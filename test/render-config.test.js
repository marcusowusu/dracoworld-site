import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const renderConfig = await readFile(new URL("../render.yaml", import.meta.url), "utf8");

test("Render web service uses the Free plan", () => {
  assert.match(renderConfig, /^\s+plan:\s*free\s*$/m);
});

test("Render config does not run a pre-deploy migration", () => {
  assert.doesNotMatch(renderConfig, /^\s+preDeployCommand\s*:/m);
});

test("Render config declares Resend settings without SMTP settings", () => {
  assert.match(renderConfig, /^\s+- key:\s*RESEND_API_KEY\s*$/m);
  assert.match(renderConfig, /^\s+- key:\s*EMAIL_FROM\s*$/m);
  assert.doesNotMatch(renderConfig, /^\s+- key:\s*SMTP_/m);
});
