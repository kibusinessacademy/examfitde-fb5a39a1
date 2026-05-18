import { describe, it, expect } from "vitest";
import { planActivationNudge } from "@/features/activation/planActivationNudge";

describe("planActivationNudge (Cut 1c)", () => {
  it("returns none when grant is not stale", () => {
    const p = planActivationNudge({
      current_stage: "grant_created",
      missing_next_step: "open_welcome",
      is_stale_activation: false,
    });
    expect(p.nudge_type).toBe("none");
  });

  it("routes grant_created → return_to_welcome", () => {
    const p = planActivationNudge({
      current_stage: "grant_created",
      missing_next_step: "open_welcome",
      is_stale_activation: true,
      blocked_reason: "no_welcome_after_15min",
    });
    expect(p.nudge_type).toBe("return_to_welcome");
    expect(p.audit.current_stage).toBe("grant_created");
    expect(p.audit.blocked_reason).toBe("no_welcome_after_15min");
  });

  it("routes welcome_seen + stale → start_minicheck", () => {
    const p = planActivationNudge({
      current_stage: "welcome_seen",
      missing_next_step: "start_minicheck",
      is_stale_activation: true,
    });
    expect(p.nudge_type).toBe("start_minicheck");
  });

  it("routes first_minicheck_completed → complete_aha", () => {
    const p = planActivationNudge({
      current_stage: "first_minicheck_completed",
      missing_next_step: "view_aha_feedback",
      is_stale_activation: true,
    });
    expect(p.nudge_type).toBe("complete_aha");
  });

  it("routes aha_completed → start_learning_plan", () => {
    const p = planActivationNudge({
      current_stage: "aha_completed",
      missing_next_step: "start_learning_plan",
      is_stale_activation: true,
    });
    expect(p.nudge_type).toBe("start_learning_plan");
  });

  it("lernplan_started is terminal — no nudge", () => {
    const p = planActivationNudge({
      current_stage: "lernplan_started",
      missing_next_step: "none",
      is_stale_activation: true,
    });
    expect(p.nudge_type).toBe("none");
  });

  it("audit payload never includes PII", () => {
    const p = planActivationNudge({
      current_stage: "welcome_seen",
      missing_next_step: "start_minicheck",
      is_stale_activation: true,
    });
    const keys = Object.keys(p.audit);
    expect(keys.sort()).toEqual(["blocked_reason", "current_stage", "nudge_type"]);
  });
});
