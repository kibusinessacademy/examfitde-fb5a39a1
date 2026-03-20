import { supabase } from "@/integrations/supabase/client";

export interface GuardTestResult {
  ok: boolean;
  overall_pass: boolean;
  verdict: string;
  registered_job_types: string[];
  results: Record<string, any>;
  elapsed_ms: number;
}

/**
 * Runs the Materialization Guard verification test against the live system.
 * Tests all 4 mandatory paths: artifact present, missing, unregistered, verifier error.
 *
 * @param curriculumId - Optional real curriculum_id to test path 1 (artifact present)
 * @param packageId - Optional real package_id for package-level verifiers
 */
export async function runMaterializationGuardTest(
  curriculumId?: string,
  packageId?: string,
): Promise<GuardTestResult> {
  const { data: sessionData, error: sessionErr } = await supabase.auth.getSession();
  if (sessionErr) throw sessionErr;

  const accessToken = sessionData.session?.access_token;
  if (!accessToken) throw new Error("Nicht eingeloggt");

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  if (!supabaseUrl) throw new Error("VITE_SUPABASE_URL fehlt");

  const res = await fetch(`${supabaseUrl}/functions/v1/ops-materialization-guard-test`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      ...(curriculumId ? { curriculum_id: curriculumId } : {}),
      ...(packageId ? { package_id: packageId } : {}),
    }),
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json?.error || `Guard Test fehlgeschlagen (${res.status})`);
  }

  return json as GuardTestResult;
}
