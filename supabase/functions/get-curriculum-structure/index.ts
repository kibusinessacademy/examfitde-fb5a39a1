import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";

/**
 * get-curriculum-structure
 * Returns learning fields + competencies for a curriculum (server-side only).
 * Replaces client-side DB reads to enforce SSOT.
 */
serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req);
  if (corsResponse) return corsResponse;

  const origin = req.headers.get("origin");
  const headers = { ...getCorsHeaders(origin), "Content-Type": "application/json" };

  try {
    const { curriculumId } = await req.json();
    if (!curriculumId) {
      return new Response(JSON.stringify({ error: "curriculumId required" }), { status: 400, headers });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: lfs, error } = await supabase
      .from("learning_fields")
      .select("id, code, title, competencies(id, code, title)")
      .eq("curriculum_id", curriculumId)
      .order("sort_order");

    if (error) throw error;
    if (!lfs?.length) {
      return new Response(JSON.stringify({ error: "Keine Lernfelder gefunden" }), { status: 404, headers });
    }

    // Flatten to a simple structure the client can iterate over
    const competencies: {
      lfId: string;
      lfCode: string;
      compId: string;
      compCode: string;
    }[] = [];

    for (const lf of lfs) {
      const comps = (lf as any).competencies || [];
      for (const c of comps) {
        competencies.push({
          lfId: lf.id,
          lfCode: lf.code || "LF?",
          compId: c.id,
          compCode: c.code || "?",
        });
      }
    }

    return new Response(
      JSON.stringify({ success: true, competencies, totalLearningFields: lfs.length }),
      { headers }
    );
  } catch (e) {
    console.error("[get-curriculum-structure] error", e);
    return new Response(
      JSON.stringify({ error: String((e as Error)?.message || e) }),
      { status: 500, headers }
    );
  }
});
