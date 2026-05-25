import { describe, expect, it } from "vitest";
import { resolveIntent } from "@/lib/intent/router";
import { chooseAdaptiveCta } from "@/lib/intent/adaptive-cta";
import { tutorHint } from "@/lib/intent/tutor-hints";

describe("W1 Cut 3 — adaptive CTA engine (golden)", () => {
  it("failure recovery dominates over exam date", () => {
    const intent = resolveIntent({ path: "/durchgefallen" });
    const d = chooseAdaptiveCta(intent, { behaviour: { days_to_exam: 10 } }, {
      weakest_competency: "Kalkulation",
    });
    expect(d.variant).toBe("recovery");
    expect(d.reason).toBe("failure_recovery");
    expect(d.message).toContain("Kalkulation");
  });

  it("oral exam intent routes to oral simulation", () => {
    const intent = resolveIntent({ path: "/wissen/beruf/x/muendliche-pruefung" });
    const d = chooseAdaptiveCta(intent, {});
    expect(d.variant).toBe("oral");
    expect(d.action_type).toBe("oral_simulation");
    expect(d.reason).toBe("oral_exam_focus");
  });

  it("imminent exam (<=14d) sets critical urgency framing", () => {
    const intent = resolveIntent({ path: "/" });
    const d = chooseAdaptiveCta(intent, { behaviour: { days_to_exam: 7 } });
    expect(d.variant).toBe("urgency");
    expect(d.urgency_level).toBe("critical");
    expect(d.reason).toBe("exam_imminent");
    expect(d.message).toContain("7 Tage");
  });

  it("high risk readiness yields risk framing with empathic tone", () => {
    const intent = resolveIntent({ path: "/", readiness: { readiness_score: 38, risk_level: "high", weak_count: 3 } });
    const d = chooseAdaptiveCta(intent, { readiness: { readiness_score: 38, risk_level: "high", weak_count: 3 } });
    expect(d.variant).toBe("risk");
    expect(d.tone).toBe("empathic");
    expect(d.message).toContain("3");
  });

  it("high mastery learner gets confidence push to simulation", () => {
    const sig = { readiness: { readiness_score: 86, risk_level: "low" as const } };
    const intent = resolveIntent(sig);
    const d = chooseAdaptiveCta(intent, sig);
    expect(d.variant).toBe("confidence");
    expect(d.action_type).toBe("exam_simulation");
    expect(d.reason).toBe("high_mastery");
  });

  it("unknown intent without readiness ⇒ diagnostic", () => {
    const intent = resolveIntent({});
    const d = chooseAdaptiveCta(intent, {});
    expect(d.variant).toBe("diagnostic");
    expect(d.action_type).toBe("diagnose_quiz");
    expect(d.reason).toBe("no_baseline");
  });

  it("deterministic — same input ⇒ same output", () => {
    const sig = {
      path: "/lernplan",
      behaviour: { days_to_exam: 30 },
      readiness: { readiness_score: 60, risk_level: "medium" as const },
    };
    const a = chooseAdaptiveCta(resolveIntent(sig), sig);
    const b = chooseAdaptiveCta(resolveIntent(sig), sig);
    expect(a).toStrictEqual(b);
  });

  it("tutor hint surfaces confusion pattern when provided", () => {
    const intent = resolveIntent({});
    const h = tutorHint(intent, {}, { confused_pair: { a: "Deckungsbeitrag", b: "Gewinn" } });
    expect(h.kind).toBe("confusion_pattern");
    expect(h.framing).toContain("Deckungsbeitrag");
    expect(h.framing).toContain("Gewinn");
  });

  it("tutor hint escalates exam_imminent", () => {
    const intent = resolveIntent({});
    const h = tutorHint(intent, { behaviour: { days_to_exam: 9 } });
    expect(h.kind).toBe("exam_imminent");
    expect(h.framing).toContain("9 Tage");
  });
});
