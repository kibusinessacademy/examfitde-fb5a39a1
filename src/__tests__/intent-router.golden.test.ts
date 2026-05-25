import { describe, expect, it } from "vitest";
import { resolveIntent } from "@/lib/intent/router";
import { ctaFor } from "@/lib/intent/cta-map";
import { INTENT_KINDS } from "@/lib/intent/types";

describe("intent router — golden", () => {
  it("matches path rule deterministically", () => {
    const r = resolveIntent({ path: "/wissen/beruf/industriekaufmann/muendliche-pruefung" });
    expect(r.primary).toBe("muendliche_pruefung");
    expect(r.recommended_surface).toBe("oral_simulation");
    expect(r.confidence).toBeGreaterThan(0.8);
  });

  it("durchgefallen beats angst when both present (rule order)", () => {
    const r = resolveIntent({ query: "?angst&durchgefallen" });
    expect(r.primary).toBe("durchgefallen");
    expect(r.urgency).toBe("critical");
  });

  it("escalates urgency on near exam date", () => {
    const r = resolveIntent({
      path: "/lernplan",
      behaviour: { days_to_exam: 10 },
    });
    expect(r.primary).toBe("lernplan");
    expect(r.urgency).toBe("critical");
  });

  it("falls back via readiness when no path rule matches", () => {
    const r = resolveIntent({
      path: "/",
      readiness: { readiness_score: 42, risk_level: "high" },
    });
    expect(r.primary).toBe("kompetenzproblem");
    expect(r.recommended_surface).toBe("weakness_training");
  });

  it("returns unknown safe-default for empty signals", () => {
    const r = resolveIntent({});
    expect(r.primary).toBe("unknown");
    expect(r.recommended_surface).toBe("diagnose_quiz");
  });

  it("is deterministic — same input ⇒ same output", () => {
    const sig = { path: "/pruefungssimulation", behaviour: { days_to_exam: 30 } };
    const a = resolveIntent(sig);
    const b = resolveIntent(sig);
    expect(a).toStrictEqual(b);
  });

  it("every IntentKind has a CTA mapping", () => {
    for (const k of INTENT_KINDS) {
      const cta = ctaFor(k);
      expect(cta.primary.label.length).toBeGreaterThan(0);
      expect(cta.primary.surface).toBeTruthy();
    }
  });
});
