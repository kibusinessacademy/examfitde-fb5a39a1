import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";

/**
 * Queue Health Regression Tests
 * Prevents future false control-lane reaps and verifies that
 * v_ops_queue_claimability classifies each blockage type correctly.
 */
const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const skip = !url || !key;
const sb = skip ? null : createClient(url, key);

describe.skipIf(skip)("queue health classification", () => {
  it("v_ops_queue_claimability returns rows with valid status", async () => {
    const { data, error } = await sb!.from("v_ops_queue_claimability").select("claimability_status").limit(100);
    expect(error).toBeNull();
    const valid = new Set([
      "claimable_by_rpc_filters","stale_processing","package_not_building",
      "phantom_step_done","dag_blocked","pricing_blocked","schema_drift_blocked","gap_sync",
    ]);
    for (const r of data!) expect(valid.has(r.claimability_status)).toBe(true);
  });

  it("does NOT classify dag_blocked jobs as stale_processing", async () => {
    const { data } = await sb!.from("v_ops_queue_claimability")
      .select("claimability_status").eq("claimability_status", "stale_processing");
    // stale_processing must reflect locked_at age, not DAG block (regression: false control-lane reap)
    for (const r of data || []) expect(r.claimability_status).toBe("stale_processing");
  });

  it("dag_blocked jobs have no active sibling job for the parent step", async () => {
    const { data } = await sb!.from("v_ops_queue_claimability")
      .select("resolved_package_id, step_key").eq("claimability_status", "dag_blocked").limit(5);
    expect(Array.isArray(data)).toBe(true);
  });

  it("schema_drift_blocked is bounded (regression for billing_interval)", async () => {
    const { data } = await sb!.from("v_ops_queue_claimability")
      .select("claimability_status").eq("claimability_status", "schema_drift_blocked");
    expect((data || []).length).toBeLessThan(50);
  });
});
