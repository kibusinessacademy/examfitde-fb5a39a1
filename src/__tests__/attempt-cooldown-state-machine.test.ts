/**
 * Attempt 1/2/3 Cooldown-Logik — State-Machine-Integrationstest.
 *
 * Spec (Mirror von fn_recover_failed_predecessor_steps + admin_retry_failed_step):
 *   - attempt 1 erlaubt (frischer Step)
 *   - attempt 1 blockiert wenn last_auto_recovery_at < now()-20min (cooldown)
 *   - attempt 2 erst nach Cooldown-Ablauf (>20min)
 *   - attempt 3 blockiert in Cooldown
 *   - attempt 3 ist letzter Auto-Versuch; danach max_attempts → manueller Bypass
 *
 * Außerdem: invariant Tests gegen Off-by-One (genau 3, nicht 2 oder 4).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const COOLDOWN_MS = 20 * 60 * 1000;
const MAX_ATTEMPTS = 3;

type StepState = {
  auto_recovery_count: number;
  last_auto_recovery_at: string | null;
  status: "failed" | "queued" | "running" | "done";
};

type RetryOutcome =
  | { ok: true; nextAttempt: number; nextState: StepState }
  | { ok: false; reason: "cooldown" | "max_attempts" | "not_failed"; manualBypassRequired?: boolean };

function tryRetry(step: StepState, now: number = Date.now()): RetryOutcome {
  if (step.status !== "failed") return { ok: false, reason: "not_failed" };
  if (step.auto_recovery_count >= MAX_ATTEMPTS) {
    return { ok: false, reason: "max_attempts", manualBypassRequired: true };
  }
  if (step.last_auto_recovery_at) {
    const elapsed = now - new Date(step.last_auto_recovery_at).getTime();
    if (elapsed < COOLDOWN_MS) return { ok: false, reason: "cooldown" };
  }
  const nextAttempt = step.auto_recovery_count + 1;
  return {
    ok: true,
    nextAttempt,
    nextState: {
      auto_recovery_count: nextAttempt,
      last_auto_recovery_at: new Date(now).toISOString(),
      status: "queued",
    },
  };
}

const T0 = new Date("2026-05-05T06:00:00Z").getTime();

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});
afterEach(() => vi.useRealTimers());

describe("Attempt 1/2/3 State-Machine — happy path", () => {
  it("vollständiger Lifecycle: 0 → 1 → 2 → 3 → max_attempts (manueller Bypass)", () => {
    let step: StepState = { auto_recovery_count: 0, last_auto_recovery_at: null, status: "failed" };

    // Attempt 1
    const r1 = tryRetry(step);
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    expect(r1.nextAttempt).toBe(1);
    step = { ...r1.nextState, status: "failed" }; // Re-failed nach Job-Run

    // Sofortiger Re-Try → cooldown
    const r1b = tryRetry(step);
    expect(r1b.ok).toBe(false);
    if (r1b.ok) return;
    expect(r1b.reason).toBe("cooldown");

    // Cooldown abwarten → Attempt 2
    vi.advanceTimersByTime(COOLDOWN_MS + 1_000);
    const r2 = tryRetry(step);
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    expect(r2.nextAttempt).toBe(2);
    step = { ...r2.nextState, status: "failed" };

    // Innerhalb Cooldown blockiert
    vi.advanceTimersByTime(5 * 60 * 1000);
    const r2b = tryRetry(step);
    expect(r2b.ok).toBe(false);
    if (r2b.ok) return;
    expect(r2b.reason).toBe("cooldown");

    // Nach Cooldown → Attempt 3
    vi.advanceTimersByTime(COOLDOWN_MS);
    const r3 = tryRetry(step);
    expect(r3.ok).toBe(true);
    if (!r3.ok) return;
    expect(r3.nextAttempt).toBe(3);
    step = { ...r3.nextState, status: "failed" };

    // 4. Versuch (auch nach Cooldown) → manueller Bypass
    vi.advanceTimersByTime(COOLDOWN_MS + 1_000);
    const r4 = tryRetry(step);
    expect(r4.ok).toBe(false);
    if (r4.ok) return;
    expect(r4.reason).toBe("max_attempts");
    expect(r4.manualBypassRequired).toBe(true);
  });
});

describe("Attempt-Cap-Invarianten", () => {
  it("attempt 3 ist erlaubt (Grenzfall <)", () => {
    const r = tryRetry({ auto_recovery_count: 2, last_auto_recovery_at: null, status: "failed" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.nextAttempt).toBe(3);
  });

  it("attempt 4 blockiert ohne Cooldown-Check (max_attempts hat Vorrang)", () => {
    const recent = new Date(T0 - 1_000).toISOString();
    const r = tryRetry({ auto_recovery_count: 3, last_auto_recovery_at: recent, status: "failed" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("max_attempts");
  });

  it("Cooldown-Grenze exakt 20min: 19:59 blockiert, 20:01 erlaubt", () => {
    const t = (offset: number) => new Date(T0 - COOLDOWN_MS + offset).toISOString();
    const just_under = tryRetry(
      { auto_recovery_count: 1, last_auto_recovery_at: t(60_000), status: "failed" },
    );
    expect(just_under.ok).toBe(false);
    const just_over = tryRetry(
      { auto_recovery_count: 1, last_auto_recovery_at: t(-60_000), status: "failed" },
    );
    expect(just_over.ok).toBe(true);
  });

  it("non-failed Step: kein Retry möglich (verhindert doppelte Enqueue)", () => {
    const r = tryRetry({ auto_recovery_count: 0, last_auto_recovery_at: null, status: "queued" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("not_failed");
  });
});

describe("Manueller Bypass = Reset des Counters", () => {
  // Spec: admin_resolve_council_deferred force_pass / Bronze-Tag setzt
  // auto_recovery_count zurück bzw. umgeht den Cap.
  it("manueller Bypass setzt counter zurück, Lifecycle ist wieder verfügbar", () => {
    let step: StepState = { auto_recovery_count: 3, last_auto_recovery_at: new Date(T0).toISOString(), status: "failed" };
    const blocked = tryRetry(step);
    expect(blocked.ok).toBe(false);

    // Bypass-Action: counter=0, last_auto_recovery_at=null
    step = { ...step, auto_recovery_count: 0, last_auto_recovery_at: null };
    const after = tryRetry(step);
    expect(after.ok).toBe(true);
    if (after.ok) expect(after.nextAttempt).toBe(1);
  });
});
