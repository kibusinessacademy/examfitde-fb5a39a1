import { supabase } from "@/integrations/supabase/client";

export interface PhantomStepTestResult {
  ok: boolean;
  test_run_id: string;
  overall_pass: boolean;
  verdict: string;
  layer_summary: Record<string, { total: number; passed: number }>;
  results: Array<{
    test_id: string;
    layer: string;
    pass: boolean;
    detail: string;
    evidence?: unknown;
  }>;
  elapsed_ms: number;
  ssot_step_count: number;
  ssot_step_keys: string[];
}

/**
 * Runs the Phantom-Step E2E test pyramid against the live system.
 * Tests 6 layers: Schema/Guard, Seeder/Backbone, Runtime, Publish-Readiness, Regression, Canary.
 */
export async function runPhantomStepE2ETest(
  canaryPackageId?: string,
): Promise<PhantomStepTestResult> {
  const { data: sessionData, error: sessionErr } = await supabase.auth.getSession();
  if (sessionErr) throw sessionErr;

  const accessToken = sessionData.session?.access_token;
  if (!accessToken) throw new Error("Nicht eingeloggt");

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  if (!supabaseUrl) throw new Error("VITE_SUPABASE_URL fehlt");

  const res = await fetch(`${supabaseUrl}/functions/v1/ops-phantom-step-e2e-test`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      ...(canaryPackageId ? { canary_package_id: canaryPackageId, skip_canary: false } : {}),
    }),
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json?.error || `Phantom-Step E2E Test fehlgeschlagen (${res.status})`);
  }

  return json as PhantomStepTestResult;
}
