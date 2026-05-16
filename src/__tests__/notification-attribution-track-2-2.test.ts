import { describe, it, expect } from "vitest";

// Mirror of param parsing in useNotificationAttribution
function parseAttribution(search: string) {
  const p = new URLSearchParams(search);
  return {
    jobId: p.get("nj"),
    kind: p.get("nj_k"),
    isCta: p.get("nj_cta") === "1",
  };
}

describe("notification attribution params (Track 2.2)", () => {
  it("parses nj/nj_k/nj_cta from SW-injected URL", () => {
    const a = parseAttribution("?nj=abc-123&nj_k=weak_competency_drill&nj_cta=1&nj_t=9");
    expect(a.jobId).toBe("abc-123");
    expect(a.kind).toBe("weak_competency_drill");
    expect(a.isCta).toBe(true);
  });

  it("treats missing nj_cta as non-CTA reentry", () => {
    const a = parseAttribution("?nj=abc-123&nj_k=exam_countdown");
    expect(a.isCta).toBe(false);
  });

  it("returns null jobId when nj absent", () => {
    expect(parseAttribution("").jobId).toBeNull();
  });
});

describe("learner trust-UX why-text (Track 2.2 registry-driven)", () => {
  // Suppression reason wins, then registry.trigger_reason, then fallback.
  function whyText(args: {
    state: string;
    suppression_reason: string | null;
    intent?: { trigger_reason?: string; description?: string };
  }): string {
    const REASON: Record<string, string> = {
      channel_optout: "Kanal deaktiviert",
      quiet_hours: "Ruhezeit",
      fatigue_suppress: "Erschöpfungsschutz",
      daily_cap: "Tageslimit",
    };
    if (args.state === "suppressed") {
      const k = args.suppression_reason ?? "unknown";
      return REASON[k] ?? `Unterdrückt: ${k}`;
    }
    if (args.intent) return args.intent.trigger_reason || args.intent.description || "Empfehlung deiner Lernsteuerung.";
    return "Empfehlung deiner Lernsteuerung.";
  }

  it("uses suppression reason for suppressed jobs", () => {
    expect(whyText({ state: "suppressed", suppression_reason: "quiet_hours" })).toBe("Ruhezeit");
  });

  it("uses registry trigger_reason when present", () => {
    expect(whyText({
      state: "delivered", suppression_reason: null,
      intent: { trigger_reason: "Erkannte Lücke in einer Kernkompetenz." },
    })).toBe("Erkannte Lücke in einer Kernkompetenz.");
  });

  it("falls back to generic text without intent", () => {
    expect(whyText({ state: "delivered", suppression_reason: null })).toMatch(/Empfehlung/);
  });
});
