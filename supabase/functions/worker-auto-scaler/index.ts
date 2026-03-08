import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "POST only" });

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } }
  );

  try {
    const { data, error } = await sb.rpc("get_worker_scaling_recommendations");
    if (error) return json(500, { error: error.message });

    const recommendations = data || [];
    const applied: unknown[] = [];

    for (const rec of recommendations) {
      const recommended = Number(rec.recommended_workers);
      const current = Number(rec.current_workers);

      if (recommended !== current) {
        const { error: updateErr } = await sb
          .from("system_runner_registry")
          .update({
            meta: {
              current_workers: recommended,
              autoscaled_at: new Date().toISOString(),
              pending_jobs: rec.pending_jobs,
            },
            updated_at: new Date().toISOString(),
          })
          .eq("runner_key", rec.worker_key);

        if (!updateErr) {
          applied.push({
            worker_key: rec.worker_key,
            from: current,
            to: recommended,
            pending_jobs: rec.pending_jobs,
          });
        }
      }
    }

    return json(200, { ok: true, applied, recommendations });
  } catch (e) {
    console.error("[worker-auto-scaler] error:", e);
    return json(500, { error: (e as Error).message });
  }
});
