/**
 * Regression: parity-cron-guard-daily must classify fresh / late / missing runs
 * deterministically. Uses fn_simulate_parity_cron_guard which derives synthetic
 * last_run_at against the configured parity_cron_stale_hours threshold.
 */
import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";

const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

const maybe = url && key ? describe : describe.skip;

maybe("parity-cron-guard regression", () => {
  const supabase = createClient(url!, key!);

  it("classifies a fresh run as ok", async () => {
    const { data, error } = await supabase.rpc("fn_simulate_parity_cron_guard", { p_scenario: "fresh" });
    expect(error).toBeNull();
    expect((data as any).status).toBe("ok");
    expect((data as any).reason).toBe("fresh");
  });

  it("classifies a late run (> threshold) as warn", async () => {
    const { data, error } = await supabase.rpc("fn_simulate_parity_cron_guard", { p_scenario: "late" });
    expect(error).toBeNull();
    expect((data as any).status).toBe("warn");
    expect((data as any).reason).toBe("stale_run");
  });

  it("classifies a missing run as critical", async () => {
    const { data, error } = await supabase.rpc("fn_simulate_parity_cron_guard", { p_scenario: "missing" });
    expect(error).toBeNull();
    expect((data as any).status).toBe("critical");
    expect((data as any).reason).toBe("no_recent_run");
  });
});
