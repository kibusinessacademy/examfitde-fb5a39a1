/**
 * Cut 6.1 Phase 3 — Audit-Contract-Shape-Tests
 *
 * Statische Garantien gegen Audit-Drift:
 *  - Edge-Function `hr-demo-personalize` darf NUR die 3 registrierten
 *    signal_types verwenden (invoked / completed / rate_limited)
 *  - DemoHrPage darf NUR die 4 SSOT-Funnel-Events feuern
 *
 * Diese Tests sind absichtlich grep-basiert (keine Runtime-Mocks nötig),
 * damit sie als CI-Gate gegen versehentliche Drift wirken.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "../..");

const CANONICAL_SIGNAL_TYPES = new Set([
  "demo_personalize_invoked",
  "demo_personalize_completed",
  "demo_personalize_rate_limited",
]);

const ALLOWED_FUNNEL_EVENTS = new Set([
  "lead_magnet_view",
  "quiz_started",
  "quiz_completed",
  "hero_cta_click",
]);

describe("Cut 6.1 Phase 3 — Audit-Contract Shape", () => {
  it("hr-demo-personalize verwendet nur registrierte signal_types", () => {
    const src = readFileSync(
      resolve(ROOT, "../supabase/functions/hr-demo-personalize/index.ts"),
      "utf-8",
    );
    const matches = [...src.matchAll(/_signal_type:\s*["']([^"']+)["']/g)].map((m) => m[1]);
    expect(matches.length).toBeGreaterThan(0);
    for (const sig of matches) {
      expect(CANONICAL_SIGNAL_TYPES.has(sig), `Unregistered signal_type "${sig}"`).toBe(true);
    }
    // Alle 3 Contracts müssen tatsächlich auch ausgelöst werden
    expect(matches).toContain("demo_personalize_invoked");
    expect(matches).toContain("demo_personalize_completed");
    expect(matches).toContain("demo_personalize_rate_limited");
  });

  it("DemoHrPage feuert nur erlaubte Funnel-Events", () => {
    const src = readFileSync(resolve(ROOT, "pages/demo/DemoHrPage.tsx"), "utf-8");
    const matches = [...src.matchAll(/trackFunnel\(\s*["']([^"']+)["']/g)].map((m) => m[1]);
    expect(matches.length).toBeGreaterThan(0);
    for (const ev of matches) {
      expect(ALLOWED_FUNNEL_EVENTS.has(ev), `Unexpected funnel event "${ev}"`).toBe(true);
    }
    // Pflicht-Events für das Demo
    expect(matches).toContain("lead_magnet_view");
    expect(matches).toContain("quiz_started");
    expect(matches).toContain("quiz_completed");
  });
});
