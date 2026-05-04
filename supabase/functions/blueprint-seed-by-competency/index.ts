import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { callAIJSON } from "../_shared/ai-client.ts";
import { getModelChainAsync } from "../_shared/model-routing.ts";
import { resolveAvailableRoute } from "../_shared/llm/provider-load-balancer.ts";

/**
 * blueprint-seed-by-competency
 *
 * Accepts payload from blueprint_generate_variants jobs:
 *   { curriculum_id, competency_id, targets: { recall, application, scenario, transfer, error_patterns }, gap_total, reason }
 *
 * Seeds missing blueprint facets for ONE competency. Lightweight alternative to
 * package-auto-seed-exam-blueprints which operates on entire packages.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}

// ── Types ───────────────────────────────────────────────────────────
type Cognitive = "remember" | "understand" | "apply" | "analyze" | "evaluate";
type KnowledgeType = "concept" | "procedure" | "calculation" | "regulation";
type ExamContextType =
  | "isolated_knowledge"
  | "applied_case"
  | "multi_step_case"
  | "prioritization"
  | "error_detection";

interface BlueprintFacet {
  suffix: string;
  cognitive: Cognitive;
  knowledge_type: KnowledgeType;
  exam_context_type: ExamContextType;
  question_types: string[];
  decision_structure: string | null;
  didactic_intent: string;
  description: string;
}

const FACETS: BlueprintFacet[] = [
  {
    suffix: "Recall",
    cognitive: "remember",
    knowledge_type: "concept",
    exam_context_type: "isolated_knowledge",
    question_types: ["mc_single"],
    decision_structure: null,
    didactic_intent: "recognition",
    description: "Reine Faktenabfrage: Definitionen, Begriffe, Zuordnungen.",
  },
  {
    suffix: "Verständnis-Transfer",
    cognitive: "understand",
    knowledge_type: "concept",
    exam_context_type: "applied_case",
    question_types: ["mc_single", "mc_multi"],
    decision_structure: "single_best_answer",
    didactic_intent: "transfer",
    description: "Verständnisfrage mit Praxisbezug.",
  },
  {
    suffix: "Praxisfall",
    cognitive: "apply",
    knowledge_type: "procedure",
    exam_context_type: "multi_step_case",
    question_types: ["case_study", "mc_single", "calculation"],
    decision_structure: "multiple_valid_options",
    didactic_intent: "classification",
    description: "Reales Betriebsszenario mit konkretem Arbeitsschritt.",
  },
  {
    suffix: "Analyse",
    cognitive: "analyze",
    knowledge_type: "regulation",
    exam_context_type: "prioritization",
    question_types: ["mc_multi", "case_study"],
    decision_structure: "tradeoff_evaluation",
    didactic_intent: "comparison",
    description: "Analyse komplexer Zusammenhänge, Priorisierung.",
  },
  {
    suffix: "Fehlererkennung",
    cognitive: "evaluate",
    knowledge_type: "procedure",
    exam_context_type: "error_detection",
    question_types: ["mc_single", "mc_multi"],
    decision_structure: "single_best_answer",
    didactic_intent: "error_detection",
    description: "Fehler erkennen, bewerten, Korrekturmaßnahmen benennen.",
  },
];

const DIFFICULTY_BY_COGNITIVE: Record<Cognitive, string> = {
  remember: "easy",
  understand: "easy",
  apply: "medium",
  analyze: "hard",
  evaluate: "hard",
};

function calcRelevanceScore(c: Cognitive): number {
  return ({ evaluate: 5, analyze: 5, apply: 4, understand: 3, remember: 2 } as Record<Cognitive, number>)[c];
}

function calcEstimatedTime(c: Cognitive): number {
  return ({ evaluate: 200, analyze: 180, apply: 150, understand: 90, remember: 60 } as Record<Cognitive, number>)[c];
}

const TAXONOMY_MAP: Record<string, Cognitive> = {
  erinnern: "remember", wissen: "remember", kennen: "remember",
  verstehen: "understand", begreifen: "understand",
  anwenden: "apply", durchführen: "apply",
  analysieren: "analyze",
  bewerten: "evaluate", beurteilen: "evaluate", entscheiden: "evaluate",
  remember: "remember", understand: "understand", apply: "apply", analyze: "analyze", evaluate: "evaluate",
};

function normCognitive(raw: string | null | undefined): Cognitive {
  if (!raw) return "understand";
  return TAXONOMY_MAP[raw.trim().toLowerCase()] ?? "understand";
}

// ── AI Blueprint Generation ────────────────────────────────────────

async function generateTemplates(
  berufName: string,
  compTitle: string,
  compDescription: string | null,
  lfTitle: string,
  facets: BlueprintFacet[],
): Promise<Array<{ question_template: string; explanation_template: string; typical_errors: string[]; trap_spec: object; typical_exam_trap: string }>> {
  const facetDescriptions = facets
    .map((f, i) => `${i + 1}. "${f.suffix}" (${f.cognitive}/${f.exam_context_type}): ${f.description}`)
    .join("\n");

  const prompt = `Du bist ein IHK-Prüfungsexperte für den Beruf "${berufName}".

Kompetenz: "${compTitle}"${compDescription ? `\nBeschreibung: ${compDescription}` : ""}
Lernfeld: "${lfTitle}"

Erstelle für JEDE der folgenden ${facets.length} Blueprint-Facetten ein Template:
${facetDescriptions}

Antworte als JSON-Array mit ${facets.length} Objekten:
[{
  "question_template": "IHK-Prüfungsfrage mit {Variablen} in geschweiften Klammern",
  "explanation_template": "Fachliche Erklärung der korrekten Antwort",
  "typical_errors": ["Fehler 1", "Fehler 2", "Fehler 3"],
  "trap_spec": {"trap_type": "...", "misconception": "..."},
  "typical_exam_trap": "Beschreibung der typischen IHK-Falle"
}]

Regeln:
- Jede Frage MUSS mindestens eine Variable in {geschweiften Klammern} enthalten
- Mindestens 3 typical_errors pro Blueprint
- Realistischer IHK-Prüfungsbezug
- NUR das JSON-Array zurückgeben, KEIN Markdown`;

  let provider = "anthropic";
  let model = "claude-3-5-haiku-20241022";

  try {
    const policyRoute = await resolveAvailableRoute("exam_questions");
    if (policyRoute) {
      provider = policyRoute.provider;
      model = policyRoute.model;
    }
  } catch (_) { /* use defaults */ }

  try {
    const result = await callAIJSON({
      provider: provider as any,
      model,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.7,
      intent: "exam_questions",
    });

    if (Array.isArray(result) && result.length >= facets.length) {
      return result.slice(0, facets.length);
    }
  } catch (aiErr) {
    console.warn(`[BP-Seed] AI call failed (${provider}/${model}): ${aiErr}, using fallback`);
  }

  // Fallback: generate deterministic templates
  return facets.map((f) => ({
    question_template: `Frage zu ${compTitle} (${f.cognitive}): {Situation}`,
    explanation_template: `Erklärung zu ${compTitle}`,
    typical_errors: [`Verwechslung bei ${compTitle}`, `Fehlende Detailkenntnis`, `Falsche Zuordnung`],
    trap_spec: { trap_type: f.cognitive, misconception: `Häufiger Fehler bei ${compTitle}` },
    typical_exam_trap: `Typische IHK-Falle bei ${compTitle}`,
  }));
}

// ── Per-competency seed core (shared by single + targeted modes) ────

interface SeedOneResult {
  seeded: number;
  existing: number;
  facets_generated: string[];
  skipped: boolean;
  competency_code?: string;
  beruf?: string;
}

async function seedOneCompetency(
  sb: any,
  curriculumId: string,
  competencyId: string,
): Promise<SeedOneResult> {
  // 1) Load competency + learning field
  const { data: comp, error: compErr } = await sb
    .from("competencies")
    .select("id, learning_field_id, code, title, description, taxonomy_level, bloom_level")
    .eq("id", competencyId)
    .single();

  if (compErr || !comp) {
    throw new Error(`Competency not found: ${compErr?.message ?? competencyId}`);
  }

  const { data: lf } = await sb
    .from("learning_fields")
    .select("id, code, title, exam_part")
    .eq("id", comp.learning_field_id)
    .single();

  // 2) Load curriculum + beruf name
  const { data: curriculum } = await sb
    .from("curricula")
    .select("id, title, beruf_id")
    .eq("id", curriculumId)
    .single();

  let berufName = "Fachkraft";
  if (curriculum?.beruf_id) {
    const { data: beruf } = await sb
      .from("berufe")
      .select("bezeichnung_kurz")
      .eq("id", curriculum.beruf_id)
      .single();
    if (beruf?.bezeichnung_kurz) berufName = beruf.bezeichnung_kurz;
  }

  // 3) Load existing blueprints (live only)
  const { data: existingBps } = await sb
    .from("question_blueprints")
    .select("id, cognitive_level, status")
    .eq("curriculum_id", curriculumId)
    .eq("competency_id", competencyId)
    .in("status", ["approved", "review"]);

  const existingCogLevels = new Set((existingBps || []).map((b: any) => b.cognitive_level));

  // 4) Determine missing facets
  const baseCognitive = normCognitive(comp.bloom_level || comp.taxonomy_level);
  const cogOrder: Cognitive[] = ["remember", "understand", "apply", "analyze", "evaluate"];
  const baseIdx = cogOrder.indexOf(baseCognitive);

  const targetLevels: Cognitive[] = [baseCognitive];
  if (baseIdx > 0) targetLevels.push(cogOrder[baseIdx - 1]);
  if (baseIdx < cogOrder.length - 1) targetLevels.push(cogOrder[baseIdx + 1]);

  const missingFacets = FACETS.filter(
    (f) => targetLevels.includes(f.cognitive) && !existingCogLevels.has(f.cognitive),
  );

  if (missingFacets.length === 0) {
    console.log(`[BP-Seed] No missing facets for competency ${comp.code} — already covered`);
    return {
      seeded: 0,
      existing: existingBps?.length || 0,
      facets_generated: [],
      skipped: true,
      competency_code: comp.code,
      beruf: berufName,
    };
  }

  // 5) Generate templates via AI
  const templates = await generateTemplates(
    berufName,
    comp.title,
    comp.description,
    lf?.title || "Lernfeld",
    missingFacets,
  );

  // 6) Build + insert rows
  const rows = missingFacets.map((facet, i) => ({
    curriculum_id: curriculumId,
    learning_field_id: comp.learning_field_id,
    competency_id: comp.id,
    name: `${comp.title} — ${facet.suffix}`,
    canonical_statement: comp.title,
    cognitive_level: facet.cognitive,
    knowledge_type: facet.knowledge_type,
    exam_context_type: facet.exam_context_type,
    didactic_intent: facet.didactic_intent,
    allowed_question_types: facet.question_types,
    decision_structure: facet.decision_structure,
    question_template: templates[i]?.question_template || `Frage zu ${comp.title} (${facet.cognitive})`,
    explanation_template: templates[i]?.explanation_template || `Erklärung zu ${comp.title}`,
    typical_errors: templates[i]?.typical_errors || [],
    trap_spec: {
      ...(templates[i]?.trap_spec || {}),
      difficulty_default: DIFFICULTY_BY_COGNITIVE[facet.cognitive],
    },
    typical_exam_trap: templates[i]?.typical_exam_trap || `Typische Falle bei ${comp.title}`,
    exam_relevance_score: calcRelevanceScore(facet.cognitive),
    estimated_time_seconds: calcEstimatedTime(facet.cognitive),
    real_world_context: facet.cognitive !== "remember",
    oral_extension: lf?.exam_part ? { exam_part: lf.exam_part } : null,
    status: "draft",
    version: "4.0.0",
  }));

  const { error: insErr } = await sb.from("question_blueprints").insert(rows);
  if (insErr && insErr.code !== "23505") {
    throw new Error(`Insert failed: ${insErr.message}`);
  }

  const seeded = insErr?.code === "23505" ? 0 : rows.length;
  console.log(`[BP-Seed] ✅ Seeded ${seeded} blueprints for ${comp.code} "${comp.title}" (${berufName})`);

  return {
    seeded,
    existing: existingBps?.length || 0,
    facets_generated: missingFacets.map((f) => f.suffix),
    skipped: false,
    competency_code: comp.code,
    beruf: berufName,
  };
}

// ── Main Handler ────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let body: any = {};
  try { body = await req.json(); } catch (_) { /* empty */ }
  const p = body.payload || body;

  const curriculumId = p?.curriculum_id;
  const packageId = p?.package_id ?? null;
  const mode = p?.mode ?? null;
  const targetCompetencyIds: string[] = Array.isArray(p?.target_competency_ids)
    ? p.target_competency_ids.filter((x: unknown) => typeof x === "string" && x.length > 0)
    : [];

  // ═══════════════════════════════════════════════════════════════════
  // MODE: targeted_blueprint_fill
  // Loop over target_competency_ids, call seedOne per id, aggregate.
  // No default fan-out, no step marking, no tail reset, no triggers.
  // ═══════════════════════════════════════════════════════════════════
  if (mode === "targeted_blueprint_fill") {
    if (!curriculumId) {
      return json({
        status: "blocked",
        reason: "MISSING_CURRICULUM_ID",
        mode,
        inserted_blueprints: 0,
      }, 400);
    }
    if (targetCompetencyIds.length === 0) {
      return json({
        status: "blocked",
        reason: "MISSING_TARGET_COMPETENCY_IDS",
        mode,
        inserted_blueprints: 0,
      }, 400);
    }

    console.log(`[BP-Seed] mode=targeted_blueprint_fill curriculum=${curriculumId} package=${packageId} targets=${targetCompetencyIds.length}`);

    let insertedBlueprints = 0;
    const perCompetency: Array<{
      competency_id: string;
      seeded: number;
      existing?: number;
      facets?: string[];
      skipped?: boolean;
      error?: string;
    }> = [];
    const skipped: string[] = [];

    for (const compId of targetCompetencyIds) {
      try {
        const r = await seedOneCompetency(sb, curriculumId, compId);
        insertedBlueprints += r.seeded;
        perCompetency.push({
          competency_id: compId,
          seeded: r.seeded,
          existing: r.existing,
          facets: r.facets_generated,
          skipped: r.skipped,
        });
        if (r.skipped || r.seeded === 0) skipped.push(compId);
      } catch (e: unknown) {
        const msg = (e as Error)?.message || String(e);
        console.error(`[BP-Seed] competency=${compId} error: ${msg}`);
        perCompetency.push({ competency_id: compId, seeded: 0, error: msg });
        skipped.push(compId);
      }
    }

    if (insertedBlueprints === 0) {
      return json({
        status: "blocked",
        reason: "NO_TARGETED_BLUEPRINTS_INSERTED",
        mode,
        package_id: packageId,
        curriculum_id: curriculumId,
        inserted_blueprints: 0,
        target_competencies: targetCompetencyIds,
        skipped,
        per_competency: perCompetency,
      }, 200);
    }

    return json({
      status: "completed",
      mode,
      package_id: packageId,
      curriculum_id: curriculumId,
      inserted_blueprints: insertedBlueprints,
      target_competencies: targetCompetencyIds,
      skipped,
      per_competency: perCompetency,
    }, 200);
  }

  // ═══════════════════════════════════════════════════════════════════
  // LEGACY MODE: single competency (unchanged)
  // ═══════════════════════════════════════════════════════════════════
  const competencyId = p?.competency_id;

  if (!curriculumId || !competencyId) {
    return json({ error: "curriculum_id and competency_id required" }, 400);
  }

  console.log(`[BP-Seed] curriculum=${curriculumId}, competency=${competencyId}, gap=${p?.gap_total}`);

  try {
    const r = await seedOneCompetency(sb, curriculumId, competencyId);
    return json({
      ok: true,
      seeded: r.seeded,
      existing: r.existing,
      competency: r.competency_code,
      beruf: r.beruf,
      facets_generated: r.facets_generated,
      skipped: r.skipped || undefined,
    });
  } catch (e: unknown) {
    const msg = (e as Error)?.message || String(e);
    console.error(`[BP-Seed] ❌ Error: ${msg}`);
    if (msg.startsWith("Competency not found")) {
      return json({ error: msg }, 404);
    }
    return json({ ok: false, error: msg }, 500);
  }
});
