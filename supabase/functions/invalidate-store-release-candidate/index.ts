// invalidate-store-release-candidate
// Admin-only. Marks an active candidate as invalidated with reason, appends timeline event.
import { createClient } from "npm:@supabase/supabase-js@2";
import { assertAdmin } from "../_shared/edgeAuthContract.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const auth = await assertAdmin(req, "invalidate-store-release-candidate");
  if (!auth.ok) {
    return new Response(JSON.stringify({ error: auth.reason }), {
      status: auth.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let body: { candidate_id?: string; reason?: string } = {};
  try { body = await req.json(); } catch { /* ignore */ }
  const candidate_id = typeof body.candidate_id === "string" ? body.candidate_id : null;
  const reason = typeof body.reason === "string" ? body.reason : "manual_invalidation";
  if (!candidate_id) {
    return new Response(JSON.stringify({ error: "candidate_id required" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const { data: cur } = await supabase.from("store_release_candidates")
      .select("manifest_id, status").eq("id", candidate_id).maybeSingle();
    if (!cur) {
      return new Response(JSON.stringify({ error: "candidate_not_found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if ((cur as { status?: string }).status !== "active") {
      return new Response(JSON.stringify({ error: "candidate_not_active" }), {
        status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    await supabase.from("store_release_candidates")
      .update({ status: "invalidated", invalidated_reason: reason, invalidated_at: new Date().toISOString() })
      .eq("id", candidate_id);

    const manifest_id = (cur as { manifest_id: string }).manifest_id;
    await supabase.from("store_release_timeline").insert({
      candidate_id, manifest_id, event: "candidate_invalidated",
      actor_id: auth.userId ?? null, note: reason, payload: { reason },
    });

    await supabase.from("security_events").insert({
      event_type: "candidate_invalidated", decision: "audit",
      reason: `candidate=${candidate_id} reason=${reason}`,
      meta: { function_name: "invalidate-store-release-candidate", candidate_id, manifest_id, reason },
    }).then(() => {}, () => {});

    return new Response(JSON.stringify({ ok: true }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
