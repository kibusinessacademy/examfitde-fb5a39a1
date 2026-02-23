import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function assertUuid(name: string, v: unknown) {
  const re = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!v || typeof v !== "string" || !re.test(v))
    throw new Error(`INVALID_${name.toUpperCase()}`);
}

// ── Elite 2.0: Context-Type Assignment ──────────────────────────────
// Hard/analyze → complex types; easy/remember → simpler types
const CONTEXT_TYPE_BY_COGNITIVE: Record<string, string[]> = {
  remember: ["isolated_knowledge", "isolated_knowledge", "applied_case"],
  understand: ["applied_case", "applied_case", "error_detection", "isolated_knowledge"],
  apply: ["applied_case", "multi_step_case", "documentation_analysis", "prioritization"],
  analyze: ["multi_step_case", "error_detection", "legal_evaluation", "prioritization", "communication_scenario"],
};

function pickExamContext(cognitive: string, index: number): string {
  const pool = CONTEXT_TYPE_BY_COGNITIVE[cognitive] || CONTEXT_TYPE_BY_COGNITIVE["understand"];
  return pool[index % pool.length];
}

// ── Elite 2.0: Decision Structure Assignment ────────────────────────
const DECISION_BY_COGNITIVE: Record<string, string | null> = {
  remember: null,
  understand: null,
  apply: "single_best_answer",
  analyze: "risk_assessment",
};

function pickDecisionStructure(cognitive: string): string | null {
  return DECISION_BY_COGNITIVE[cognitive] ?? null;
}

// ── Elite 2.0: Exam Relevance Score ─────────────────────────────────
function calcRelevanceScore(cognitive: string): number {
  switch (cognitive) {
    case "analyze": return 5;
    case "apply": return 4;
    case "understand": return 3;
    case "remember": return 2;
    default: return 3;
  }
}

// ── Elite 2.0: Estimated Time ───────────────────────────────────────
function calcEstimatedTime(cognitive: string): number {
  switch (cognitive) {
    case "analyze": return 180;
    case "apply": return 150;
    case "understand": return 90;
    case "remember": return 60;
    default: return 120;
  }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  let body: any = {};
  try { body = await req.json(); } catch (_) { /* empty */ }
  const p = body.payload || body;

  try {
    assertUuid("package_id", p?.package_id);
    assertUuid("curriculum_id", p?.curriculum_id);
  } catch (e: unknown) {
    return json({ error: (e as Error).message }, 400);
  }

  try {
    return await handleSeed(sb, p);
  } catch (e: unknown) {
    const msg = (e as Error)?.message || String(e);
    console.error(`[AutoSeedBP] Unhandled error: ${msg}`);
    return json({ ok: false, error: msg }, 500);
  }
});

const TAXONOMY_MAP: Record<string, string> = {
  "erinnern": "remember", "wissen": "remember", "kennen": "remember",
  "verstehen": "understand", "begreifen": "understand",
  "anwenden": "apply", "durchführen": "apply",
  "analysieren": "analyze", "bewerten": "analyze", "beurteilen": "analyze",
  "remember": "remember", "understand": "understand", "apply": "apply", "analyze": "analyze",
};

function normCognitive(raw: string | null | undefined): string {
  if (!raw) return "understand";
  const key = raw.trim().toLowerCase();
  return TAXONOMY_MAP[key] ?? "understand";
}

async function handleSeed(sb: ReturnType<typeof createClient>, p: any) {
  const packageId = p.package_id as string;
  const curriculumId = p.curriculum_id as string;

  const { data: lfs, error: lfErr } = await sb
    .from("learning_fields")
    .select("id, code, title")
    .eq("curriculum_id", curriculumId);

  if (lfErr) throw new Error(`LF query: ${lfErr.message}`);

  if (!lfs?.length) {
    const { data: clfs, error: clfErr } = await sb
      .from("learning_fields")
      .select("id, code, title")
      .eq("curriculum_id", curriculumId);
    if (clfErr) throw new Error(`CLF query: ${clfErr.message}`);
    if (!clfs?.length) {
      return json({
        ok: false, retry: true, error: "NO_LEARNING_FIELDS",
        detail: `No learning_fields for curriculum ${curriculumId}`,
      }, 409);
    }
    return await seedFromFields(sb, curriculumId, clfs, packageId);
  }

  return await seedFromFields(sb, curriculumId, lfs, packageId);
}

/**
 * Missing-only seed with Elite 2.0 fields.
 * Sets exam_context_type, decision_structure, exam_relevance_score,
 * estimated_time_seconds, and empty typical_errors based on cognitive level.
 */
async function seedFromFields(
  sb: ReturnType<typeof createClient>,
  curriculumId: string,
  lfs: Array<{ id: string; code: string; title: string }>,
  packageId: string,
) {
  const lfIds = lfs.map((lf) => lf.id);

  const { data: comps, error: compErr } = await sb
    .from("competencies")
    .select("id, learning_field_id, code, title, description, taxonomy_level")
    .in("learning_field_id", lfIds)
    .order("created_at", { ascending: true });

  if (compErr) throw new Error(`Competencies query: ${compErr.message}`);

  // ── Load ALL existing blueprints for diff ─────────────────────────
  const { data: existingBps } = await sb
    .from("question_blueprints")
    .select("competency_id, learning_field_id")
    .eq("curriculum_id", curriculumId);

  const existingCompIds = new Set((existingBps || []).filter((b: any) => b.competency_id).map((b: any) => b.competency_id));
  const existingLfIds = new Set((existingBps || []).filter((b: any) => !b.competency_id && b.learning_field_id).map((b: any) => b.learning_field_id));

  if (!comps?.length) {
    // No competencies → seed from learning fields (missing-only)
    console.log(`[AutoSeedBP] No competencies — seeding from ${lfs.length} LFs (missing-only)`);

    const seedRows = lfs
      .filter((lf) => !existingLfIds.has(lf.id))
      .map((lf, i) => {
        const cognitive = "understand";
        return {
          curriculum_id: curriculumId,
          learning_field_id: lf.id,
          name: lf.title || lf.code || "Lernfeld",
          canonical_statement: lf.title || "",
          cognitive_level: cognitive,
          question_template: "",
          status: "approved",
          version: 1,
          // ── Elite 2.0 fields ──
          exam_context_type: pickExamContext(cognitive, i),
          typical_errors: JSON.stringify([]),
          decision_structure: pickDecisionStructure(cognitive),
          exam_relevance_score: calcRelevanceScore(cognitive),
          estimated_time_seconds: calcEstimatedTime(cognitive),
        };
      });

    if (seedRows.length === 0) {
      console.log(`[AutoSeedBP] All ${lfs.length} LF blueprints exist — nothing to seed`);
      return json({ ok: true, skipped: true, existing: existingLfIds.size, source: "learning_fields" });
    }

    const { error: seedErr } = await sb.from("question_blueprints").insert(seedRows);
    if (seedErr && seedErr.code !== "23505") throw new Error(`Blueprint seed failed: ${seedErr.message}`);

    console.log(`[AutoSeedBP] Seeded ${seedRows.length} LF blueprints with Elite 2.0 fields (${existingLfIds.size} existed)`);
    return json({ ok: true, seeded: seedRows.length, existing: existingLfIds.size, source: "learning_fields" });
  }

  // ── Seed from competencies (missing-only) with Elite 2.0 ─────────
  const seedRows = comps
    .filter((c: any) => !existingCompIds.has(c.id))
    .map((c: any, i: number) => {
      const cognitive = normCognitive(c.taxonomy_level);
      return {
        curriculum_id: curriculumId,
        learning_field_id: c.learning_field_id,
        competency_id: c.id,
        name: c.title || c.code || "Kompetenz",
        canonical_statement: c.description || c.title || "",
        cognitive_level: cognitive,
        question_template: "",
        status: "approved",
        version: 1,
        // ── Elite 2.0 fields ──
        exam_context_type: pickExamContext(cognitive, i),
        typical_errors: JSON.stringify([]),
        decision_structure: pickDecisionStructure(cognitive),
        exam_relevance_score: calcRelevanceScore(cognitive),
        estimated_time_seconds: calcEstimatedTime(cognitive),
      };
    });

  if (seedRows.length === 0) {
    console.log(`[AutoSeedBP] All ${comps.length} competency blueprints exist — nothing to seed`);
    return json({ ok: true, skipped: true, existing: existingCompIds.size, source: "competencies" });
  }

  const { error: seedErr } = await sb.from("question_blueprints").insert(seedRows);
  if (seedErr) {
    if (seedErr.code === "23505") {
      console.log(`[AutoSeedBP] Concurrent insert detected — idempotent success`);
      return json({ ok: true, skipped: true, source: "competencies" });
    }
    throw new Error(`Blueprint seed failed: ${seedErr.message}`);
  }

  const eliteCount = seedRows.filter(r => r.exam_context_type !== "isolated_knowledge").length;
  console.log(`[AutoSeedBP] Seeded ${seedRows.length} blueprints (${eliteCount} non-isolated, ${existingCompIds.size} existed)`);

  try {
    await sb.from("course_packages").update({ build_progress: 20 }).eq("id", packageId);
  } catch (_) { /* ignore */ }

  return json({
    ok: true,
    seeded: seedRows.length,
    existing: existingCompIds.size,
    source: "competencies",
    elite_stats: {
      non_isolated: eliteCount,
      isolated: seedRows.length - eliteCount,
      avg_relevance: Math.round(seedRows.reduce((s, r) => s + r.exam_relevance_score, 0) / seedRows.length * 10) / 10,
    },
  });
}
