import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { callAIJSON } from "../_shared/ai-client.ts";
import { getModelChainAsync } from "../_shared/model-routing.ts";
import { resolveProfession } from "../_shared/profession-resolver.ts";
import { bootstrapLLMLogging } from "../_shared/llm-log-bootstrap.ts";
import { MAX_QUESTIONS_PER_PACKAGE } from "../_shared/exam-pool-limits.ts";
import { QC_COVERAGE_ELIGIBLE } from "../_shared/qc-status.ts";

/**
 * pool-fill-lf-gaps — Targeted LF gap-fill worker
 *
 * Called by pipeline-watchdog when quality_gate_failed due to LF_COVERAGE.
 * Generates exam questions specifically for learning fields that have 0 coverage.
 *
 * Key design decisions:
 * - Idempotent: skips LFs already covered (≥ MIN_PER_LF approved/tier1_passed)
 * - Elite-conformant: enforces bloom distribution (apply+analyze+evaluate ≥ 60%)
 * - Max 20% isolated_knowledge context type
 * - Budget-guarded: max GEN_PER_LF questions per LF, max MAX_LFS_PER_RUN LFs per invocation
 * - Post-fill: kicks validate_exam_pool step to continue pipeline
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}

// ── Config ──
const MIN_PER_LF = 6;      // LF is "covered" when it has ≥6 approved/tier1_passed
const GEN_PER_LF = 12;     // Generate 12 per LF (expect ~50-60% pass QC → ~6-7 usable)
const MAX_LFS_PER_RUN = 8;  // Budget guard per invocation

// ── Bloom Distribution for gap-fill (Elite-conformant) ──
type Cognitive = "remember" | "understand" | "apply" | "analyze" | "evaluate";
const BLOOM_DISTRIBUTION: [Cognitive, number][] = [
  ["remember", 1],   // ~8%
  ["understand", 2],  // ~17%
  ["apply", 4],       // ~33%
  ["analyze", 3],     // ~25%
  ["evaluate", 2],    // ~17%
];
// Total weight = 12, apply+analyze+evaluate = 9/12 = 75% > 60% ✓

function pickBlooms(count: number): Cognitive[] {
  const result: Cognitive[] = [];
  const totalWeight = BLOOM_DISTRIBUTION.reduce((s, [, w]) => s + w, 0);
  for (const [level, weight] of BLOOM_DISTRIBUTION) {
    const n = Math.round((weight / totalWeight) * count);
    for (let i = 0; i < n; i++) result.push(level);
  }
  // Fill/trim to exact count
  while (result.length < count) result.push("apply");
  return result.slice(0, count);
}

const CONTEXT_TYPES: Record<Cognitive, string[]> = {
  remember: ["applied_case", "isolated_knowledge"],
  understand: ["applied_case", "error_detection"],
  apply: ["applied_case", "multi_step_case", "documentation_analysis"],
  analyze: ["multi_step_case", "error_detection", "legal_evaluation", "prioritization"],
  evaluate: ["legal_evaluation", "prioritization", "multi_step_case"],
};

function pickContext(cognitive: Cognitive, index: number): string {
  const pool = CONTEXT_TYPES[cognitive];
  return pool[index % pool.length];
}

const DIFFICULTY_BY_COGNITIVE: Record<Cognitive, string> = {
  remember: "easy",
  understand: "medium",
  apply: "hard",
  analyze: "hard",
  evaluate: "very_hard",
};

// ── Idempotency check ──
async function countCoveredQuestions(
  sb: ReturnType<typeof createClient>,
  curriculumId: string,
  lfId: string,
): Promise<number> {
  const { count } = await sb
    .from("exam_questions")
    .select("id", { count: "exact", head: true })
    .eq("curriculum_id", curriculumId)
    .eq("learning_field_id", lfId)
    .in("qc_status", QC_COVERAGE_ELIGIBLE as unknown as string[]);
  return count ?? 0;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  bootstrapLLMLogging(sb, "pool_fill_lf_gaps");

  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const curriculumId: string = payload.curriculum_id;
  const missingLfIds: string[] = payload.missing_learning_field_ids || [];

  if (!curriculumId) return json({ error: "curriculum_id required" }, 400);

  const results: Array<{ lf_id: string; status: string; generated?: number; skipped_reason?: string }> = [];

  try {
    // ── SSOT Budget Guard: check pool size before generating ──
    const { count: currentPoolSize } = await sb
      .from("exam_questions")
      .select("id", { count: "exact", head: true })
      .eq("curriculum_id", curriculumId)
      .neq("status", "rejected");

    const currentCount = currentPoolSize ?? 0;
    const globalBudget = Math.max(0, MAX_QUESTIONS_PER_PACKAGE - currentCount);
    if (globalBudget <= 0) {
      console.log(`[lf-gap-fill] SSOT HARD CAP reached: ${currentCount} >= ${MAX_QUESTIONS_PER_PACKAGE} — skipping`);
      return json({ ok: true, message: "pool_cap_reached", pool_size: currentCount, cap: MAX_QUESTIONS_PER_PACKAGE });
    }

    // ── Resolve LFs if not provided ──
    let lfIds = missingLfIds;
    if (lfIds.length === 0) {
      // Compute missing LFs dynamically
      const { data: allLfs } = await sb
        .from("learning_fields")
        .select("id")
        .eq("curriculum_id", curriculumId);

      const allLfIds = (allLfs || []).map((x: { id: string }) => x.id);

      // FIX: Add .limit(5000) to avoid Supabase 1000-row default limit
      // Verkäufer has 1067 exam_questions — silently truncated without limit
      const { data: coveredRows } = await sb
        .from("exam_questions")
        .select("learning_field_id")
        .eq("curriculum_id", curriculumId)
        .in("qc_status", QC_COVERAGE_ELIGIBLE as unknown as string[])
        .limit(5000);

      const coveredSet = new Set((coveredRows || []).map((x: any) => x.learning_field_id));
      lfIds = allLfIds.filter((id: string) => !coveredSet.has(id));
    }

    // Budget guard
    const processLfs = lfIds.slice(0, MAX_LFS_PER_RUN);

    if (processLfs.length === 0) {
      return json({ ok: true, message: "No missing LFs found", results });
    }

    // ── Resolve profession for prompt context ──
    const { data: curriculum } = await sb
      .from("curricula")
      .select("title, beruf_id")
      .eq("id", curriculumId)
      .maybeSingle();

    let professionContext = curriculum?.title || "Ausbildungsberuf";
    if (curriculum?.beruf_id) {
      try {
        const prof = await resolveProfession(sb, { curriculumId });
        professionContext = prof.professionName;
      } catch { /* fallback to title */ }
    }

    // ── Get model chain ──
    const modelChain = await getModelChainAsync("exam_questions");

    // ── Process each missing LF ──
    for (const lfId of processLfs) {
      // Idempotency: skip if already covered
      const existingCount = await countCoveredQuestions(sb, curriculumId, lfId);
      if (existingCount >= MIN_PER_LF) {
        results.push({ lf_id: lfId, status: "skipped", skipped_reason: `already_covered(${existingCount})` });
        continue;
      }

      // Load LF details
      const { data: lf } = await sb
        .from("learning_fields")
        .select("id, code, title, description, exam_part")
        .eq("id", lfId)
        .maybeSingle();

      if (!lf) {
        results.push({ lf_id: lfId, status: "skipped", skipped_reason: "lf_not_found" });
        continue;
      }

      // Load blueprints for this LF
      const { data: blueprints } = await sb
        .from("question_blueprints")
        .select("id, cognitive_level, exam_context_type, decision_structure, exam_relevance_score, typical_errors, estimated_time_seconds")
        .eq("learning_field_id", lfId)
        .eq("curriculum_id", curriculumId)
        .limit(20);

      // Determine bloom targets
      const blooms = pickBlooms(GEN_PER_LF);

      // Build prompt
      const questionsSpec = blooms.map((cognitive, i) => {
        const contextType = pickContext(cognitive, i);
        const difficulty = DIFFICULTY_BY_COGNITIVE[cognitive];
        // Use blueprint info if available
        const bp = blueprints && blueprints.length > 0 ? blueprints[i % blueprints.length] : null;
        return {
          index: i + 1,
          cognitive_level: cognitive,
          difficulty,
          exam_context_type: contextType,
          blueprint_id: bp?.id || null,
          typical_errors: bp?.typical_errors || [],
        };
      });

      const systemPrompt = `Du bist ein IHK-Prüfungsexperte für den Beruf "${professionContext}".
Erstelle ${GEN_PER_LF} Multiple-Choice-Prüfungsfragen für das Lernfeld "${lf.title}" (${lf.code}).
${lf.description ? `Beschreibung: ${lf.description}` : ""}

REGELN:
- Jede Frage hat exakt 4 Antwortmöglichkeiten (A-D), genau 1 korrekt
- Praxisnah: Situationsaufgaben mit konkreten Szenarien, Namen, Zahlen
- KEINE "Was ist die Definition von..." Fragen bei apply/analyze/evaluate
- Erklärung MUSS enthalten: Warum richtig + warum jede falsche Antwort falsch ist
- Distraktoren müssen PLAUSIBEL sein (typische Fehler von Azubis)
- min. 2 typical_errors pro Frage (häufige Prüfungsfallen)

COGNITIVE LEVELS (Bloom):
- remember: Faktenwissen direkt abrufbar
- understand: Zusammenhänge erklären
- apply: Wissen auf neue Situation anwenden
- analyze: Fehler finden, Ursachen ermitteln
- evaluate: Bewerten, Priorisieren, Entscheiden

FRAGEN-SPEZIFIKATION:
${questionsSpec.map(s => `Frage ${s.index}: cognitive=${s.cognitive_level}, difficulty=${s.difficulty}, context=${s.exam_context_type}${s.typical_errors?.length ? `, typical_errors=${JSON.stringify(s.typical_errors)}` : ""}`).join("\n")}

Antworte NUR als JSON-Objekt:
{
  "questions": [
    {
      "question_text": "...",
      "options": ["A) ...", "B) ...", "C) ...", "D) ..."],
      "correct_answer": 0,
      "explanation": "Richtig ist A, weil... B ist falsch, weil... C ist falsch, weil... D ist falsch, weil...",
      "difficulty": "easy|medium|hard|very_hard",
      "cognitive_level": "remember|understand|apply|analyze|evaluate",
      "exam_context_type": "...",
      "typical_errors": ["Fehler 1", "Fehler 2"],
      "question_type": "concept|procedure|calculation|case_study|transfer"
    }
  ]
}`;

      let questions: any[] = [];
      let aiError: string | null = null;

      for (const model of modelChain) {
        try {
          const result = await callAIJSON({
            model: model.model,
            provider: model.provider as any,
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: `Generiere jetzt die ${GEN_PER_LF} Prüfungsfragen für Lernfeld "${lf.title}".` },
            ],
            temperature: 0.7,
            max_tokens: 8000,
          });

          // Robust JSON extraction: strip markdown fences, find JSON object
          let cleaned = result.content;
          // Remove markdown code fences
          cleaned = cleaned.replace(/^```(?:json)?\s*\n?/im, "").replace(/\n?```\s*$/im, "").trim();
          // If still not valid, try to extract JSON object
          if (!cleaned.startsWith("{") && !cleaned.startsWith("[")) {
            const match = cleaned.match(/(\[[\s\S]*\]|\{[\s\S]*\})/);
            if (match) cleaned = match[1];
          }
          // Handle truncated JSON: try to salvage partial array
          let parsed: any;
          try {
            parsed = JSON.parse(cleaned);
          } catch {
            // Try to close truncated JSON
            const lastComplete = cleaned.lastIndexOf("}");
            if (lastComplete > 0) {
              const truncated = cleaned.slice(0, lastComplete + 1) + "]}";
              parsed = JSON.parse(truncated);
            } else {
              throw new Error("Could not parse AI response as JSON");
            }
          }
          questions = Array.isArray(parsed) ? parsed : (parsed.questions || []);
          if (questions.length > 0) break;
        } catch (e) {
          aiError = (e as Error).message;
          console.error(`[gap-fill] AI error for LF ${lf.code} with ${model.model}: ${aiError}`);
        }
      }

      if (questions.length === 0) {
        results.push({ lf_id: lfId, status: "ai_failed", skipped_reason: aiError || "no_questions" });
        continue;
      }

      // ── Build inserts ──
      const inserts = questions.slice(0, GEN_PER_LF).map((q: any, i: number) => {
        const spec = questionsSpec[i] || questionsSpec[0];
        // Ensure typical_errors has min 2 entries
        let typicalErrors = Array.isArray(q.typical_errors) ? q.typical_errors.filter(Boolean).map(String) : [];
        if (typicalErrors.length < 2) {
          typicalErrors = ["Falsche Priorisierung", "Unvollständige Begründung"];
        }
        typicalErrors = typicalErrors.slice(0, 6);

        // Resolve blueprint for this specific question (bp was out of scope before)
        const matchedBlueprint = blueprints && blueprints.length > 0 
          ? blueprints[i % blueprints.length] 
          : null;

        return {
          curriculum_id: curriculumId,
          learning_field_id: lfId,
          blueprint_id: spec.blueprint_id || null,
          question_text: q.question_text || `Frage ${i + 1}`,
          options: Array.isArray(q.options) ? q.options : ["A)", "B)", "C)", "D)"],
          correct_answer: typeof q.correct_answer === "number" ? q.correct_answer : 0,
          explanation: q.explanation || "",
          difficulty: q.difficulty || spec.difficulty,
          cognitive_level: q.cognitive_level || spec.cognitive_level,
          question_type: ["concept","procedure","calculation","case_study","transfer"].includes(q.question_type) ? q.question_type : "concept",
          qc_status: "pending",
          ai_generated: true,
          trap_tags: typicalErrors,
          status: "draft",
          exam_part: lf.exam_part || null,
          scenario_type: spec.exam_context_type || null,
          time_estimate_seconds: matchedBlueprint?.estimated_time_seconds || null,
          typical_errors: typicalErrors.length > 0 ? typicalErrors : null,
        };
      });

      // ── Insert questions ──
      const { error: insErr } = await sb.from("exam_questions").insert(inserts);
      if (insErr) {
        console.error(`[gap-fill] DB insert error for LF ${lf.code}: ${insErr.message}`);
        results.push({ lf_id: lfId, status: "db_error", skipped_reason: insErr.message });
        continue;
      }

      results.push({ lf_id: lfId, status: "filled", generated: inserts.length });
      console.log(`[gap-fill] LF ${lf.code} "${lf.title}": inserted ${inserts.length} questions`);
    }

    // ── Post-fill: kick validate_exam_pool step ──
    // Find the package_id linked to this curriculum
    const { data: pkgs } = await sb
      .from("course_packages")
      .select("id")
      .eq("curriculum_id", curriculumId)
      .eq("status", "building")
      .limit(5);

    for (const pkg of (pkgs || [])) {
      await sb
        .from("package_steps")
        .update({
          status: "queued",
          attempts: 0,
          job_id: null,
          runner_id: null,
          started_at: null,
          last_error: `Gap-fill completed: ${results.filter(r => r.status === "filled").length} LFs filled`,
        })
        .eq("package_id", pkg.id)
        .eq("step_key", "validate_exam_pool");

      console.log(`[gap-fill] Kicked validate_exam_pool for package ${(pkg.id as string).slice(0, 8)}`);
    }

    const filledCount = results.filter(r => r.status === "filled").length;
    const skippedCount = results.filter(r => r.status === "skipped").length;

    console.log(`[gap-fill] Done: ${filledCount} filled, ${skippedCount} skipped, ${results.length} total`);

    return json({
      ok: true,
      filled: filledCount,
      skipped: skippedCount,
      total_lfs: results.length,
      results,
    });
  } catch (e: unknown) {
    const msg = (e as Error)?.message || String(e);
    console.error("[gap-fill] Fatal error:", msg);
    return json({ ok: false, error: msg }, 500);
  }
});
