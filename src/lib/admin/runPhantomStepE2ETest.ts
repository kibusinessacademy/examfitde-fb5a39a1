import { supabase } from "@/integrations/supabase/client";

type Verdict = "pass" | "fail" | "warn" | "skip";

export interface PhantomStepTestResult {
  ok: boolean;
  test_run_id: string;
  mode: "readonly" | "canary";
  overall_pass: boolean;
  verdict: string;
  summary: { total: number; passed: number; failed: number; warned: number; skipped: number };
  layer_summary: Record<string, { total: number; passed: number; failed: number; warned: number; skipped: number }>;
  results: Array<{
    test_id: string;
    layer: string;
    verdict: Verdict;
    detail: string;
    evidence?: unknown;
  }>;
  elapsed_ms: number;
  ssot_step_count: number;
  ssot_step_keys: string[];
}

/**
 * Runs the Phantom-Step E2E test pyramid against the live system.
 * 
 * Modes:
 * - Without canaryPackageId: readonly tests only (safe for production)
 * - With canaryPackageId: full mutative test suite against that package
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
      ...(canaryPackageId ? { canary_package_id: canaryPackageId } : {}),
    }),
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json?.error || `Phantom-Step E2E Test fehlgeschlagen (${res.status})`);
  }

  return json as PhantomStepTestResult;
}
