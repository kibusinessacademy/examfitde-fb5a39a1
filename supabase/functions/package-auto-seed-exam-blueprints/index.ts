import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function assertUuid(name: string, v: unknown) {
  const re = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!v || typeof v !== "string" || !re.test(v))
    throw new Error(`INVALID_${name.toUpperCase()}`);
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const body = await req.json().catch(() => ({}));
  const p = body.payload || body;

  try {
    assertUuid("package_id", p?.package_id);
    assertUuid("curriculum_id", p?.curriculum_id);
  } catch (e: unknown) {
    return json({ error: (e as Error).message }, 400);
  }

  const packageId = p.package_id as string;
  const curriculumId = p.curriculum_id as string;

  // Check if approved blueprints already exist → skip
  const { count: existingCount } = await sb
    .from("question_blueprints")
    .select("id", { count: "exact", head: true })
    .eq("curriculum_id", curriculumId)
    .eq("status", "approved");

  if ((existingCount ?? 0) > 0) {
    console.log(
      `[AutoSeedBP] ${curriculumId.slice(0, 8)} already has ${existingCount} approved blueprints — skipping`,
    );
    return json({ ok: true, skipped: true, existing: existingCount });
  }

  // Load learning fields
  const { data: lfs, error: lfErr } = await sb
    .from("learning_fields")
    .select("id, code, title")
    .eq("curriculum_id", curriculumId);

  if (lfErr) throw new Error(`LF query: ${lfErr.message}`);
  if (!lfs?.length) {
    // Try curriculum_learning_fields as fallback
    const { data: clfs, error: clfErr } = await sb
      .from("curriculum_learning_fields")
      .select("id, code, title")
      .eq("curriculum_id", curriculumId);
    if (clfErr) throw new Error(`CLF query: ${clfErr.message}`);
    if (!clfs?.length) {
      return json({
        ok: false,
        retry: true,
        error: "NO_LEARNING_FIELDS",
        detail: `No learning_fields for curriculum ${curriculumId}`,
      }, 409);
    }
    // Use curriculum_learning_fields
    return await seedFromFields(sb, curriculumId, clfs, packageId);
  }

  return await seedFromFields(sb, curriculumId, lfs, packageId);
});

async function seedFromFields(
  sb: ReturnType<typeof createClient>,
  curriculumId: string,
  lfs: Array<{ id: string; code: string; title: string }>,
  packageId: string,
) {
  const lfIds = lfs.map((lf) => lf.id);

  const { data: comps, error: compErr } = await sb
    .from("competencies")
    .select(
      "id, learning_field_id, code, title, description, taxonomy_level",
    )
    .in("learning_field_id", lfIds)
    .order("created_at", { ascending: true });

  if (compErr) throw new Error(`Competencies query: ${compErr.message}`);

  if (!comps?.length) {
    // No competencies → create one blueprint per learning field
    console.log(
      `[AutoSeedBP] No competencies found — seeding from ${lfs.length} learning fields`,
    );
    const seedRows = lfs.map((lf) => ({
      curriculum_id: curriculumId,
      learning_field_id: lf.id,
      name: lf.title || lf.code || "Lernfeld",
      canonical_statement: lf.title || "",
      cognitive_level: "understand",
      question_template: "",
      status: "approved",
      version: 1,
    }));

    const { error: seedErr } = await sb
      .from("question_blueprints")
      .insert(seedRows);
    if (seedErr) throw new Error(`Blueprint seed failed: ${seedErr.message}`);

    console.log(`[AutoSeedBP] Seeded ${seedRows.length} blueprints from LFs`);
    return json({ ok: true, seeded: seedRows.length, source: "learning_fields" });
  }

  // Seed from competencies
  const seedRows = comps.map((c: any) => ({
    curriculum_id: curriculumId,
    learning_field_id: c.learning_field_id,
    competency_id: c.id,
    name: c.title || c.code || "Kompetenz",
    canonical_statement: c.description || c.title || "",
    cognitive_level: c.taxonomy_level || "understand",
    question_template: "",
    status: "approved",
    version: 1,
  }));

  const { error: seedErr } = await sb
    .from("question_blueprints")
    .insert(seedRows);
  if (seedErr) throw new Error(`Blueprint seed failed: ${seedErr.message}`);

  console.log(`[AutoSeedBP] Seeded ${seedRows.length} blueprints from competencies`);

  // Non-critical progress hint
  await sb
    .from("course_packages")
    .update({ build_progress: 20 })
    .eq("id", packageId)
    .catch(() => {});

  return json({ ok: true, seeded: seedRows.length, source: "competencies" });
}
