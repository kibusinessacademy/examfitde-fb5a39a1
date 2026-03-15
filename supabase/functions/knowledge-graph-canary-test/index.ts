/**
 * knowledge-graph-canary-test — Async A/B Canary for KG-enriched exam generation.
 *
 * Runs a controlled comparison (timeout-safe):
 *  1. Immediately persists a "processing" record in ai_generations
 *  2. For each blueprint: generates questions WITH (A) and WITHOUT (B) graph context
 *  3. Incrementally updates the record after each blueprint
 *  4. Finalizes with status "accepted" + summary — even if the client disconnects
 *
 * POST { curriculum_id, max_blueprints?: 8, questions_per_bp?: 2 }
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { callAIJSON } from "../_shared/ai-client.ts";
import { getGraphContextForBlueprint } from "../_shared/knowledge-graph/query.ts";
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
    const { curriculum_id, max_blueprints = 8, questions_per_bp = 2 } = body;
    if (!curriculum_id) return json({ error: "curriculum_id required" }, 400);

    const { data: curriculum } = await sb.from("curricula").select("title").eq("id", curriculum_id).maybeSingle();
    const professionName = curriculum?.title || "Kaufmann/-frau";

    const { data: blueprints, error: bpErr } = await sb
      .from("question_blueprints")
      .select("id, canonical_statement, competency_id, learning_field_id, cognitive_level, allowed_question_types, typical_exam_trap")
      .eq("curriculum_id", curriculum_id)
      .not("competency_id", "is", null)
      .not("learning_field_id", "is", null)
      .limit(100);

    if (bpErr) return json({ error: "Blueprint query failed: " + bpErr.message }, 500);
    if (!blueprints?.length) return json({ error: "No blueprints found" }, 404);

    const shuffled = blueprints.sort(() => Math.random() - 0.5).slice(0, max_blueprints);
    const provider = "openai" as const;
    const model = "gpt-5-mini";
    const runId = crypto.randomUUID();

    // ── Step 1: Persist "processing" record immediately ──
    const { data: genRecord, error: genErr } = await sb.from("ai_generations").insert({
      entity_type: "kg_canary_test",
      entity_id: curriculum_id,
      generator_model: `${provider}/${model}`,
      status: "processing",
      output_content: { results: [], run_id: runId },
      metadata: {
        version: "kg-canary-v2-async",
        run_id: runId,
        blueprints_tested: shuffled.length,
        questions_per_bp: questions_per_bp,
        started_at: new Date().toISOString(),
      },
    }).select("id").single();

    if (genErr) return json({ error: "Failed to create run record: " + genErr.message }, 500);
    const genId = genRecord.id;

    // ── Step 2: Return immediately — processing continues in background ──
    // Use waitUntil pattern: respond first, then continue
    const responsePromise = json({
      ok: true,
      async: true,
      run_id: runId,
      generation_id: genId,
      blueprints_queued: shuffled.length,
      message: "Canary test started. Results will be persisted to ai_generations.",
    });

    // Background processing (runs after response is sent)
    const backgroundWork = (async () => {
      const results: CanaryResult[] = [];

      for (const bp of shuffled) {
        try {
          const pair = await processOneBlueprint(sb, bp, professionName, questions_per_bp, provider, model);
          results.push(...pair);

          // ── Step 3: Incremental checkpoint after each blueprint ──
          await sb.from("ai_generations").update({
            output_content: { results, run_id: runId },
            metadata: {
              version: "kg-canary-v2-async",
              run_id: runId,
              blueprints_tested: shuffled.length,
              blueprints_completed: results.length / 2,
              questions_per_bp,
              last_checkpoint: new Date().toISOString(),
            },
          }).eq("id", genId);
        } catch (e) {
          console.error(`[KG-Canary] Blueprint ${bp.id.slice(0, 8)} failed:`, e);
        }
      }

      // ── Step 4: Finalize with summary ──
      const summary = computeSummary(results);
      await sb.from("ai_generations").update({
        status: "accepted",
        output_content: { results, run_id: runId },
        validation_score: summary.avgA,
        validation_decision: summary.verdict,
        metadata: {
          version: "kg-canary-v2-async",
          run_id: runId,
          blueprints_tested: shuffled.length,
          blueprints_completed: results.length / 2,
          questions_per_bp,
          completed_at: new Date().toISOString(),
          summary: summary.full,
        },
      }).eq("id", genId);

      console.log(`[KG-Canary] ✅ Run ${runId.slice(0, 8)} finalized: ${summary.verdict} (Δ=${summary.full.delta_quality})`);
    })();

    // Wait for background work but still return the response
    // EdgeRuntime keeps the function alive until all promises resolve
    await Promise.all([responsePromise, backgroundWork]);

    return responsePromise;
  } catch (e: unknown) {
    console.error("[KG-Canary] error", e);
    return json({ error: (e as Error)?.message || String(e) }, 500);
  }
});

// ── Process a single blueprint: A (with KG) vs B (without KG) ──

async function processOneBlueprint(
  sb: ReturnType<typeof createClient>,
  bp: any,
  professionName: string,
  count: number,
  provider: "openai",
  model: string,
): Promise<[CanaryResult, CanaryResult]> {
  const [{ data: comp }, { data: lf }] = await Promise.all([
    sb.from("competencies").select("title, description").eq("id", bp.competency_id).maybeSingle(),
    sb.from("learning_fields").select("title").eq("id", bp.learning_field_id).maybeSingle(),
  ]);
  const compTitle = comp?.title || "Kompetenz";
  const compDesc = comp?.description || "";
  const lfTitle = lf?.title || "Lernfeld";

  let graphCtx: GraphContext | null = null;
  try { graphCtx = await getGraphContextForBlueprint(sb, bp.id); } catch { /* optional */ }

  const basePrompt = buildCanaryPrompt(bp, compTitle, compDesc, lfTitle, professionName, count);
  const promptA = graphCtx?.common_errors?.length
    ? basePrompt + buildKGBlock(graphCtx)
    : basePrompt + "\n\n[KG: keine Fehlermuster verfügbar]";

  const sysMsg = { role: "system" as const, content: "Du bist ein IHK-Prüfungsexperte. Generiere realistische Multiple-Choice-Fragen im JSON-Array-Format." };

  const [aResult, bResult] = await Promise.all([
    timedAICall(provider, model, sysMsg, promptA),
    timedAICall(provider, model, sysMsg, basePrompt),
  ]);

  const scoreA = scoreQuestions(aResult.data);
  const scoreB = scoreQuestions(bResult.data);
  const label = bp.canonical_statement?.slice(0, 80) || bp.id;

  console.log(`[KG-Canary] ${bp.id.slice(0, 8)}: A(kg=${graphCtx?.common_errors?.length || 0})=${scoreA.avgQuality.toFixed(1)} vs B=${scoreB.avgQuality.toFixed(1)}`);

  return [
    { blueprint_id: bp.id, blueprint_label: label, competency_title: compTitle, variant: "A_with_kg", kg_errors_count: graphCtx?.common_errors?.length || 0, questions_generated: scoreA.count, avg_quality_score: scoreA.avgQuality, distractor_quality: scoreA.distractorScore, praxis_score: scoreA.praxisScore, raw_output: aResult.data, model_used: `${provider}/${model}`, latency_ms: aResult.latency },
    { blueprint_id: bp.id, blueprint_label: label, competency_title: compTitle, variant: "B_without_kg", kg_errors_count: 0, questions_generated: scoreB.count, avg_quality_score: scoreB.avgQuality, distractor_quality: scoreB.distractorScore, praxis_score: scoreB.praxisScore, raw_output: bResult.data, model_used: `${provider}/${model}`, latency_ms: bResult.latency },
  ];
}

async function timedAICall(provider: "openai", model: string, sysMsg: any, userContent: string) {
  const start = Date.now();
  try {
    const resp = await callAIJSON({ provider, model, messages: [sysMsg, { role: "user", content: userContent }], max_tokens: 2200 });
    return { data: JSON.parse(resp.content), latency: Date.now() - start };
  } catch (e) {
    return { data: { error: (e as Error)?.message }, latency: Date.now() - start };
  }
}

// ── Prompt builders ──

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

// ── Scoring ──

function scoreQuestions(raw: unknown): { count: number; avgQuality: number; distractorScore: number; praxisScore: number } {
  if (!Array.isArray(raw)) return { count: 0, avgQuality: 0, distractorScore: 0, praxisScore: 0 };
  const qs = raw.filter((q: any) => q?.question_text && q?.options?.length === 4);
  if (qs.length === 0) return { count: 0, avgQuality: 0, distractorScore: 0, praxisScore: 0 };

  let totalQ = 0, totalD = 0, totalP = 0;
  for (const q of qs) {
    totalQ += Number(q.quality_score) || 3;
    totalP += Number(q.praxis_score) || 3;
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

// ── Summary computation ──

function computeSummary(results: CanaryResult[]) {
  const variantA = results.filter(r => r.variant === "A_with_kg");
  const variantB = results.filter(r => r.variant === "B_without_kg");
  const avgA = variantA.reduce((s, r) => s + r.avg_quality_score, 0) / (variantA.length || 1);
  const avgB = variantB.reduce((s, r) => s + r.avg_quality_score, 0) / (variantB.length || 1);
  const avgDistA = variantA.reduce((s, r) => s + r.distractor_quality, 0) / (variantA.length || 1);
  const avgDistB = variantB.reduce((s, r) => s + r.distractor_quality, 0) / (variantB.length || 1);
  const verdict = avgA > avgB ? "kg_wins" : avgA < avgB ? "baseline_wins" : "tie";

  return {
    avgA,
    verdict,
    full: {
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
      verdict,
    },
  };
}
