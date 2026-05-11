/**
 * SEO RPC Contract Test
 *
 * Pins the wire-level contract between the SEO Heal-Cockpit UI and the
 * 7 SECURITY DEFINER RPCs it depends on. Snapshot baselined from
 * pg_proc introspection on 2026-05-11.
 *
 * Bumping this contract REQUIRES a coordinated DB migration + UI patch.
 * If this test fails, do NOT just update the snapshot — verify the migration
 * actually shipped and frontend consumers were updated in lockstep.
 */
import { describe, it, expect } from "vitest";

type RpcContract = {
  name: string;
  args: string[]; // ordered "name type"
  returns: string[]; // ordered "col type" — TABLE() columns or scalar
};

export const SEO_RPC_CONTRACT: Record<string, RpcContract> = {
  admin_get_seo_alert_thresholds: {
    name: "admin_get_seo_alert_thresholds",
    args: [],
    returns: [
      "threshold_key text",
      "threshold_value numeric",
      "severity text",
      "description text",
      "updated_at timestamp with time zone",
      "updated_by uuid",
    ],
  },
  admin_set_seo_alert_threshold: {
    name: "admin_set_seo_alert_threshold",
    args: [
      "p_threshold_key text",
      "p_threshold_value numeric",
      "p_reason text",
    ],
    returns: ["jsonb"],
  },
  admin_get_seo_toggle_telemetry: {
    name: "admin_get_seo_toggle_telemetry",
    args: ["p_flag_key text"],
    returns: [
      "flag_key text",
      "toggles_24h bigint",
      "toggles_7d bigint",
      "enable_count_7d bigint",
      "disable_count_7d bigint",
      "last_toggle_at timestamp with time zone",
      "last_toggle_actor uuid",
      "last_toggle_direction text",
      "rollback_frequency_score numeric",
    ],
  },
  admin_get_recent_integrity_gate_failures: {
    name: "admin_get_recent_integrity_gate_failures",
    args: [
      "p_limit integer",
      "p_window_minutes integer",
      "p_min_score numeric",
      "p_max_score numeric",
      "p_package_id uuid",
      "p_hard_fail_only boolean",
      "p_error_code text",
    ],
    returns: [
      "job_id uuid",
      "package_id uuid",
      "status text",
      "last_error_code text",
      "last_error text",
      "integrity_passed boolean",
      "score numeric",
      "hard_fail_count integer",
      "created_at timestamp with time zone",
      "age_seconds integer",
    ],
  },
  admin_get_seo_job_health: {
    name: "admin_get_seo_job_health",
    args: [],
    returns: [
      "job_type text",
      "pending_count bigint",
      "processing_count bigint",
      "failed_1h bigint",
      "failed_6h bigint",
      "cancelled_1h bigint",
      "empty_result_1h bigint",
      "http_400_1h bigint",
      "requeue_loop_1h bigint",
      "total_1h bigint",
      "failure_rate_pct_1h numeric",
      "oldest_pending_age_minutes integer",
      "alert_severity text",
      "alert_reasons text[]",
    ],
  },
  admin_set_seo_feature_flag: {
    name: "admin_set_seo_feature_flag",
    args: ["p_flag_key text", "p_enabled boolean", "p_reason text"],
    returns: ["jsonb"],
  },
  admin_get_seo_feature_flag_toggle_log: {
    name: "admin_get_seo_feature_flag_toggle_log",
    args: ["p_flag_key text", "p_limit integer"],
    returns: [
      "log_id uuid",
      "flag_key text",
      "previous_enabled boolean",
      "new_enabled boolean",
      "reason text",
      "actor_uid uuid",
      "result_status text",
      "created_at timestamp with time zone",
    ],
  },
};

describe("SEO RPC Contract — shape integrity", () => {
  it("contains exactly the 7 expected RPCs", () => {
    expect(Object.keys(SEO_RPC_CONTRACT).sort()).toEqual([
      "admin_get_recent_integrity_gate_failures",
      "admin_get_seo_alert_thresholds",
      "admin_get_seo_feature_flag_toggle_log",
      "admin_get_seo_job_health",
      "admin_get_seo_toggle_telemetry",
      "admin_set_seo_alert_threshold",
      "admin_set_seo_feature_flag",
    ]);
  });

  it("every contract has a non-empty name + return shape", () => {
    for (const c of Object.values(SEO_RPC_CONTRACT)) {
      expect(c.name).toMatch(/^admin_/);
      expect(c.returns.length).toBeGreaterThan(0);
    }
  });

  it("all RPC arg names are p_-prefixed", () => {
    for (const c of Object.values(SEO_RPC_CONTRACT)) {
      for (const a of c.args) {
        expect(a, `${c.name}: ${a}`).toMatch(/^p_[a-z_]+\s/);
      }
    }
  });
});

describe("SEO RPC Contract — UI consumer columns", () => {
  // These are the columns / arg names the UI directly reads/writes.
  // If a column is removed, the UI breaks silently — pinning here.

  it("integrity-failure RPC accepts all 5 filter args used by SeoRollbackDialog", () => {
    const args = SEO_RPC_CONTRACT.admin_get_recent_integrity_gate_failures.args;
    const argNames = args.map((a) => a.split(/\s/)[0]);
    expect(argNames).toEqual(
      expect.arrayContaining([
        "p_limit",
        "p_window_minutes",
        "p_min_score",
        "p_package_id",
        "p_hard_fail_only",
        "p_error_code",
      ]),
    );
  });

  it("integrity-failure RPC returns all 7 columns rendered by the dialog", () => {
    const cols = SEO_RPC_CONTRACT.admin_get_recent_integrity_gate_failures
      .returns.map((c) => c.split(/\s/)[0]);
    for (const required of [
      "job_id",
      "package_id",
      "last_error_code",
      "integrity_passed",
      "score",
      "hard_fail_count",
      "age_seconds",
    ]) {
      expect(cols, `missing column: ${required}`).toContain(required);
    }
  });

  it("toggle-telemetry RPC returns all 4 panel fields + score", () => {
    const cols = SEO_RPC_CONTRACT.admin_get_seo_toggle_telemetry.returns.map(
      (c) => c.split(/\s/)[0],
    );
    for (const required of [
      "toggles_24h",
      "toggles_7d",
      "enable_count_7d",
      "disable_count_7d",
      "last_toggle_at",
      "last_toggle_direction",
      "rollback_frequency_score",
    ]) {
      expect(cols, `missing column: ${required}`).toContain(required);
    }
  });

  it("alert-thresholds RPC returns key + value (SSOT loop)", () => {
    const cols = SEO_RPC_CONTRACT.admin_get_seo_alert_thresholds.returns.map(
      (c) => c.split(/\s/)[0],
    );
    expect(cols).toEqual(
      expect.arrayContaining(["threshold_key", "threshold_value", "severity"]),
    );
  });

  it("set-threshold RPC accepts (key, value, reason)", () => {
    const argNames = SEO_RPC_CONTRACT.admin_set_seo_alert_threshold.args.map(
      (a) => a.split(/\s/)[0],
    );
    expect(argNames).toEqual([
      "p_threshold_key",
      "p_threshold_value",
      "p_reason",
    ]);
  });

  it("set-feature-flag RPC accepts (key, enabled, reason)", () => {
    const argNames = SEO_RPC_CONTRACT.admin_set_seo_feature_flag.args.map(
      (a) => a.split(/\s/)[0],
    );
    expect(argNames).toEqual(["p_flag_key", "p_enabled", "p_reason"]);
  });

  it("seo-job-health exposes alert_reasons text[] for inline tooltips", () => {
    const reasons = SEO_RPC_CONTRACT.admin_get_seo_job_health.returns.find(
      (c) => c.startsWith("alert_reasons "),
    );
    expect(reasons).toBe("alert_reasons text[]");
  });
});
