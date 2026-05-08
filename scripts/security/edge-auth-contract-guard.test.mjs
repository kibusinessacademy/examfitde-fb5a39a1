#!/usr/bin/env node
/**
 * Regression tests for edge-auth-contract-guard.
 * Run: node --test scripts/security/edge-auth-contract-guard.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { scanSource, PUBLIC_FUNCTION_ALLOWLIST } from "./edge-auth-contract-guard.mjs";

const BASE_SERVICE = `
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const sb = createClient(url, serviceKey);
`;

function expectPass(name, src, opts) {
  const { violations } = scanSource(name, src, opts);
  assert.deepEqual(violations, [], `expected PASS but got: ${violations.join("\n")}`);
}
function expectFail(name, src, needle, opts) {
  const { violations } = scanSource(name, src, opts);
  assert.ok(violations.length > 0, `expected FAIL containing "${needle}" but got none`);
  assert.ok(
    violations.some((v) => v.includes(needle)),
    `expected violation containing "${needle}", got:\n${violations.join("\n")}`,
  );
}

test("PASS: assertAdmin present alongside service role", () => {
  expectPass("fn-a", `${BASE_SERVICE}\nimport { assertAdmin } from "../_shared/edgeAuthContract.ts";\nawait assertAdmin(req, "fn-a");`);
});

test("PASS: EDGE_INTERNAL_SHARED_SECRET present", () => {
  expectPass("fn-b", `${BASE_SERVICE}\nconst secret = Deno.env.get("EDGE_INTERNAL_SHARED_SECRET");\nif (req.headers.get("x-internal-secret") !== secret) return new Response("nope", { status: 401 });`);
});

test("PASS: legacy requireAdmin still accepted", () => {
  expectPass("fn-c", `${BASE_SERVICE}\nimport { requireAdmin } from "../_shared/adminGuard.ts";\nawait requireAdmin(req);`);
});

test("PASS: allowlisted public webhook (no guard, uses service role)", () => {
  const name = [...PUBLIC_FUNCTION_ALLOWLIST][0];
  expectPass(name, BASE_SERVICE);
});

test("PASS: function with NO service role usage and no guard", () => {
  expectPass("fn-d", `console.log("hello world");`);
});

test("FAIL: authHeader.includes(serviceKey)", () => {
  expectFail(
    "bad-1",
    `${BASE_SERVICE}\nconst authHeader = req.headers.get("authorization") ?? "";\nif (authHeader.includes(serviceKey)) return ok();`,
    "forbidden pattern",
  );
});

test("FAIL: authHeader.includes(SUPABASE_SERVICE_ROLE_KEY)", () => {
  expectFail(
    "bad-1b",
    `${BASE_SERVICE}\nif (authHeader.includes(SUPABASE_SERVICE_ROLE_KEY)) ok();`,
    "forbidden pattern",
  );
});

test("FAIL: Authorization?.includes(sk)", () => {
  expectFail(
    "bad-1c",
    `${BASE_SERVICE}\nconst sk = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;\nif (Authorization?.includes(sk)) ok();`,
    "forbidden pattern",
  );
});

test("FAIL: trustedSources.includes(...)", () => {
  expectFail(
    "bad-2",
    `${BASE_SERVICE}\nconst trustedSources = ["cron","ci"];\nif (trustedSources.includes(body.source)) return ok();`,
    "trustedSources",
  );
});

test('FAIL: body.source === "ci" bypass', () => {
  expectFail(
    "bad-3",
    `${BASE_SERVICE}\nif (body.source === "ci") return ok();`,
    "bypass",
  );
});

test('FAIL: inline { source: "dashboard" } bypass', () => {
  expectFail(
    "bad-3b",
    `${BASE_SERVICE}\nconst trusted = { source: "dashboard", reason: "ops" };`,
    "bypass",
  );
});

test('FAIL: mode === "simulate" without admin gate', () => {
  expectFail(
    "bad-4",
    `${BASE_SERVICE}\nif (mode === "simulate") { return runSim(); }`,
    "simulate",
  );
});

test('PASS: mode === "simulate" WITH assertAdmin', () => {
  expectPass(
    "ok-sim",
    `${BASE_SERVICE}\nimport { assertAdmin } from "../_shared/edgeAuthContract.ts";\nawait assertAdmin(req,"ok-sim");\nif (mode === "simulate") runSim();`,
  );
});

test("FAIL: NEW SERVICE_ROLE_KEY function without guard (not in baseline)", () => {
  expectFail("brand-new-fn", BASE_SERVICE, "NEW", { baseline: new Set() });
});

test("WARN-only: SERVICE_ROLE_KEY without guard but in baseline", () => {
  const { violations, warnings } = scanSource("legacy-fn", BASE_SERVICE, {
    baseline: new Set(["legacy-fn"]),
  });
  assert.deepEqual(violations, []);
  assert.ok(warnings.some((w) => w.includes("baseline:")));
});

test("WARN: baseline entry that has been fixed (suggests removal)", () => {
  const src = `${BASE_SERVICE}\nimport { assertAdmin } from "../_shared/edgeAuthContract.ts";\nawait assertAdmin(req,"x");`;
  const { violations, warnings } = scanSource("legacy-fixed", src, {
    baseline: new Set(["legacy-fixed"]),
  });
  assert.deepEqual(violations, []);
  assert.ok(warnings.some((w) => w.includes("baseline-fixed")));
});

test("FAIL: x-admin-bypass header check", () => {
  expectFail(
    "bad-5",
    `${BASE_SERVICE}\nif (req.headers.get("x-admin-bypass") === "1") return ok();`,
    "bypass",
  );
});
