import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { ensureExamPartMappings, type EnsureResult } from "../_shared/exam-part-mappings.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Use POST" }), {
      status: 405,
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  }

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const body = await req.json().catch(() => ({}));
  const dryRun = body.dry_run === true;
  const limitN = typeof body.limit === "number" ? body.limit : 500;

  // Load all frozen curricula
  const { data: curricula, error: currErr } = await sb
    .from("curricula")
    .select("id, code, status")
    .eq("status", "frozen")
    .order("code")
    .limit(limitN);

  if (currErr) {
    return new Response(
      JSON.stringify({ error: `Failed to load curricula: ${currErr.message}` }),
      { status: 500, headers: { ...corsHeaders, "content-type": "application/json" } },
    );
  }

  const results: Array<{
    curriculum_id: string;
    code: string;
    result: EnsureResult | { status: "error"; message: string };
  }> = [];

  let created = 0;
  let alreadyPresent = 0;
  let driftDetected = 0;
  let blocked = 0;
  let errors = 0;

  for (const curr of curricula ?? []) {
    try {
      if (dryRun) {
        // Dry run: just check current state without inserting
        const { data: lfs } = await sb
          .from("learning_fields")
          .select("id, exam_part")
          .eq("curriculum_id", curr.id);
        const withPart = (lfs ?? []).filter((lf: any) => lf.exam_part).length;
        const { data: mappings } = await sb
          .from("exam_part_mappings")
          .select("id")
          .eq("curriculum_id", curr.id);
        results.push({
          curriculum_id: curr.id,
          code: curr.code,
          result: {
            status: (mappings?.length ?? 0) > 0 ? "already_present" : "blocked_missing_source_data",
            reason: `dry_run: ${lfs?.length ?? 0} LFs, ${withPart} with exam_part, ${mappings?.length ?? 0} existing mappings`,
            details: {},
          } as any,
        });
        continue;
      }

      const result = await ensureExamPartMappings(sb, curr.id);
      results.push({ curriculum_id: curr.id, code: curr.code, result });

      switch (result.status) {
        case "created": created++; break;
        case "already_present": alreadyPresent++; break;
        case "drift_detected": driftDetected++; break;
        default: blocked++; break;
      }
    } catch (err: any) {
      errors++;
      results.push({
        curriculum_id: curr.id,
        code: curr.code,
        result: { status: "error", message: err.message },
      });
    }
  }

  const summary = {
    total: curricula?.length ?? 0,
    created,
    already_present: alreadyPresent,
    drift_detected: driftDetected,
    blocked,
    errors,
    dry_run: dryRun,
  };

  console.log(`[backfill-exam-part-mappings] Summary:`, JSON.stringify(summary));

  return new Response(
    JSON.stringify({ ok: true, summary, results }),
    { status: 200, headers: { ...corsHeaders, "content-type": "application/json" } },
  );
});
