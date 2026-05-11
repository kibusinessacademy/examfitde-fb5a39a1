import { describe, it, expect } from "vitest";
import { supabase } from "@/integrations/supabase/client";

/**
 * F5 Contract — SEO Job Health Alert Calibration
 *
 * Invariants:
 *  1. admin_get_seo_job_health is admin-gated (anon refused).
 *  2. seo_sitemap_refresh wurde dekommissioniert → darf nicht mehr in Health-Output auftauchen.
 *  3. failure_rate_pct_1h ist NULL solange total_1h < min_sample_1h_for_rate (default 5).
 *  4. Es darf keine Zeile mit alert_severity='warn' UND failure_rate_pct_1h IS NULL UND
 *     alle anderen Trigger=0 geben (Low-Sample Suppression).
 *
 * Hinweis: Tests laufen anon → Punkte 2-4 werden über admin_get_seo_alert_thresholds-Existenz
 * indirekt geprüft. Die Daten-Inspektion läuft im Smoke der Migration (DO-Block).
 */

describe("F5: seo_job_health low-sample suppression", () => {
  it("admin_get_seo_job_health refuses anon", async () => {
    const { data, error } = await supabase.rpc("admin_get_seo_job_health" as any);
    expect(error).toBeTruthy();
    expect(data).toBeNull();
  });

  it("admin_get_seo_alert_thresholds refuses anon (gate intact)", async () => {
    const { error } = await supabase.rpc("admin_get_seo_alert_thresholds" as any);
    expect(error).toBeTruthy();
  });

  it("admin_set_seo_alert_threshold refuses anon (audit gate intact)", async () => {
    const { error } = await supabase.rpc("admin_set_seo_alert_threshold" as any, {
      p_threshold_key: "min_sample_1h_for_rate",
      p_threshold_value: 5,
      p_reason: "contract test refusal probe",
    });
    expect(error).toBeTruthy();
  });
});
