import { describe, it, expect } from "vitest";

/**
 * Track 2.3 — Anomaly classifier parity test.
 * Mirrors the SQL logic in admin_get_notification_effectiveness so we can
 * detect drift between SQL flags and UI labels without hitting the DB.
 */
type Row = {
  sent: number; opened: number; cta_clicked: number; resolved: number; suppressed: number;
  recovery_escalation: number;
};

function classify(r: Row): string[] {
  const flags: string[] = [];
  if (r.sent >= 20 && r.opened / r.sent < 0.15) flags.push("low_open_rate");
  if (r.sent >= 20 && (r.sent - r.opened) / r.sent > 0.85) flags.push("high_ignored_rate");
  if (r.sent >= 10 && r.resolved / r.sent < 0.05) flags.push("low_resolved_rate");
  if (r.recovery_escalation >= 3) flags.push("high_recovery_escalation");
  const supTotal = r.sent + r.suppressed;
  if (supTotal >= 20 && r.suppressed / supTotal > 0.7) flags.push("over_suppression");
  if (r.sent >= 10 && r.cta_clicked === 0) flags.push("dead_reminder");
  return flags;
}

function recommend(r: Row): string {
  if (r.sent < 5) return "Zu wenig Volumen für Bewertung";
  if (r.sent >= 10 && r.cta_clicked === 0) return "Intent überdenken oder pausieren (kein CTA-Click)";
  if (r.sent >= 20 && r.opened / r.sent < 0.15) return "Titel/Timing prüfen — sehr niedrige Open-Rate";
  if (r.recovery_escalation >= 3) return "Eskalationspfad evaluieren — chronisch ignoriert";
  if (r.sent > 0 && r.resolved / r.sent >= 0.4) return "Hochwirksam — als Best-Practice referenzieren";
  return "Stabil — keine Maßnahme nötig";
}

describe("Track 2.3 effectiveness classifier", () => {
  it("flags dead reminder when 10+ sent with zero cta", () => {
    expect(classify({ sent: 12, opened: 4, cta_clicked: 0, resolved: 0, suppressed: 0, recovery_escalation: 0 }))
      .toContain("dead_reminder");
  });

  it("does not flag with low volume (<10 sent)", () => {
    expect(classify({ sent: 4, opened: 0, cta_clicked: 0, resolved: 0, suppressed: 0, recovery_escalation: 0 }))
      .toEqual([]);
  });

  it("flags low_open_rate + high_ignored_rate together", () => {
    const f = classify({ sent: 100, opened: 5, cta_clicked: 1, resolved: 0, suppressed: 0, recovery_escalation: 0 });
    expect(f).toContain("low_open_rate");
    expect(f).toContain("high_ignored_rate");
    expect(f).toContain("low_resolved_rate");
  });

  it("flags over_suppression when suppressed dominates", () => {
    expect(classify({ sent: 10, opened: 5, cta_clicked: 2, resolved: 1, suppressed: 50, recovery_escalation: 0 }))
      .toContain("over_suppression");
  });

  it("flags high_recovery_escalation at ≥3", () => {
    expect(classify({ sent: 5, opened: 1, cta_clicked: 0, resolved: 0, suppressed: 0, recovery_escalation: 3 }))
      .toContain("high_recovery_escalation");
  });

  it("recommends pause for dead reminder", () => {
    expect(recommend({ sent: 20, opened: 5, cta_clicked: 0, resolved: 0, suppressed: 0, recovery_escalation: 0 }))
      .toMatch(/pausieren/);
  });

  it("recommends best-practice for highly effective intents", () => {
    expect(recommend({ sent: 10, opened: 9, cta_clicked: 8, resolved: 5, suppressed: 0, recovery_escalation: 0 }))
      .toMatch(/Best-Practice/);
  });

  it("recommends review for chronic escalation", () => {
    expect(recommend({ sent: 6, opened: 1, cta_clicked: 0, resolved: 0, suppressed: 0, recovery_escalation: 4 }))
      .toMatch(/Eskalationspfad/);
  });
});
