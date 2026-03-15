/**
 * knowledge-graph-build-ssot — Builds SSOT-derived knowledge graph nodes and edges.
 *
 * POST { curriculum_id: string }
 *
 * Reads learning_fields, competencies, question_blueprints and creates
 * graph nodes/edges with provenance='ssot'.
 */
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { buildSSOTGraph } from "../_shared/knowledge-graph/ssot-builder.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  const startMs = Date.now();

  try {
    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const body = await req.json().catch(() => ({} as any));
    const curriculumId = body.curriculum_id;

    if (!curriculumId) {
      return json({ error: "Missing curriculum_id" }, 400);
    }

    console.log(`[kg-build-ssot] Starting for curriculum ${curriculumId}`);

    const result = await buildSSOTGraph(sb, curriculumId);

    const elapsed = Date.now() - startMs;
    console.log(
      `[kg-build-ssot] Done: ${result.nodesCreated} created, ${result.nodesUpdated} updated, ` +
      `${result.edgesCreated} edges, ${result.errors.length} errors in ${elapsed}ms`
    );

    return json({
      ok: true,
      ...result,
      elapsed_ms: elapsed,
    });
  } catch (err) {
    const msg = (err as Error).message || String(err);
    console.error(`[kg-build-ssot] ERROR: ${msg}`);
    return json({ ok: false, error: msg.slice(0, 300) }, 500);
  }
});
