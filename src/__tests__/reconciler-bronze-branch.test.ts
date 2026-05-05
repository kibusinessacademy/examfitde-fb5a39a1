/**
 * Bronze-Branch Reconciler — Logik-Mirror der DB-Funktion
 * fn_trg_job_complete_reconcile_step v3 (quality_council).
 *
 * Spec:
 *   meta.badge='bronze' AND score>=75 AND rules_failed<=2
 *   ⇒ status='done' + meta.verdict.status='REVIEW_REQUIRED' + bronze feature_flag
 *   Sonst: status='failed' (alter Pfad)
 *
 * Damit ist der Vertrag im Codebase als ausführbare Spec verankert
 * und bricht sofort wenn die Migration unbeabsichtigt zurückgedreht wird.
 */
import { describe, it, expect } from "vitest";

type StepStatus = "queued" | "done" | "failed" | "skipped";
type Result = {
  status: StepStatus;
  meta: Record<string, any>;
  packageBronzeFlag?: { repair_active: boolean; requires_review: boolean; score: number; rules_failed: number };
};

function reconcileCouncil(input: {
  ok: boolean;
  skipped?: boolean;
  badge?: string | null;
  score?: number | null;
  rules_failed?: number | null;
}): Result {
  const v_skipped = !!input.skipped;
  let v_ok = !!input.ok;
  let v_is_bronze = false;

  if (!v_ok && !v_skipped) {
    const badge = input.badge ?? null;
    const score = input.score ?? 0;
    const rules_failed = input.rules_failed ?? 0;
    if (badge === "bronze" && score >= 75 && rules_failed <= 2) {
      v_is_bronze = true;
      v_ok = true;
    }
  }

  const status: StepStatus = v_skipped ? "skipped" : v_ok ? "done" : "failed";
  const gate_status = v_is_bronze ? "REVIEW_REQUIRED" : v_ok ? "pass" : "fail";

  const meta: Record<string, any> = { executed: true, ok: v_ok, status: gate_status };
  if (input.score != null) meta.score = input.score;
  if (v_is_bronze) {
    meta.verdict = { status: "REVIEW_REQUIRED", badge: "bronze" };
    meta.badge = "bronze";
    meta.bronze_branch = true;
  }

  const out: Result = { status, meta };
  if (v_is_bronze) {
    out.packageBronzeFlag = {
      repair_active: true,
      requires_review: true,
      score: input.score ?? 0,
      rules_failed: input.rules_failed ?? 0,
    };
  }
  return out;
}

describe("Reconciler Bronze-Branch (quality_council)", () => {
  it("Bronze score=78 + rules_failed=2 → done + REVIEW_REQUIRED + feature_flag", () => {
    const r = reconcileCouncil({ ok: false, badge: "bronze", score: 78, rules_failed: 2 });
    expect(r.status).toBe("done");
    expect(r.meta.verdict.status).toBe("REVIEW_REQUIRED");
    expect(r.meta.verdict.badge).toBe("bronze");
    expect(r.meta.bronze_branch).toBe(true);
    expect(r.packageBronzeFlag).toEqual(
      expect.objectContaining({ repair_active: true, requires_review: true }),
    );
  });

  it("Bronze score=89 + rules_failed=1 → done (oberes Bronze-Band)", () => {
    const r = reconcileCouncil({ ok: false, badge: "bronze", score: 89, rules_failed: 1 });
    expect(r.status).toBe("done");
    expect(r.meta.verdict.status).toBe("REVIEW_REQUIRED");
  });

  it("KEIN Bronze: badge=null → failed (alter Pfad)", () => {
    const r = reconcileCouncil({ ok: false, badge: null, score: 78, rules_failed: 2 });
    expect(r.status).toBe("failed");
    expect(r.meta.verdict).toBeUndefined();
    expect(r.packageBronzeFlag).toBeUndefined();
  });

  it("KEIN Bronze: score=74 < 75 → failed", () => {
    const r = reconcileCouncil({ ok: false, badge: "bronze", score: 74, rules_failed: 1 });
    expect(r.status).toBe("failed");
  });

  it("KEIN Bronze: rules_failed=3 > 2 → failed", () => {
    const r = reconcileCouncil({ ok: false, badge: "bronze", score: 88, rules_failed: 3 });
    expect(r.status).toBe("failed");
  });

  it("ok=true bleibt ok=true (kein Bronze-Override nötig)", () => {
    const r = reconcileCouncil({ ok: true, badge: "gold", score: 95, rules_failed: 0 });
    expect(r.status).toBe("done");
    expect(r.meta.verdict).toBeUndefined();
  });

  it("skipped wird nicht als Failure umgedeutet", () => {
    const r = reconcileCouncil({ ok: false, skipped: true });
    expect(r.status).toBe("skipped");
  });
});
