import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { callAIJSON } from "../_shared/ai-client.ts";
import { getModelChainAsync } from "../_shared/model-routing.ts";
import { resolveProfession } from "../_shared/profession-resolver.ts";
import { enqueueJob } from "../_shared/enqueue.ts";
import { MAX_QUESTIONS_PER_PACKAGE } from "../_shared/exam-pool-limits.ts";

/**
 * pool-fill-bloom-gaps — Targeted Bloom/Difficulty/Competency gap-fill worker
 *
 * Uses the SSOT RPC `get_exam_pool_gap_report` to identify exactly which
 * Bloom levels, difficulty tiers, and competencies are underrepresented,
 * then generates targeted questions to close those gaps.
 *
 * Key design decisions:
 * - Idempotent: skips gaps already filled since last report
 * - Elite-conformant: enforces SSOT target distribution
 * - Budget-guarded: max MAX_QUESTIONS_PER_RUN per invocation
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
const MAX_QUESTIONS_PER_RUN = 40;       // Budget guard per invocation
const MIN_BATCH_SIZE = 5;                // Don't generate fewer than 5
const MAX_COMPETENCY_GAPS = 10;          // Max competencies to fill per run

// ── Bloom → Difficulty mapping (SSOT-aligned) ──
const BLOOM_DIFFICULTY_MAP: Record<string, string> = {
  remember: "easy",
  understand: "medium",
  apply: "medium",
  analyze: "hard",
  evaluate: "very_hard",
};

// ── Context types by bloom (for prompt diversity) ──
const CONTEXT_TYPES: Record<string, string[]> = {
  remember: ["isolated_knowledge", "applied_case"],
  understand: ["applied_case", "error_detection"],
  apply: ["applied_case", "multi_step_case", "documentation_analysis"],
  analyze: ["multi_step_case", "error_detection", "legal_evaluation"],
  evaluate: ["legal_evaluation", "prioritization", "multi_step_case"],
};

function pickContext(bloom: string, index: number): string {
  const pool = CONTEXT_TYPES[bloom] || CONTEXT_TYPES["apply"];
  return pool[index % pool.length];
}

interface GapEntry {
  key: string;
  gap: number;
}

interface CompGapEntry {
  competency_id: string;
  approved_count: number;
  gap: number;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let payload: Record<string, unknown>;
  try {
    payload = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const curriculumId = payload.curriculum_id as string;
  const packageId = payload.package_id as string | undefined;

  if (!curriculumId) return json({ error: "curriculum_id required" }, 400);

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
      console.log(`[bloom-gap-fill] SSOT HARD CAP reached: ${currentCount} >= ${MAX_QUESTIONS_PER_PACKAGE} — skipping`);
      return json({ ok: true, message: "pool_cap_reached", pool_size: currentCount, cap: MAX_QUESTIONS_PER_PACKAGE });
    }

    // ── 1. Fetch gap report (returns single JSONB object, NOT a table) ──
    const { data: report, error: gapErr } = await sb.rpc(
      "get_exam_pool_gap_report",
      { p_curriculum_id: curriculumId },
    );

    if (gapErr) {
      console.error("[bloom-gap-fill] RPC error:", gapErr.message);
      return json({ ok: false, error: gapErr.message }, 500);
    }

    if (!report || typeof report !== "object") {
      console.log("[bloom-gap-fill] No report data returned");
      return json({ ok: true, message: "no_report", generated: 0 });
    }

    // Parse JSONB object format: bloom_gaps: {"remember": 5, ...}, difficulty_gaps: {...}, competency_gaps: [...]
    const bloomGapsObj = (report as Record<string, unknown>).bloom_gaps as Record<string, number> || {};
    const diffGapsObj = (report as Record<string, unknown>).difficulty_gaps as Record<string, number> || {};
    const compGapsArr = (report as Record<string, unknown>).competency_gaps as Array<{ competency_id: string; approved_count: number }> || [];

    const bloomGaps: GapEntry[] = Object.entries(bloomGapsObj)
      .filter(([_, gap]) => gap > 0)
      .map(([key, gap]) => ({ key, gap }));

    const diffGaps: GapEntry[] = Object.entries(diffGapsObj)
      .filter(([_, gap]) => gap > 0)
      .map(([key, gap]) => ({ key, gap }));

    const compGaps: CompGapEntry[] = compGapsArr
      .map((c) => ({ competency_id: c.competency_id, approved_count: c.approved_count, gap: Math.max(0, 3 - c.approved_count) }))
      .filter((c) => c.gap > 0)
      .sort((a, b) => b.gap - a.gap)
      .slice(0, MAX_COMPETENCY_GAPS);

    const totalGap = bloomGaps.reduce((s, g) => s + g.gap, 0)
      + diffGaps.reduce((s, g) => s + g.gap, 0)
      + compGaps.reduce((s, g) => s + g.gap, 0);

    if (totalGap === 0) {
      console.log("[bloom-gap-fill] No gaps found — all targets met");
      return json({ ok: true, message: "all_targets_met", generated: 0 });
    }

    console.log(
      `[bloom-gap-fill] Gaps found: ${bloomGaps.length} bloom, ${diffGaps.length} difficulty, ${compGaps.length} competency (total=${totalGap})`,
    );

    // ── 2. Build generation plan ──
    // Priority: competency gaps first (most impactful), then bloom gaps
    interface GenTarget {
      bloom: string;
      difficulty: string;
      competency_id?: string;
      competency_title?: string;
      count: number;
    }

    const plan: GenTarget[] = [];
    let remaining = Math.min(MAX_QUESTIONS_PER_RUN, globalBudget); // SSOT: clamp to pool budget

    // 2a. Competency gaps — generate with the most needed bloom level
    for (const comp of compGaps) {
      if (remaining <= 0) break;
      const count = Math.min(comp.gap, 5, remaining);
      const topBloom = bloomGaps.length > 0 ? bloomGaps[0].key : "apply";
      plan.push({
        bloom: topBloom,
        difficulty: BLOOM_DIFFICULTY_MAP[topBloom] || "medium",
        competency_id: comp.competency_id,
        count,
      });
      remaining -= count;
    }

    // 2b. Bloom gaps — generate without specific competency
    for (const bg of bloomGaps) {
      if (remaining <= 0) break;
      const count = Math.min(bg.gap, 8, remaining);
      if (count < 2) continue; // skip trivial gaps
      plan.push({
        bloom: bg.key,
        difficulty: BLOOM_DIFFICULTY_MAP[bg.key] || "medium",
        count,
      });
      remaining -= count;
    }

    // 2c. Difficulty gaps (if still budget left)
    for (const dg of diffGaps) {
      if (remaining <= 0) break;
      const count = Math.min(dg.gap, 6, remaining);
      if (count < 2) continue;
      // Pick a matching bloom for this difficulty
      const bloomForDiff: Record<string, string> = {
        easy: "remember",
        medium: "understand",
        hard: "analyze",
        very_hard: "evaluate",
      };
      plan.push({
        bloom: bloomForDiff[dg.key] || "apply",
        difficulty: dg.key,
        count,
      });
      remaining -= count;
    }

    const totalPlanned = plan.reduce((s, p) => s + p.count, 0);
    if (totalPlanned < MIN_BATCH_SIZE) {
      console.log(`[bloom-gap-fill] Plan too small (${totalPlanned}) — skipping`);
      return json({ ok: true, message: "gap_too_small", planned: totalPlanned });
    }

    console.log(`[bloom-gap-fill] Plan: ${plan.length} targets, ${totalPlanned} questions`);

    // ── 3. Resolve profession context ──
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
      } catch { /* fallback */ }
    }

    // ── 4. Resolve competency titles for prompt context ──
    const compIds = plan.filter((p) => p.competency_id).map((p) => p.competency_id!);
    if (compIds.length > 0) {
      const { data: comps } = await sb
        .from("competencies")
        .select("id, title")
        .in("id", compIds);
      const compMap = new Map((comps || []).map((c: { id: string; title: string }) => [c.id, c.title]));
      for (const p of plan) {
        if (p.competency_id) {
          p.competency_title = compMap.get(p.competency_id) || undefined;
        }
      }
    }

    // ── 5. Generate questions via AI ──
    const modelChain = await getModelChainAsync("exam_questions");
    const allQuestions: Array<Record<string, unknown>> = [];

    // Group plan into a single prompt for efficiency
    const questionsSpec = plan.flatMap((target, tIdx) =>
      Array.from({ length: target.count }, (_, i) => ({
        index: allQuestions.length + tIdx * 10 + i + 1,
        cognitive_level: target.bloom,
        difficulty: target.difficulty,
        competency: target.competency_title || null,
        competency_id: target.competency_id || null,
        context_type: pickContext(target.bloom, i),
      })),
    );

    const systemPrompt = `Du bist ein IHK-Prüfungsexperte für "${professionContext}".
Erstelle exakt ${questionsSpec.length} Multiple-Choice-Prüfungsfragen.

REGELN:
- Jede Frage hat exakt 4 Antwortmöglichkeiten (A-D), genau 1 korrekt
- Praxisnah: Situationsaufgaben mit konkreten Szenarien, Namen, Zahlen
- KEINE "Was ist die Definition von..." Fragen bei apply/analyze/evaluate
- Erklärung MUSS enthalten: Warum richtig + warum jede falsche Antwort falsch ist
- Distraktoren müssen PLAUSIBEL sein (typische Azubi-Fehler)
- min. 2 typical_errors pro Frage

COGNITIVE LEVELS (Bloom):
- remember: Faktenwissen direkt abrufbar
- understand: Zusammenhänge erklären
- apply: Wissen auf neue Situation anwenden
- analyze: Fehler finden, Ursachen ermitteln
- evaluate: Bewerten, Priorisieren, Entscheiden

FRAGEN-SPEZIFIKATION:
${questionsSpec.map((s, i) => `Frage ${i + 1}: cognitive=${s.cognitive_level}, difficulty=${s.difficulty}, context=${s.context_type}${s.competency ? `, Kompetenz="${s.competency}"` : ""}`).join("\n")}

Antworte NUR als JSON:
{
  "questions": [
    {
      "question_text": "...",
      "options": ["A) ...", "B) ...", "C) ...", "D) ..."],
      "correct_answer": 0,
      "explanation": "...",
      "difficulty": "easy|medium|hard|very_hard",
      "cognitive_level": "remember|understand|apply|analyze|evaluate",
      "typical_errors": ["Fehler 1", "Fehler 2"],
      "spec_index": 0
    }
  ]
}`;

    let aiQuestions: Array<Record<string, unknown>> = [];
    let aiError: string | null = null;

    for (const model of modelChain) {
      try {
        const result = await callAIJSON({
          model: model.model,
          provider: model.provider as "openai" | "anthropic" | "google",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: `Generiere jetzt die ${questionsSpec.length} Prüfungsfragen.` },
          ],
          temperature: 0.7,
          max_tokens: 12000,
        });

        let cleaned = result.content;
        cleaned = cleaned.replace(/^```(?:json)?\s*\n?/im, "").replace(/\n?```\s*$/im, "").trim();
        if (!cleaned.startsWith("{") && !cleaned.startsWith("[")) {
          const match = cleaned.match(/(\[[\s\S]*\]|\{[\s\S]*\})/);
          if (match) cleaned = match[1];
        }

        let parsed: Record<string, unknown>;
        try {
          parsed = JSON.parse(cleaned);
        } catch {
          const lastComplete = cleaned.lastIndexOf("}");
          if (lastComplete > 0) {
            parsed = JSON.parse(cleaned.slice(0, lastComplete + 1) + "]}");
          } else {
            throw new Error("Could not parse AI response");
          }
        }

        aiQuestions = Array.isArray(parsed)
          ? parsed
          : (parsed.questions as Array<Record<string, unknown>>) || [];
        if (aiQuestions.length > 0) break;
      } catch (e) {
        aiError = (e as Error).message;
        console.error(`[bloom-gap-fill] AI error with ${model.model}: ${aiError}`);
      }
    }

    if (aiQuestions.length === 0) {
      console.error("[bloom-gap-fill] All AI models failed:", aiError);
      return json({ ok: false, error: aiError || "ai_failed" }, 500);
    }

    // ── 6. Build DB inserts ──
    const inserts = aiQuestions.slice(0, questionsSpec.length).map((q, i) => {
      const spec = questionsSpec[i] || questionsSpec[0];
      let typicalErrors = Array.isArray(q.typical_errors)
        ? (q.typical_errors as string[]).filter(Boolean).map(String)
        : [];
      if (typicalErrors.length < 2) {
        typicalErrors = ["Falsche Priorisierung", "Unvollständige Begründung"];
      }

      return {
        curriculum_id: curriculumId,
        competency_id: spec.competency_id || null,
        question_text: (q.question_text as string) || `Frage ${i + 1}`,
        options: Array.isArray(q.options) ? q.options : ["A)", "B)", "C)", "D)"],
        correct_answer: typeof q.correct_answer === "number" ? q.correct_answer : 0,
        explanation: (q.explanation as string) || "",
        difficulty: (q.difficulty as string) || spec.difficulty,
        cognitive_level: (q.cognitive_level as string) || spec.cognitive_level,
        question_type: "concept",
        qc_status: "pending",
        ai_generated: true,
        status: "draft",
        trap_tags: typicalErrors,
        typical_errors: typicalErrors.length > 0 ? typicalErrors : null,
        scenario_type: spec.context_type || null,
      };
    });

    const { error: insErr } = await sb.from("exam_questions").insert(inserts);
    if (insErr) {
      console.error("[bloom-gap-fill] DB insert error:", insErr.message);
      return json({ ok: false, error: insErr.message }, 500);
    }

    console.log(`[bloom-gap-fill] Inserted ${inserts.length} questions`);

    // ── 7. Post-fill: kick validate_exam_pool ──
    const pkgFilter = packageId
      ? sb.from("course_packages").select("id").eq("id", packageId).eq("status", "building")
      : sb.from("course_packages").select("id").eq("curriculum_id", curriculumId).eq("status", "building").limit(5);

    const { data: pkgs } = await pkgFilter;
    for (const pkg of pkgs || []) {
      await sb
        .from("package_steps")
        .update({
          status: "queued",
          attempts: 0,
          job_id: null,
          runner_id: null,
          started_at: null,
          last_error: `Bloom-gap-fill: inserted ${inserts.length} targeted questions`,
        })
        .eq("package_id", (pkg as { id: string }).id)
        .eq("step_key", "validate_exam_pool")
        .in("status", ["failed", "queued", "enqueued"]);

      console.log(`[bloom-gap-fill] Kicked validate_exam_pool for package ${((pkg as { id: string }).id).slice(0, 8)}`);
    }

    return json({
      ok: true,
      generated: inserts.length,
      plan_summary: {
        bloom_targets: bloomGaps.map((g) => ({ bloom: g.key, gap: g.gap })),
        difficulty_targets: diffGaps.map((g) => ({ difficulty: g.key, gap: g.gap })),
        competency_targets: compGaps.length,
      },
    });
  } catch (e: unknown) {
    const msg = (e as Error)?.message || String(e);
    console.error("[bloom-gap-fill] Fatal error:", msg);
    return json({ ok: false, error: msg }, 500);
  }
});
