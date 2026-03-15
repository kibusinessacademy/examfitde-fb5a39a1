import { supabase } from "@/integrations/supabase/client";

export async function runV2LoopSmokeTest(
  curriculumId: string,
  userId?: string,
  dryRun: boolean = false,
) {
  const { data: sessionData, error: sessionErr } = await supabase.auth.getSession();
  if (sessionErr) throw sessionErr;

  const accessToken = sessionData.session?.access_token;
  if (!accessToken) throw new Error("Nicht eingeloggt");

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  if (!supabaseUrl) throw new Error("VITE_SUPABASE_URL fehlt");

  const res = await fetch(`${supabaseUrl}/functions/v1/ops-smoke-test-v2-loop`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      curriculum_id: curriculumId,
      ...(userId ? { user_id: userId } : {}),
      dry_run: dryRun,
    }),
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json?.error || `Smoke Test fehlgeschlagen (${res.status})`);
  }

  return json;
}
