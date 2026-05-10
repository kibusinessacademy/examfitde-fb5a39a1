/**
 * Regression: parity-cron-guard-daily classification + outbox effect.
 * fn_simulate_parity_cron_guard derives status (ok/warn/critical) against
 * the configured parity_cron_stale_hours threshold.
 * fn_simulate_parity_cron_guard_outbox layers expected notification behavior
 * on top (would_enqueue + severity + expected_status) so we assert the full
 * detect→outbox contract without polluting the live audit trail.
 */
import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";

const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

const maybe = url && key ? describe : describe.skip;

maybe("parity-cron-guard regression", () => {
  const supabase = createClient(url!, key!);

  describe("classification (fn_simulate_parity_cron_guard)", () => {
    it("fresh → ok", async () => {
      const { data, error } = await supabase.rpc("fn_simulate_parity_cron_guard", { p_scenario: "fresh" });
      expect(error).toBeNull();
      expect((data as any).status).toBe("ok");
      expect((data as any).reason).toBe("fresh");
    });
    it("late → warn (stale_run)", async () => {
      const { data, error } = await supabase.rpc("fn_simulate_parity_cron_guard", { p_scenario: "late" });
      expect(error).toBeNull();
      expect((data as any).status).toBe("warn");
      expect((data as any).reason).toBe("stale_run");
    });
    it("missing → critical (no_recent_run)", async () => {
      const { data, error } = await supabase.rpc("fn_simulate_parity_cron_guard", { p_scenario: "missing" });
      expect(error).toBeNull();
      expect((data as any).status).toBe("critical");
      expect((data as any).reason).toBe("no_recent_run");
    });
  });

  describe("outbox effect (fn_simulate_parity_cron_guard_outbox)", () => {
    it("fresh → no notification enqueued", async () => {
      const { data, error } = await supabase.rpc("fn_simulate_parity_cron_guard_outbox", { p_scenario: "fresh" });
      expect(error).toBeNull();
      const r = data as any;
      expect(r.would_enqueue_notification).toBe(false);
      expect(r.expected_severity).toBe("info");
      expect(r.expected_status).toBeNull();
    });
    it("late → enqueue medium-severity pending notification", async () => {
      const { data, error } = await supabase.rpc("fn_simulate_parity_cron_guard_outbox", { p_scenario: "late" });
      expect(error).toBeNull();
      const r = data as any;
      expect(r.would_enqueue_notification).toBe(true);
      expect(r.expected_severity).toBe("medium");
      expect(r.expected_status).toBe("pending");
      expect(r.expected_alert_key).toBe("parity_cron_health");
    });
    it("missing → enqueue high-severity pending notification", async () => {
      const { data, error } = await supabase.rpc("fn_simulate_parity_cron_guard_outbox", { p_scenario: "missing" });
      expect(error).toBeNull();
      const r = data as any;
      expect(r.would_enqueue_notification).toBe(true);
      expect(r.expected_severity).toBe("high");
      expect(r.expected_status).toBe("pending");
    });
  });
});
