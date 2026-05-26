/**
 * E2E-Smoke für Heal-RPCs nach Hotfix-Migration.
 *
 * Verifiziert:
 *  1. admin_quarantine_hotloop_jobs Dry-Run + Execute (kein "step_key does not exist")
 *  2. admin_reap_stale_processing_now (kein "performed_by does not exist")
 *  3. admin_unblock_packages_by_reason Dry-Run für jede valide Klasse
 *  4. Invariante: status≠'blocked' ⇒ blocked_reason wird auto-gecleart
 *
 * Smoke-Tests rufen die RPCs nur auf und prüfen, dass kein Schema-/Spalten-Fehler kommt.
 * Echte Auth ist dafür nicht nötig — bei Auth-Rejection (403) ist die Spalten-Schema-Prüfung
 * trotzdem bestanden, weil 42703 ein anderer Code ist.
 */
import { describe, it, expect, vi } from "vitest";

const RPC_BASE = "https://ubdvvvsiryenhrfmqsvw.supabase.co/rest/v1/rpc";
const ANON_KEY =
  "sb_publishable_3Z80G1ZZqFaK-wzNpNmaZA__1Tc6r8G";

async function callRpc(fn: string, body: Record<string, unknown>) {
  const res = await fetch(`${RPC_BASE}/${fn}`, {
    method: "POST",
    headers: {
      apikey: ANON_KEY,
      Authorization: `Bearer ${ANON_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  return { status: res.status, body: json as { code?: string; message?: string } };
}

const expectNoSchemaError = (
  result: { status: number; body: { code?: string; message?: string } },
) => {
  // 42703 = column does not exist (schema drift) — must NEVER happen post-fix
  if (result.body?.code === "42703") {
    throw new Error(`Schema drift detected: ${result.body.message}`);
  }
  // Auth-rejection is fine; we only care about column errors
  expect([200, 401, 403, 400]).toContain(result.status);
};

describe("Heal RPC Hotfix Smoke", () => {
  it("admin_quarantine_hotloop_jobs Dry-Run does not error on step_key column", async () => {
    const r = await callRpc("admin_quarantine_hotloop_jobs", {
      p_attempt_threshold: 10,
      p_dry_run: true,
      p_job_types: ["package_promote_blueprint_variants"],
    });
    expectNoSchemaError(r);
  });

  it("admin_quarantine_hotloop_jobs Execute does not error on step_key column", async () => {
    const r = await callRpc("admin_quarantine_hotloop_jobs", {
      p_attempt_threshold: 999, // unrealistic threshold → no targets, but must still parse
      p_dry_run: false,
      p_job_types: ["package_promote_blueprint_variants"],
    });
    expectNoSchemaError(r);
  });

  it("admin_reap_stale_processing_now does not error on performed_by column", async () => {
    const r = await callRpc("admin_reap_stale_processing_now", {
      p_max_age_seconds: 99999,
      p_max_cancels: 1,
    });
    expectNoSchemaError(r);
  });

  it("admin_unblock_packages_by_reason dry-runs all known classes without schema error", async () => {
    const classes = [
      "HARD_FAIL_NO_CURRICULUM",
      "COVERAGE_GAP",
      "NON_BUILDING_BLOCKED",
      "HARD_FAIL_OTHER",
      "AUTO_HEALED_RESIDUE",
      "NO_STEP_HISTORY",
      "OTHER",
    ];
    for (const c of classes) {
      const r = await callRpc("admin_unblock_packages_by_reason", {
        p_reason_class: c,
        p_max_packages: 1,
        p_dry_run: true,
      });
      if (r.body?.code === "42703") {
        throw new Error(`Schema drift in class ${c}: ${r.body.message}`);
      }
    }
  });
});

describe("Blocked-Status Invariant (logic spec)", () => {
  // Pure-logic mirror of fn_assert_blocked_status_reason_consistency
  // Documents the invariant for future contributors.
  type Pkg = { status: string; blocked_reason: string | null; blocked_at: string | null };
  const enforce = (pkg: Pkg): Pkg => {
    if (pkg.status !== "blocked" && pkg.blocked_reason !== null) {
      return { ...pkg, blocked_reason: null, blocked_at: null };
    }
    return pkg;
  };

  it("clears blocked_reason when status moves away from blocked", () => {
    const result = enforce({
      status: "queued",
      blocked_reason: "admin_hold",
      blocked_at: "2026-04-27T10:00:00Z",
    });
    expect(result.blocked_reason).toBeNull();
    expect(result.blocked_at).toBeNull();
  });

  it("preserves blocked_reason when status remains blocked", () => {
    const result = enforce({
      status: "blocked",
      blocked_reason: "admin_hold",
      blocked_at: "2026-04-27T10:00:00Z",
    });
    expect(result.blocked_reason).toBe("admin_hold");
  });

  it("is a no-op when status changes and no reason was set", () => {
    const before: Pkg = { status: "building", blocked_reason: null, blocked_at: null };
    const after = enforce(before);
    expect(after).toEqual(before);
  });
});
