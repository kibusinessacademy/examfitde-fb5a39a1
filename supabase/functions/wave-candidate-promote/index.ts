import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  try {
    const { limit = 2, run_factory = false } = await req.json().catch(() => ({}));

    // Step 1: Promote wave candidates → curricula + courses + intake
    const { data: promoted, error: promoteErr } = await sb.rpc("promote_wave_candidates_to_factory", {
      p_limit: limit,
    });
    if (promoteErr) throw promoteErr;

    const items = promoted?.items || [];
    const enrichResults: Record<string, unknown>[] = [];

    // Step 2: Enrich each new curriculum (generate learning fields via AI)
    for (const item of items) {
      if (!item.curriculum_id) continue;

      console.log(`[wave-promote] Enriching curriculum ${item.curriculum_id} (${item.canonical_title})`);

      try {
        const internalSecret = Deno.env.get("EDGE_INTERNAL_SHARED_SECRET") || SERVICE_ROLE_KEY;
        const res = await fetch(
          `${SUPABASE_URL}/functions/v1/generate-curriculum-content`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
              "x-internal-secret": internalSecret,
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

    // Step 3: Verify enrichment — only proceed to factory if learning fields exist
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

    // Step 4: Optionally trigger autonomous factory (only if we have enriched curricula)
    if (run_factory && readyForFactory.length > 0) {
      try {
        const internalSecret = Deno.env.get("EDGE_INTERNAL_SHARED_SECRET") || SERVICE_ROLE_KEY;
        const res = await fetch(
          `${SUPABASE_URL}/functions/v1/admin-run-autonomous-factory`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-internal-secret": internalSecret,
              "x-job-runner-key": internalSecret,
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
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  }
});
