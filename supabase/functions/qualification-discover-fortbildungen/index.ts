import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleCorsPreflightRequest, json } from "../_shared/cors.ts";

const FORTBILDUNG_FAMILIES = [
  { pattern: "geprüfter fachwirt", award_type: "fachwirt", source_keys: ["ihk", "bibb"] },
  { pattern: "geprüfter betriebswirt", award_type: "betriebswirt", source_keys: ["ihk", "bibb"] },
  { pattern: "geprüfter bilanzbuchhalter", award_type: "bilanzbuchhalter", source_keys: ["ihk", "bibb"] },
  { pattern: "geprüfter controller", award_type: "controller", source_keys: ["ihk", "bibb"] },
  { pattern: "geprüfter fachkaufmann", award_type: "fachkaufmann", source_keys: ["ihk"] },
  { pattern: "operative professional", award_type: "operative_professional", source_keys: ["ihk"] },
  { pattern: "meisterprüfung", award_type: "meister", source_keys: ["hwk", "ihk"] },
  { pattern: "fachmann kaufmännische betriebsführung", award_type: "fachkaufmann", source_keys: ["hwk"] },
  { pattern: "ausbildereignung", award_type: "ada", source_keys: ["ihk", "hwk"] },
  { pattern: "geprüfter wirtschaftsfachwirt", award_type: "fachwirt", source_keys: ["ihk", "bibb"] },
  { pattern: "geprüfter technischer fachwirt", award_type: "fachwirt", source_keys: ["ihk", "bibb"] },
  { pattern: "geprüfter industriemeister", award_type: "meister", source_keys: ["ihk"] },
  { pattern: "geprüfter handwerksmeister", award_type: "meister", source_keys: ["hwk"] },
];

function buildSyntheticUrl(sourceKey: string, pattern: string): string {
  const domain = sourceKey === "ihk" ? "ihk.de" : sourceKey === "hwk" ? "hwk.de" : "bibb.de";
  return `https://${domain}/fortbildung/${encodeURIComponent(pattern.replace(/\s+/g, "-"))}`;
}

Deno.serve(async (req) => {
  const cors = handleCorsPreflightRequest(req);
  if (cors) return cors;
  const origin = req.headers.get("origin");

  if (req.method !== "POST") return json(405, { error: "POST only" }, origin);

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const body = await req.json().catch(() => ({}));
  const limit = Math.min(Number(body.limit ?? 50), 200);
  let discovered = 0;

  for (const family of FORTBILDUNG_FAMILIES.slice(0, limit)) {
    for (const sourceKey of family.source_keys) {
      const url = buildSyntheticUrl(sourceKey, family.pattern);
      const category = sourceKey === "hwk" ? "fortbildung_hwk" : "fortbildung_ihk";

      const { error } = await sb.from("curriculum_intake_candidates").upsert({
        source_key: sourceKey,
        category,
        title_raw: family.pattern,
        canonical_title: family.pattern,
        provider_name: sourceKey.toUpperCase(),
        url,
        intake_status: "discovered",
        metadata: { award_type: family.award_type, synthetic: true },
        last_seen_at: new Date().toISOString(),
      }, { onConflict: "url" });

      if (!error) discovered++;

      // Enqueue download job
      const { data: row } = await sb
        .from("curriculum_intake_candidates")
        .select("id")
        .eq("url", url)
        .single();

      if (row?.id) {
        await sb.from("curriculum_intake_jobs").upsert({
          job_type: "download",
          candidate_id: row.id,
          payload: { url, source_key: sourceKey, award_type: family.award_type },
          idempotency_key: `download:${row.id}`,
        }, { onConflict: "idempotency_key" });
      }
    }
  }

  return json(200, { ok: true, discovered }, origin);
});
