/**
 * knowledge-graph-canary-test — A/B Canary for KG-enriched exam generation.
 *
 * Runs a controlled comparison:
 *  - Picks N blueprints from a curriculum
 *  - For each: generates questions WITH graph context (variant A) and WITHOUT (variant B)
 *  - Stores results in `kg_canary_results` for dashboard comparison
 *
 * POST { curriculum_id, max_blueprints?: 10, questions_per_bp?: 3 }
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { callAIJSON } from "../_shared/ai-client.ts";
import { getGraphContextForBlueprint } from "../_shared/knowledge-graph/query.ts";
import type { GraphContext } from "../_shared/knowledge-graph/types.ts";
import type { GraphContext } from "../_shared/knowledge-graph/types.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}

interface CanaryResult {
  blueprint_id: string;
  blueprint_label: string;
  competency_title: string;
  variant: "A_with_kg" | "B_without_kg";
  kg_errors_count: number;
  questions_generated: number;
  avg_quality_score: number;
  distractor_quality: number;
  praxis_score: number;
  raw_output: unknown;
  model_used: string;
  latency_ms: number;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const body = await req.json().catch(() => ({}));
    const { curriculum_id, max_blueprints = 10, questions_per_bp = 3 } = body;
    if (!curriculum_id) return json({ error: "curriculum_id required" }, 400);

    // Load profession name
    const { data: curriculum } = await sb.from("curricula").select("title").eq("id", curriculum_id).maybeSingle();
    const professionName = curriculum?.title || "Kaufmann/-frau";

    // Pick random blueprints that have competency + learning field
    const { data: blueprints, error: bpErr } = await sb
      .from("question_blueprints")
      .select("id, canonical_statement, competency_id, learning_field_id, cognitive_level, allowed_question_types, typical_exam_trap")
      .eq("curriculum_id", curriculum_id)
      .not("competency_id", "is", null)
      .not("learning_field_id", "is", null)
      .limit(100);

    console.log(`[KG-Canary] Blueprint query: found=${blueprints?.length || 0}, error=${bpErr?.message || 'none'}`);
    if (bpErr) return json({ error: "Blueprint query failed: " + bpErr.message }, 500);
    if (!blueprints?.length) return json({ error: "No blueprints found for curriculum " + curriculum_id }, 404);

    // Shuffle and take N
    const shuffled = blueprints.sort(() => Math.random() - 0.5).slice(0, max_blueprints);
    console.log(`[KG-Canary] Testing ${shuffled.length} blueprints from curriculum ${curriculum_id}`);

    // Use openai/gpt-5-mini for canary (reliable, cost-efficient)
    const provider = "openai" as const;
    const model = "gpt-5-mini";

    const results: CanaryResult[] = [];
    const runId = crypto.randomUUID();

    for (const bp of shuffled) {
      // Load competency + LF titles
      const { data: comp } = await sb.from("competencies").select("title, description").eq("id", bp.competency_id).maybeSingle();
      const { data: lf } = await sb.from("learning_fields").select("title").eq("id", bp.learning_field_id).maybeSingle();
      const compTitle = comp?.title || "Kompetenz";
      const compDesc = comp?.description || "";
      const lfTitle = lf?.title || "Lernfeld";

      // Fetch KG context
      let graphCtx: GraphContext | null = null;
      try {
        graphCtx = await getGraphContextForBlueprint(sb, bp.id);
      } catch { /* optional */ }

      // Build base prompt (shared)
      const basePrompt = buildCanaryPrompt(bp, compTitle, compDesc, lfTitle, professionName, questions_per_bp);

      // ── Variant A: WITH KG context ──
      const promptA = graphCtx?.common_errors?.length
        ? basePrompt + buildKGBlock(graphCtx)
        : basePrompt + "\n\n[KG: keine Fehlermuster verfügbar]";

      const startA = Date.now();
      let resultA: unknown = null;
      try {
        const resp = await callAIJSON({
          provider,
          model,
          messages: [
            { role: "system", content: "Du bist ein IHK-Prüfungsexperte. Generiere realistische Multiple-Choice-Fragen im JSON-Array-Format." },
            { role: "user", content: promptA },
          ],
          max_tokens: 2200,
        });
        resultA = JSON.parse(resp.content);
      } catch (e) {
        resultA = { error: (e as Error)?.message };
      }
      const latencyA = Date.now() - startA;

      // ── Variant B: WITHOUT KG context ──
      const promptB = basePrompt;
      const startB = Date.now();
      let resultB: unknown = null;
      try {
        const resp = await callAIJSON({
          provider,
          model,
          messages: [
            { role: "system", content: "Du bist ein IHK-Prüfungsexperte. Generiere realistische Multiple-Choice-Fragen im JSON-Array-Format." },
            { role: "user", content: promptB },
          ],
          max_tokens: 2200,
        });
        resultB = JSON.parse(resp.content);
      } catch (e) {
        resultB = { error: (e as Error)?.message };
      }
      const latencyB = Date.now() - startB;

      // Score both variants
      const scoreA = scoreQuestions(resultA);
      const scoreB = scoreQuestions(resultB);

      results.push({
        blueprint_id: bp.id,
        blueprint_label: bp.canonical_statement?.slice(0, 80) || bp.id,
        competency_title: compTitle,
        variant: "A_with_kg",
        kg_errors_count: graphCtx?.common_errors?.length || 0,
        questions_generated: scoreA.count,
        avg_quality_score: scoreA.avgQuality,
        distractor_quality: scoreA.distractorScore,
        praxis_score: scoreA.praxisScore,
        raw_output: resultA,
        model_used: `${provider}/${model}`,
        latency_ms: latencyA,
      });

      results.push({
        blueprint_id: bp.id,
        blueprint_label: bp.canonical_statement?.slice(0, 80) || bp.id,
        competency_title: compTitle,
        variant: "B_without_kg",
        kg_errors_count: 0,
        questions_generated: scoreB.count,
        avg_quality_score: scoreB.avgQuality,
        distractor_quality: scoreB.distractorScore,
        praxis_score: scoreB.praxisScore,
        raw_output: resultB,
        model_used: `${provider}/${model}`,
        latency_ms: latencyB,
      });

      console.log(`[KG-Canary] ${bp.id.slice(0,8)}: A(kg=${graphCtx?.common_errors?.length || 0})=${scoreA.avgQuality.toFixed(1)} vs B=${scoreB.avgQuality.toFixed(1)}`);
    }

    // Persist to ai_generations for dashboard access
    const variantA = results.filter(r => r.variant === "A_with_kg");
    const variantB = results.filter(r => r.variant === "B_without_kg");
    const avgA = variantA.reduce((s, r) => s + r.avg_quality_score, 0) / (variantA.length || 1);
    const avgB = variantB.reduce((s, r) => s + r.avg_quality_score, 0) / (variantB.length || 1);
    const avgDistA = variantA.reduce((s, r) => s + r.distractor_quality, 0) / (variantA.length || 1);
    const avgDistB = variantB.reduce((s, r) => s + r.distractor_quality, 0) / (variantB.length || 1);

    await sb.from("ai_generations").insert({
      entity_type: "kg_canary_test",
      entity_id: curriculum_id,
      generator_model: `${provider}/${model}`,
      status: "accepted",
      output_content: { results, run_id: runId },
      validation_score: avgA,
      validation_decision: avgA > avgB ? "kg_wins" : avgA < avgB ? "baseline_wins" : "tie",
      metadata: {
        version: "kg-canary-v1",
        run_id: runId,
        blueprints_tested: shuffled.length,
        questions_per_bp: questions_per_bp,
        summary: {
          variant_a_with_kg: {
            avg_quality: Math.round(avgA * 100) / 100,
            avg_distractor: Math.round(avgDistA * 100) / 100,
            total_questions: variantA.reduce((s, r) => s + r.questions_generated, 0),
            avg_latency_ms: Math.round(variantA.reduce((s, r) => s + r.latency_ms, 0) / (variantA.length || 1)),
          },
          variant_b_baseline: {
            avg_quality: Math.round(avgB * 100) / 100,
            avg_distractor: Math.round(avgDistB * 100) / 100,
            total_questions: variantB.reduce((s, r) => s + r.questions_generated, 0),
            avg_latency_ms: Math.round(variantB.reduce((s, r) => s + r.latency_ms, 0) / (variantB.length || 1)),
          },
          delta_quality: Math.round((avgA - avgB) * 100) / 100,
          delta_distractor: Math.round((avgDistA - avgDistB) * 100) / 100,
          verdict: avgA > avgB ? "kg_wins" : avgA < avgB ? "baseline_wins" : "tie",
        },
      },
    });

    return json({
      ok: true,
      run_id: runId,
      blueprints_tested: shuffled.length,
      summary: {
        with_kg: { avg_quality: Math.round(avgA * 100) / 100, avg_distractor: Math.round(avgDistA * 100) / 100 },
        without_kg: { avg_quality: Math.round(avgB * 100) / 100, avg_distractor: Math.round(avgDistB * 100) / 100 },
        delta_quality: Math.round((avgA - avgB) * 100) / 100,
        verdict: avgA > avgB ? "kg_wins" : avgA < avgB ? "baseline_wins" : "tie",
      },
    });
  } catch (e: unknown) {
    console.error("[KG-Canary] error", e);
    return json({ error: (e as Error)?.message || String(e) }, 500);
  }
});

// ── Prompt builder (simplified for canary — not full v5 pipeline) ──

function buildCanaryPrompt(
  bp: { canonical_statement?: string; cognitive_level?: string; allowed_question_types?: string[]; typical_exam_trap?: string },
  compTitle: string, compDesc: string, lfTitle: string, professionName: string, count: number,
): string {
  return `${count} Multiple-Choice-Frage(n) für "${professionName}".
Lernfeld: ${lfTitle}
Kompetenz: ${compTitle} — ${compDesc}
Blueprint: ${bp.canonical_statement || ""}
Kognitive Stufe: ${bp.cognitive_level || "apply"}
Fragetyp: ${bp.allowed_question_types?.[0] || "best_option"}
${bp.typical_exam_trap ? `Typische Falle: ${bp.typical_exam_trap}` : ""}

Ausgabe als JSON-Array mit Objekten:
[{ "question_text": "...", "options": ["A","B","C","D"], "correct_answer": "A", "explanation": "...", "quality_score": 1-5, "praxis_score": 1-5, "distractor_reasoning": "..." }]`;
}

function buildKGBlock(ctx: GraphContext): string {
  const errors = ctx.common_errors.slice(0, 5).map(e => `- ${e}`).join("\n");
  return `\n\n═══ HÄUFIGE FEHLER (Knowledge Graph) ═══
Typische Fehler/Missverständnisse bei dieser Kompetenz:
${errors}
Nutze diese Fehlermuster gezielt für realistische Distraktoren!`;
}

// ── Lightweight scoring (heuristic, not full QC pipeline) ──

function scoreQuestions(raw: unknown): { count: number; avgQuality: number; distractorScore: number; praxisScore: number } {
  if (!Array.isArray(raw)) return { count: 0, avgQuality: 0, distractorScore: 0, praxisScore: 0 };
  const qs = raw.filter((q: any) => q?.question_text && q?.options?.length === 4);
  if (qs.length === 0) return { count: 0, avgQuality: 0, distractorScore: 0, praxisScore: 0 };

  let totalQ = 0, totalD = 0, totalP = 0;
  for (const q of qs) {
    totalQ += Number(q.quality_score) || 3;
    totalP += Number(q.praxis_score) || 3;
    // Distractor diversity: unique option lengths as proxy
    const opts = (q.options || []) as string[];
    const uniqueLengths = new Set(opts.map((o: string) => Math.floor((o?.length || 0) / 10)));
    const hasReasoning = !!q.distractor_reasoning;
    totalD += (uniqueLengths.size / 4) * 3 + (hasReasoning ? 1.5 : 0);
  }

  return {
    count: qs.length,
    avgQuality: totalQ / qs.length,
    distractorScore: Math.min(5, totalD / qs.length),
    praxisScore: totalP / qs.length,
  };
}
