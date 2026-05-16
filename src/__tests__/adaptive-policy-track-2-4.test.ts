import { describe, it, expect } from "vitest";

// Mirror of SQL classifier in admin_recompute_adaptive_policies — keeps determinism testable client-side.
type Metrics = {
  sent: number; open_rate: number; resolved_rate: number;
  anomaly_flags: string[];
  best_alt_resolved_rate: number | null;
};
type Intent = { safety_class: "standard" | "sensitive" | "critical"; min_delivery_floor: "none" | "neutral" | "prefer" };

function propose(m: Metrics, intent: Intent, minSample = 30): { strategy: string; reasons: string[]; guard: string } {
  let strategy = "neutral";
  const reasons: string[] = [];
  let guard = "none";

  if (m.sent < minSample) { strategy = "neutral"; reasons.push("insufficient_sample"); }
  else if (m.anomaly_flags.includes("dead_reminder")) { strategy = "downrank"; reasons.push("dead_reminder"); }
  else if (m.anomaly_flags.includes("high_recovery_escalation")) { strategy = "cooldown"; reasons.push("high_recovery_escalation"); }
  else if (m.open_rate < 0.15 && m.best_alt_resolved_rate !== null && m.best_alt_resolved_rate > m.resolved_rate) {
    strategy = "downrank"; reasons.push("low_open_rate", "channel_alt_outperforms");
  } else if (m.resolved_rate >= 0.40 && m.open_rate >= 0.35) {
    strategy = "prefer"; reasons.push("strong_resolved_rate", "strong_open_rate");
  } else if (m.anomaly_flags.includes("low_resolved_rate")) {
    strategy = "downrank"; reasons.push("low_resolved_rate");
  } else { reasons.push("within_normal_range"); }

  if (intent.safety_class === "critical" && ["downrank", "cooldown", "suppress"].includes(strategy)) {
    strategy = intent.min_delivery_floor === "prefer" ? "prefer" : "neutral";
    reasons.push("safety_critical_clamped");
    guard = "safety_clamp";
  } else if (intent.safety_class === "sensitive" && strategy === "suppress") {
    strategy = "downrank";
    reasons.push("safety_sensitive_no_suppress");
    guard = "safety_clamp";
  }
  return { strategy, reasons, guard };
}

describe("adaptive policy classifier (Track 2.4)", () => {
  const std: Intent = { safety_class: "standard", min_delivery_floor: "none" };
  const critical: Intent = { safety_class: "critical", min_delivery_floor: "neutral" };

  it("returns neutral with insufficient sample", () => {
    const r = propose({ sent: 5, open_rate: 0.5, resolved_rate: 0.5, anomaly_flags: [], best_alt_resolved_rate: null }, std);
    expect(r.strategy).toBe("neutral");
    expect(r.reasons).toContain("insufficient_sample");
  });

  it("downranks on dead_reminder", () => {
    const r = propose({ sent: 100, open_rate: 0, resolved_rate: 0, anomaly_flags: ["dead_reminder"], best_alt_resolved_rate: null }, std);
    expect(r.strategy).toBe("downrank");
    expect(r.reasons).toContain("dead_reminder");
  });

  it("prefers high resolved + high open", () => {
    const r = propose({ sent: 100, open_rate: 0.6, resolved_rate: 0.5, anomaly_flags: [], best_alt_resolved_rate: null }, std);
    expect(r.strategy).toBe("prefer");
  });

  it("clamps downrank to neutral for critical safety_class", () => {
    const r = propose({ sent: 100, open_rate: 0, resolved_rate: 0, anomaly_flags: ["dead_reminder"], best_alt_resolved_rate: null }, critical);
    expect(r.strategy).toBe("neutral");
    expect(r.guard).toBe("safety_clamp");
    expect(r.reasons).toContain("safety_critical_clamped");
  });

  it("downranks when alt channel outperforms on low open_rate", () => {
    const r = propose({ sent: 200, open_rate: 0.05, resolved_rate: 0.02, anomaly_flags: [], best_alt_resolved_rate: 0.3 }, std);
    expect(r.strategy).toBe("downrank");
    expect(r.reasons).toContain("low_open_rate");
  });

  it("cooldowns on high_recovery_escalation", () => {
    const r = propose({ sent: 100, open_rate: 0.3, resolved_rate: 0.1, anomaly_flags: ["high_recovery_escalation"], best_alt_resolved_rate: null }, std);
    expect(r.strategy).toBe("cooldown");
  });
});
