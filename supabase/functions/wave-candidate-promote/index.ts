import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { assertAdmin } from "../_shared/edgeAuthContract.ts";
import { getCorsHeaders } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  const corsHeaders = getCorsHeaders(origin);

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Auth gate — admin / service-role / internal-secret only
  const auth = await assertAdmin(req, "wave-candidate-promote");
  if (!auth.ok) {
    return new Response(JSON.stringify({ error: auth.reason }), {
      status: auth.status,
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const INTERNAL_SECRET = Deno.env.get("EDGE_INTERNAL_SHARED_SECRET") || "";
  const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  try {
    const body = await req.json().catch(() => ({}));
    const rawLimit = Number(body.limit ?? 2);
    // Bound 1..20 to prevent amplification
    const limit = Number.isFinite(rawLimit) ? Math.min(20, Math.max(1, Math.floor(rawLimit))) : 2;
    const run_factory = body.run_factory === true;

    const { data: promoted, error: promoteErr } = await sb.rpc("promote_wave_candidates_to_factory", {
      p_limit: limit,
    });
    if (promoteErr) throw promoteErr;

    const items = promoted?.items || [];
    const enrichResults: Record<string, unknown>[] = [];

    for (const item of items) {
      if (!item.curriculum_id) continue;

      console.log(`[wave-promote] Enriching curriculum ${item.curriculum_id} (${item.canonical_title})`);

      try {
        const res = await fetch(
          `${SUPABASE_URL}/functions/v1/generate-curriculum-content`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
              "x-internal-secret": INTERNAL_SECRET,
            },
            body: JSON.stringify({ curriculum_id: item.curriculum_id }),
          },
        );
        const enrichResult = await res.json().catch(() => ({ status: res.status }));
        enrichResults.push({ curriculum_id: item.curriculum_id, ...enrichResult });

        if (enrichResult.success || enrichResult.skipped) {
          console.log(`[wave-promote] ✅ Enriched: ${enrichResult.learningFields || 0} LFs`);
        } else {
          console.warn(`[wave-promote] ⚠️ Enrichment failed: ${enrichResult.error || 'unknown'}`);
        }
      } catch (e) {
        console.error(`[wave-promote] ❌ Enrichment error: ${e}`);
        enrichResults.push({ curriculum_id: item.curriculum_id, error: String(e) });
      }
    }

    const readyForFactory: string[] = [];
    for (const item of items) {
      if (!item.curriculum_id) continue;
      const { count } = await sb
        .from("learning_fields")
        .select("id", { count: "exact", head: true })
        .eq("curriculum_id", item.curriculum_id);

      if (count && count > 0) {
        readyForFactory.push(item.curriculum_id);
      } else {
        console.warn(`[wave-promote] ⚠️ ${item.canonical_title}: no learning fields after enrichment — NOT sending to factory`);
      }
    }

    const result: Record<string, unknown> = {
      promoted,
      enrichResults,
      readyForFactory: readyForFactory.length,
      totalPromoted: items.length,
    };

    if (run_factory && readyForFactory.length > 0) {
      try {
        const res = await fetch(
          `${SUPABASE_URL}/functions/v1/admin-run-autonomous-factory`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-internal-secret": INTERNAL_SECRET,
              "x-job-runner-key": INTERNAL_SECRET,
            },
            body: JSON.stringify({}),
          },
        );
        result.factory = await res.json().catch(() => ({ status: res.status }));
      } catch (e) {
        result.factory = { error: String(e) };
      }
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  } catch (e) {
    console.error("[wave-candidate-promote] error:", e);
    return new Response(JSON.stringify({ error: "internal_error" }), {
      status: 500,
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  }
});
