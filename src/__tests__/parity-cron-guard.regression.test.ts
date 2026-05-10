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

// E2E dispatcher dry-run — exercises the actual outbox row lifecycle
// (pending → sent|skipped|failed|dlq) without invoking Slack/Resend.
const url2 = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const key2 = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const maybeE2E = url2 && key2 ? describe : describe.skip;

maybeE2E("parity-cron-guard outbox dispatcher (dry-run)", () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { createClient } = require("@supabase/supabase-js");
  const supabase = createClient(url2!, key2!);
  const call = async (scenario: string, outcome = "ok") => {
    const { data, error } = await supabase.rpc("fn_simulate_dispatch_parity_notification", {
      p_scenario: scenario, p_outcome: outcome, p_max_attempts: 5,
    });
    expect(error).toBeNull();
    return data as any;
  };

  it("fresh → no enqueue, no transitions", async () => {
    const r = await call("fresh", "ok");
    expect(r.enqueued).toBe(false);
    expect(r.reason).toBe("cron_guard_status_ok");
  });

  it("late + ok → 1 attempt, status sent", async () => {
    const r = await call("late", "ok");
    expect(r.enqueued).toBe(true);
    expect(r.final_status).toBe("sent");
    expect(r.final_attempts).toBe(1);
    expect(r.reached_dlq).toBe(false);
  });

  it("missing + missing_secret → status skipped (no retry)", async () => {
    const r = await call("missing", "missing_secret");
    expect(r.enqueued).toBe(true);
    expect(r.final_status).toBe("skipped");
    expect(r.final_attempts).toBe(1);
    expect(r.last_error).toMatch(/missing_secret/);
  });

  it("missing + webhook_500 → 5 retries then dlq", async () => {
    const r = await call("missing", "webhook_500");
    expect(r.enqueued).toBe(true);
    expect(r.final_status).toBe("dlq");
    expect(r.final_attempts).toBe(5);
    expect(r.reached_dlq).toBe(true);
    // Transitions: initial pending + 5 attempts
    expect(Array.isArray(r.transitions)).toBe(true);
    expect(r.transitions.length).toBe(6);
  });

  it("late + webhook_500 → retry path produces medium severity", async () => {
    const r = await call("late", "webhook_500");
    expect(r.enqueued).toBe(true);
    expect(r.final_status).toBe("dlq");
    expect(r.evaluation.expected_severity).toBe("medium");
  });
});
