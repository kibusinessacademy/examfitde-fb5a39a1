import { describe, it, expect } from "vitest";
import { classifyActivationNudge } from "@/features/activation/classifyActivationNudge";

describe("classifyActivationNudge (Cut 1d) — mirror of fn_classify_activation_nudge", () => {
  it("inactive_24h wins over stage when blocked_reason is no_first_value_after_24h", () => {
    expect(classifyActivationNudge("welcome_seen", "no_first_value_after_24h")).toBe("inactive_24h");
  });
  it("grant_created → welcome_not_started", () => {
    expect(classifyActivationNudge("grant_created", null)).toBe("welcome_not_started");
  });
  it("welcome_seen / first_minicheck_started → first_task_missing", () => {
    expect(classifyActivationNudge("welcome_seen", null)).toBe("first_task_missing");
    expect(classifyActivationNudge("first_minicheck_started", null)).toBe("first_task_missing");
  });
  it("first_minicheck_completed → aha_missing", () => {
    expect(classifyActivationNudge("first_minicheck_completed", null)).toBe("aha_missing");
  });
  it("aha_completed → plan_missing", () => {
    expect(classifyActivationNudge("aha_completed", null)).toBe("plan_missing");
  });
  it("lernplan_started → none (terminal)", () => {
    expect(classifyActivationNudge("lernplan_started", null)).toBe("none");
  });
});
