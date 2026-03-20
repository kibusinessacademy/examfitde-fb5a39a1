import { supabase } from "@/integrations/supabase/client";

export interface RunnerIntegrationTestResult {
  ok: boolean;
  overall_pass: boolean;
  verdict: string;
  test_run_id: string;
  registered_verifier_types: string[];
  results: Record<string, any>;
  elapsed_ms: number;
}

/**
 * Runs the Phase 2 Runner Integration Test against the live job-runner.
 * Inserts synthetic jobs into job_queue, invokes the runner, validates final DB state.
 *
 * @param curriculumId - Optional real curriculum_id (for path A: artifact present)
 * @param packageId - Optional real package_id
 * @param skipCleanup - If true, leaves synthetic jobs in DB for forensic analysis
 */
export async function runRunnerIntegrationTest(
  curriculumId?: string,
  packageId?: string,
  skipCleanup = false,
): Promise<RunnerIntegrationTestResult> {
  const { data: sessionData, error: sessionErr } = await supabase.auth.getSession();
  if (sessionErr) throw sessionErr;

  const accessToken = sessionData.session?.access_token;
  if (!accessToken) throw new Error("Nicht eingeloggt");

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  if (!supabaseUrl) throw new Error("VITE_SUPABASE_URL fehlt");

  const res = await fetch(`${supabaseUrl}/functions/v1/ops-runner-integration-test`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      ...(curriculumId ? { curriculum_id: curriculumId } : {}),
      ...(packageId ? { package_id: packageId } : {}),
      skip_cleanup: skipCleanup,
    }),
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json?.error || `Runner Integration Test fehlgeschlagen (${res.status})`);
  }

  return json as RunnerIntegrationTestResult;
}
