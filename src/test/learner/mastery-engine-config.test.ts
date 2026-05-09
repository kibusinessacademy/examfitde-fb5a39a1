import { describe, it, expect } from "vitest";
import { supabase } from "@/integrations/supabase/client";

/**
 * S3 — Mastery Engine Config + Simulator + Bridge contract.
 * Anon callers must be refused. Public reads on the config table must return 0 rows (RLS).
 */
describe("S3 mastery engine config + simulator (anon contract)", () => {
  it("admin_get_mastery_engine_config refuses anon", async () => {
    const { error } = await supabase.rpc(
      "admin_get_mastery_engine_config" as any,
    );
    expect(error).toBeTruthy();
  });

  it("admin_update_mastery_engine_config refuses anon", async () => {
    const { error } = await supabase.rpc(
      "admin_update_mastery_engine_config" as any,
      { p_decay_tau_days: 9 },
    );
    expect(error).toBeTruthy();
  });

  it("admin_simulate_mastery_decay refuses anon", async () => {
    const { error } = await supabase.rpc(
      "admin_simulate_mastery_decay" as any,
      { p_initial_mastery: 100, p_days_array: [0, 7, 14] },
    );
    expect(error).toBeTruthy();
  });

  it("admin_simulate_mastery_path refuses anon", async () => {
    const { error } = await supabase.rpc(
      "admin_simulate_mastery_path" as any,
      { p_attempts: [{ correct: true, days_since_prev: 0 }] },
    );
    expect(error).toBeTruthy();
  });

  it("mastery_engine_config table read is RLS-locked for anon", async () => {
    const { data } = await supabase
      .from("mastery_engine_config" as any)
      .select("*")
      .limit(5);
    expect(Array.isArray(data) ? data.length : 0).toBe(0);
  });

  it("record_attempt_mastery_bulk refuses anon writing for someone else", async () => {
    const { error } = await supabase.rpc(
      "record_attempt_mastery_bulk" as any,
      {
        p_user_id: "00000000-0000-0000-0000-000000000001",
        p_course_id: "00000000-0000-0000-0000-000000000002",
        p_event_type: "quiz",
        p_attempts: [
          {
            question_id: "00000000-0000-0000-0000-000000000003",
            correct: true,
            response_ms: 1000,
          },
        ],
      },
    );
    expect(error).toBeTruthy();
  });

  it("admin_get_gate_decision_drift refuses anon", async () => {
    const { error } = await supabase.rpc(
      "admin_get_gate_decision_drift" as any,
      { p_window_days: 7 },
    );
    expect(error).toBeTruthy();
  });

  it("admin_get_gate_decision_lane_pivot refuses anon", async () => {
    const { error } = await supabase.rpc(
      "admin_get_gate_decision_lane_pivot" as any,
      { p_window_hours: 24 },
    );
    expect(error).toBeTruthy();
  });

  it("admin_get_auto_pulse_impact refuses anon", async () => {
    const { error } = await supabase.rpc(
      "admin_get_auto_pulse_impact" as any,
      { p_window_days: 7 },
    );
    expect(error).toBeTruthy();
  });
});
