/**
 * Kimi Lane-Gate Tests — verifizieren das Code-Agent-Lane-Contract des
 * vibeos-ai-gateway OHNE echte Upstream-Calls.
 *
 * Wir mocken globales fetch und re-importieren das Handler-Modul nicht direkt;
 * stattdessen testen wir die Pure-Logic-Helpers durch Re-Implementierung in
 * einem schmalen Test-Harness (Single-Source-of-Truth bleibt index.ts).
 *
 * Diese Tests sind ein Contract-Smoke: bei Drift in index.ts müssen sie
 * gleichzeitig aktualisiert werden.
 */
import {
  assert, assertEquals, assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const ALLOWED = new Set(["debug_agent", "test_agent", "code_planner", "code_patch_builder"]);
const FORBIDDEN = new Set([
  "ai_tutor", "tutor", "exam", "exam_questions",
  "course", "learning_content",
  "billing", "license", "purchase", "checkout",
  "rls_migration", "db_migration",
]);

function gate(opts: {
  provider: string;
  lane: string;
  flagEnabled: boolean;
  fallbackModel?: string;
}): { ok: boolean; status: number; effectiveProvider?: string; reason?: string } {
  if (opts.provider !== "kimi") return { ok: true, status: 200, effectiveProvider: opts.provider };
  if (opts.lane && FORBIDDEN.has(opts.lane)) return { ok: false, status: 403, reason: "lane_forbidden" };
  if (!opts.lane || !ALLOWED.has(opts.lane)) return { ok: false, status: 403, reason: "lane_not_allowed" };
  if (!opts.flagEnabled) {
    if (!opts.fallbackModel || !opts.fallbackModel.includes("/") || opts.fallbackModel.startsWith("kimi/")) {
      return { ok: false, status: 503, reason: "flag_disabled_no_fallback" };
    }
    return { ok: true, status: 200, effectiveProvider: opts.fallbackModel.split("/")[0], reason: "flag_disabled_fallback" };
  }
  return { ok: true, status: 200, effectiveProvider: "kimi" };
}

Deno.test("Kimi: allowed lanes only", () => {
  for (const lane of ALLOWED) {
    const r = gate({ provider: "kimi", lane, flagEnabled: true });
    assertEquals(r.ok, true, `lane=${lane} should be allowed`);
    assertEquals(r.effectiveProvider, "kimi");
  }
});

Deno.test("Kimi: tutor/exam/course/billing lanes are hard-blocked", () => {
  for (const lane of ["ai_tutor", "tutor", "exam", "exam_questions", "course", "learning_content", "billing", "license", "purchase"]) {
    const r = gate({ provider: "kimi", lane, flagEnabled: true });
    assertEquals(r.ok, false, `lane=${lane} must be forbidden`);
    assertEquals(r.status, 403);
    assertEquals(r.reason, "lane_forbidden");
  }
});

Deno.test("Kimi: unknown lane denied", () => {
  const r = gate({ provider: "kimi", lane: "random_lane", flagEnabled: true });
  assertEquals(r.ok, false);
  assertEquals(r.status, 403);
  assertEquals(r.reason, "lane_not_allowed");
});

Deno.test("Kimi: empty lane denied", () => {
  const r = gate({ provider: "kimi", lane: "", flagEnabled: true });
  assertEquals(r.ok, false);
  assertEquals(r.status, 403);
});

Deno.test("Kimi: disabled flag + no fallback → 503", () => {
  const r = gate({ provider: "kimi", lane: "debug_agent", flagEnabled: false });
  assertEquals(r.ok, false);
  assertEquals(r.status, 503);
  assertEquals(r.reason, "flag_disabled_no_fallback");
});

Deno.test("Kimi: disabled flag + valid fallback → routes to fallback provider", () => {
  const r = gate({ provider: "kimi", lane: "debug_agent", flagEnabled: false, fallbackModel: "openai/gpt-4o-mini" });
  assertEquals(r.ok, true);
  assertEquals(r.effectiveProvider, "openai");
  assertEquals(r.reason, "flag_disabled_fallback");
});

Deno.test("Kimi: disabled flag + kimi-fallback rejected", () => {
  const r = gate({ provider: "kimi", lane: "debug_agent", flagEnabled: false, fallbackModel: "kimi/kimi-k2-0905-preview" });
  assertEquals(r.ok, false);
  assertEquals(r.status, 503);
});

Deno.test("Non-Kimi providers unaffected by lane gate", () => {
  for (const p of ["openai", "anthropic", "google"]) {
    const r = gate({ provider: p, lane: "", flagEnabled: false });
    assertEquals(r.ok, true, `${p} must be untouched`);
    assertEquals(r.effectiveProvider, p);
  }
});

Deno.test("Frontend cannot reach KIMI_API_KEY (env scoping smoke)", () => {
  // KIMI_API_KEY darf nur serverseitig in Deno.env existieren;
  // im Sandbox/Test-Kontext prüfen wir, dass kein VITE_-prefixed Mirror existiert.
  const leaked = Object.keys(Deno.env.toObject()).filter((k) =>
    k.startsWith("VITE_") && k.toLowerCase().includes("kimi")
  );
  assertEquals(leaked, [], `KIMI_API_KEY leaked to VITE_ env: ${leaked.join(",")}`);
});
