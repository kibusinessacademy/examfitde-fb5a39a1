import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleCorsPreflightRequest, json } from "../_shared/cors.ts";
import { generateBlueprintRows } from "../_shared/certifications/blueprint-fanout.ts";

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

  // Accept either certification_id or an array of slugs
  const certIds: string[] = body.certification_ids ?? [];
  const slugs: string[] = body.slugs ?? [];

  if (!certIds.length && !slugs.length) {
    return json(400, { error: "certification_ids or slugs required" }, origin);
  }

  // Resolve certifications
  let certQuery = sb
    .from("certifications")
    .select("id, title, slug, certification_type, validation_profile, calculation_heavy, framework_heavy");

  if (certIds.length) {
    certQuery = certQuery.in("id", certIds);
  } else {
    certQuery = certQuery.in("slug", slugs);
  }

  const { data: certs, error: certErr } = await certQuery;
  if (certErr) return json(500, { error: certErr.message }, origin);
  if (!certs?.length) return json(404, { error: "No certifications found" }, origin);

  const results: any[] = [];

  for (const cert of certs) {
    try {
      // Get curriculum
      const { data: curriculum, error: curErr } = await sb
        .from("curricula")
        .select("id")
        .eq("certification_id", cert.id)
        .limit(1)
        .single();

      if (curErr) throw new Error(`No curriculum for ${cert.slug}: ${curErr.message}`);

      // Get competencies with their learning_field_id
      const { data: comps, error: compErr } = await sb
        .from("competencies")
        .select("id, title, description, learning_field_id, bloom_level, code")
        .in(
          "learning_field_id",
          (
            await sb
              .from("learning_fields")
              .select("id")
              .eq("curriculum_id", curriculum.id)
          ).data?.map((lf: any) => lf.id) ?? []
        )
        .order("id", { ascending: true });

      if (compErr) throw new Error(`Competencies error: ${compErr.message}`);
      if (!comps?.length) throw new Error(`No competencies for ${cert.slug}`);

      // Validate: filter out competencies missing mandatory fields
      const validComps = comps.filter((c: any) => c.id && c.learning_field_id);
      if (validComps.length < comps.length) {
        console.warn(`[blueprint-fanout] ${cert.slug}: ${comps.length - validComps.length} competencies missing learning_field_id — skipped`);
      }

      // Check existing blueprints for this curriculum to avoid duplicates
      const { data: existing } = await sb
        .from("question_blueprints")
        .select("competency_id, knowledge_type, cognitive_level")
        .eq("curriculum_id", curriculum.id)
        .neq("status", "deprecated");

      const existingSet = new Set(
        (existing ?? []).map(
          (e: any) => `${e.competency_id}|${e.knowledge_type}|${e.cognitive_level}`
        )
      );

      // Generate blueprint rows
      const allRows = generateBlueprintRows({
        validationProfile: cert.validation_profile,
        curriculumId: curriculum.id,
        competencies: comps,
      });

      // Filter out already existing ones
      const newRows = allRows.filter(
        (r) => !existingSet.has(`${r.competency_id}|${r.knowledge_type}|${r.cognitive_level}`)
      );

      if (newRows.length === 0) {
        results.push({
          slug: cert.slug,
          ok: true,
          skipped: true,
          reason: "all_blueprints_exist",
          total_possible: allRows.length,
        });
        continue;
      }

      // Insert in batches of 50
      let inserted = 0;
      for (let i = 0; i < newRows.length; i += 50) {
        const batch = newRows.slice(i, i + 50);
        const { error: insErr } = await sb
          .from("question_blueprints")
          .insert(batch);

        if (insErr) throw new Error(`Insert batch ${i}: ${insErr.message}`);
        inserted += batch.length;
      }

      results.push({
        slug: cert.slug,
        ok: true,
        curriculum_id: curriculum.id,
        competencies: comps.length,
        blueprints_generated: inserted,
        blueprints_skipped: allRows.length - newRows.length,
        profile: cert.validation_profile,
      });
    } catch (e) {
      results.push({
        slug: cert.slug,
        ok: false,
        error: (e as Error).message,
      });
    }
  }

  return json(200, { ok: true, results }, origin);
});
