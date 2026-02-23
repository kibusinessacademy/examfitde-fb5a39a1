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

// ── Elite 2.0: Typed Cognitive Levels ───────────────────────────────
type Cognitive = "remember" | "understand" | "apply" | "analyze" | "evaluate";

// ── Elite 2.0: Context-Type Assignment ──────────────────────────────
const CONTEXT_TYPE_BY_COGNITIVE: Record<Cognitive, string[]> = {
  remember: ["isolated_knowledge", "applied_case"],
  understand: ["applied_case", "error_detection", "isolated_knowledge"],
  apply: ["applied_case", "multi_step_case", "documentation_analysis", "prioritization"],
  analyze: ["multi_step_case", "error_detection", "legal_evaluation", "prioritization", "communication_scenario"],
  evaluate: ["legal_evaluation", "prioritization", "multi_step_case", "communication_scenario"],
};

function pickExamContext(cognitive: Cognitive, index: number): string {
  const pool = CONTEXT_TYPE_BY_COGNITIVE[cognitive] || CONTEXT_TYPE_BY_COGNITIVE["understand"];
  return pool[index % pool.length];
}

// ── Elite 2.0: Decision Structure Rotation ──────────────────────────
function pickDecisionStructure(cognitive: Cognitive, index: number): string | null {
  const map: Record<Cognitive, (string | null)[]> = {
    remember: [null],
    understand: [null],
    apply: ["single_best_answer", "multiple_valid_options"],
    analyze: ["error_detection", "documentation_duty", "risk_assessment"],
    evaluate: ["prioritization", "legal_evaluation", "tradeoff_evaluation"],
  };
  const pool = map[cognitive] || map.understand;
  return pool[index % pool.length];
}

// ── Elite 2.0: Exam Relevance Score ─────────────────────────────────
function calcRelevanceScore(cognitive: Cognitive): number {
  switch (cognitive) {
    case "evaluate": return 5;
    case "analyze": return 5;
    case "apply": return 4;
    case "understand": return 3;
    case "remember": return 2;
  }
}

// ── Elite 2.0: Estimated Time ───────────────────────────────────────
function calcEstimatedTime(cognitive: Cognitive): number {
  switch (cognitive) {
    case "evaluate": return 200;
    case "analyze": return 180;
    case "apply": return 150;
    case "understand": return 90;
    case "remember": return 60;
  }
}

// ── Elite 2.0: Generate placeholder typical errors based on cognitive level ──
function generateTypicalErrors(cognitive: Cognitive, topicHint: string): string[] {
  const base: Record<Cognitive, string[]> = {
    remember: [
      "Verwechslung ähnlicher Fachbegriffe",
      "Falsche Zuordnung von Definitionen",
    ],
    understand: [
      "Oberflächliches Verständnis ohne Zusammenhänge",
      "Verwechslung von Ursache und Wirkung",
      "Fehlinterpretation von Fachbegriffen im Kontext",
    ],
    apply: [
      "Falscher Rechenweg oder falsche Formel gewählt",
      "Verwechslung von Brutto und Netto / Prozentbasis",
      "Fehlende Berücksichtigung von Rahmenbedingungen",
    ],
    analyze: [
      "Unvollständige Analyse — relevante Faktoren übersehen",
      "Falsche Priorisierung der Handlungsschritte",
      "Verwechslung von Symptom und Ursache",
    ],
    evaluate: [
      "Einseitige Bewertung ohne Abwägung",
      "Fehlende Berücksichtigung rechtlicher Vorgaben",
      "Falsche Risikoeinschätzung",
    ],
  };
  return base[cognitive] || base.understand;
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

const TAXONOMY_MAP: Record<string, Cognitive> = {
  "erinnern": "remember", "wissen": "remember", "kennen": "remember",
  "verstehen": "understand", "begreifen": "understand",
  "anwenden": "apply", "durchführen": "apply",
  "analysieren": "analyze",
  "bewerten": "evaluate", "beurteilen": "evaluate", "entscheiden": "evaluate",
  "remember": "remember", "understand": "understand", "apply": "apply", "analyze": "analyze", "evaluate": "evaluate",
};

function normCognitive(raw: string | null | undefined): Cognitive {
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
        const cognitive: Cognitive = "understand";
        return {
          curriculum_id: curriculumId,
          learning_field_id: lf.id,
          name: lf.title || lf.code || "Lernfeld",
          canonical_statement: lf.title || "",
          cognitive_level: cognitive,
          question_template: "",
          status: "approved",
          version: 1,
        // ── Elite 2.0 fields (jsonb = raw array, not stringify) ──
        exam_context_type: pickExamContext(cognitive, i),
        typical_errors: generateTypicalErrors(cognitive, lf.title || ""),
        decision_structure: pickDecisionStructure(cognitive, i),
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
        // ── Elite 2.0 fields (jsonb = raw array, not stringify) ──
        exam_context_type: pickExamContext(cognitive, i),
        typical_errors: generateTypicalErrors(cognitive, c.title || c.code || ""),
        decision_structure: pickDecisionStructure(cognitive, i),
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
