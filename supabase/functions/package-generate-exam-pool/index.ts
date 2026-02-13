import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { callAIJSON } from "../_shared/ai-client.ts";

const CHUNK_SIZE = 100;
const AI_CHUNK_SIZE = 20;
const SHIP_TARGET = 1000;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

async function prereqDone(sb: ReturnType<typeof createClient>, packageId: string, stepKey: string) {
  const { data, error } = await sb
    .from("course_package_build_steps")
    .select("status")
    .eq("package_id", packageId)
    .eq("step_key", stepKey)
    .maybeSingle();
  if (error) throw error;
  return data?.status === "done";
}

// ─── AI Fallback for empty blueprints ──────────────────────────────────────────

interface BlueprintInfo {
  id: string;
  curriculum_id: string;
  learning_field_id: string | null;
  competency_id: string | null;
  name: string;
  canonical_statement: string;
  cognitive_level: string;
  question_template: string;
}

async function generateQuestionsWithAI(
  sb: ReturnType<typeof createClient>,
  bp: BlueprintInfo,
  count: number,
): Promise<number> {
  let compTitle = bp.name;
  let compDesc = bp.canonical_statement;
  let lfTitle = "";

  if (bp.competency_id) {
    const { data: comp } = await sb
      .from("competencies")
      .select("title, description")
      .eq("id", bp.competency_id)
      .maybeSingle();
    if (comp) { compTitle = comp.title || compTitle; compDesc = comp.description || compDesc; }
  }
  if (bp.learning_field_id) {
    const { data: lf } = await sb
      .from("learning_fields")
      .select("title")
      .eq("id", bp.learning_field_id)
      .maybeSingle();
    if (lf) lfTitle = lf.title || "";
  }

  const difficulty = bp.cognitive_level === "remember" ? "easy" :
                     bp.cognitive_level === "analyze" ? "hard" : "medium";

  const systemPrompt = `Du bist ein Experte für IHK-Prüfungsfragen. Erstelle Multiple-Choice-Fragen.
Regeln:
- Genau 4 Antwortmöglichkeiten, nur eine korrekt
- Praxisnah und prüfungsrelevant
- Ausführliche Erklärung
Antworte NUR mit einem JSON-Array:
[{"question_text":"...","options":["A","B","C","D"],"correct_answer":0,"explanation":"...","difficulty":"${difficulty}"}]`;

  const userPrompt = `Erstelle ${count} ${difficulty === "easy" ? "leichte" : difficulty === "hard" ? "schwere" : "mittelschwere"} Prüfungsfragen.
Lernfeld: ${lfTitle}
Kompetenz: ${compTitle}
Beschreibung: ${compDesc}
Blueprint-Vorlage: ${bp.question_template}`;

  const result = await callAIJSON({
    provider: "anthropic",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    temperature: 0.7,
    max_tokens: 4000,
  });

  if (!result.content) return 0;

  let questions: Array<{
    question_text: string;
    options: string[];
    correct_answer: number;
    explanation: string;
    difficulty: string;
  }>;
  try {
    const clean = result.content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    questions = JSON.parse(clean);
    if (!Array.isArray(questions)) return 0;
  } catch {
    return 0;
  }

  let saved = 0;
  for (const q of questions) {
    if (!q.question_text || !Array.isArray(q.options) || q.options.length !== 4) continue;
    const { error } = await sb.from("exam_questions").insert({
      curriculum_id: bp.curriculum_id,
      learning_field_id: bp.learning_field_id,
      competency_id: bp.competency_id,
      blueprint_id: bp.id,
      question_text: q.question_text,
      options: q.options,
      correct_answer: q.correct_answer ?? 0,
      explanation: q.explanation || "",
      difficulty: q.difficulty || difficulty,
      ai_generated: true,
      status: "draft",
    });
    if (!error) saved++;
  }
  return saved;
}

// ─── Main Handler ──────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const body = await req.json().catch(() => ({}));
  const p = body.payload || body;
  const packageId = p.package_id;
  const curriculumId = p.curriculum_id;
  const examTarget = Number(p.options?.exam_target ?? SHIP_TARGET);

  const batchCursor = p._batch_cursor || p.batch_cursor || null;
  const generatedSoFar = batchCursor?.generated ?? 0;
  const bpIndex = batchCursor?.blueprint_index ?? 0;

  if (!packageId || !curriculumId) return json({ error: "Missing package_id or curriculum_id" }, 400);

  const failAndUnlock = async (msg: string) => {
    await sb.from("course_packages").update({ status: "failed" }).eq("id", packageId);
    await sb.rpc("update_course_package_step", {
      p_package_id: packageId, p_step_key: "generate_exam_pool", p_status: "failed", p_log: { error: msg },
    });
    await sb.from("course_package_locks").delete().eq("package_id", packageId);
  };

  try {
    if (!(await prereqDone(sb, packageId, "scaffold_learning_course"))) {
      return json({ ok: false, retry: true, error: "PREREQ_NOT_DONE: scaffold_learning_course" }, 409);
    }

    if (generatedSoFar === 0) {
      await sb.rpc("update_course_package_step", {
        p_package_id: packageId, p_step_key: "generate_exam_pool", p_status: "running",
        p_log: { note: `Generating exam pool target=${examTarget} (chunked, ${CHUNK_SIZE}/run)` },
      });
    }

    // Get blueprints with context for AI fallback
    const { data: bps, error: bpErr } = await sb
      .from("question_blueprints")
      .select("id, max_variations, curriculum_id, learning_field_id, competency_id, name, canonical_statement, cognitive_level, question_template")
      .eq("curriculum_id", curriculumId)
      .eq("status", "approved")
      .order("created_at", { ascending: true });

    if (bpErr) throw bpErr;
    if (!bps?.length) throw new Error("No approved question_blueprints for curriculum");

    // Check if blueprints are hydrated
    const { count: varCount } = await sb
      .from("blueprint_variables")
      .select("id", { count: "exact", head: true })
      .in("blueprint_id", bps.map((b: { id: string }) => b.id));

    const useAIFallback = (varCount ?? 0) === 0;
    if (useAIFallback) {
      console.log(`[ExamPool] Using AI fallback (no variables/distractors)`);
    }

    const perBlueprint = Math.max(1, Math.ceil(examTarget / bps.length));
    let questionsThisChunk = 0;
    let currentBpIndex = bpIndex;
    const errors: string[] = [];

    while (questionsThisChunk < CHUNK_SIZE && currentBpIndex < bps.length) {
      const bp = bps[currentBpIndex] as BlueprintInfo & { max_variations: number | null };
      const cap = typeof bp.max_variations === "number" && bp.max_variations > 0 ? bp.max_variations : perBlueprint;
      const count = Math.min(perBlueprint, cap);

      try {
        if (useAIFallback) {
          const generated = await generateQuestionsWithAI(sb, bp, Math.min(count, AI_CHUNK_SIZE));
          questionsThisChunk += generated;
        } else {
          const { error } = await sb.functions.invoke("generate-blueprint-questions", {
            body: { blueprintId: bp.id, count, baseSeed: Date.now() + currentBpIndex },
          });
          if (error) {
            errors.push(`BP ${bp.id.slice(0, 8)}: ${error.message || String(error)}`);
          } else {
            questionsThisChunk += count;
          }
        }
      } catch (e: unknown) {
        const errMsg = (e as Error)?.message || String(e);
        console.log(`[ExamPool] BP ${bp.id.slice(0, 8)} FAIL: ${errMsg}`);
        errors.push(`BP ${bp.id.slice(0, 8)}: ${errMsg}`);
      }
      currentBpIndex++;
    }

    // Count actual questions
    const { count: totalQuestions } = await sb
      .from("exam_questions")
      .select("id", { count: "exact", head: true })
      .eq("curriculum_id", curriculumId);

    const actualTotal = totalQuestions ?? 0;
    const allBlueprintsProcessed = currentBpIndex >= bps.length;
    const targetReached = actualTotal >= SHIP_TARGET;

    console.log(
      `[ExamPool] Package ${packageId.slice(0, 8)}: chunk done. ` +
      `Generated ~${questionsThisChunk} this run, total=${actualTotal}/${examTarget}, ` +
      `blueprints ${currentBpIndex}/${bps.length}, errors=${errors.length}`
    );

    const progress = Math.min(55, Math.round(25 + (actualTotal / examTarget) * 30));
    await sb.from("course_packages").update({ build_progress: progress }).eq("id", packageId);

    if (allBlueprintsProcessed || targetReached) {
      await sb.rpc("update_course_package_step", {
        p_package_id: packageId, p_step_key: "generate_exam_pool", p_status: "done",
        p_log: {
          ok: true, target: examTarget, actual: actualTotal,
          blueprints_processed: currentBpIndex, blueprints_total: bps.length,
          chunk_errors: errors.length, ai_fallback: useAIFallback,
        },
      });
      await sb.from("course_packages").update({ build_progress: 55 }).eq("id", packageId);

      return json({
        ok: true, batch_complete: true, total_questions: actualTotal,
        target: examTarget, blueprints_processed: currentBpIndex,
        ai_fallback: useAIFallback, error_details: errors.slice(0, 5),
      });
    } else {
      return json({
        ok: true, batch_complete: false,
        batch_cursor: { generated: actualTotal, blueprint_index: currentBpIndex, target: examTarget, blueprints_total: bps.length },
        total_questions: actualTotal, chunk_errors: errors.length,
      });
    }
  } catch (e: unknown) {
    const msg = (e as Error)?.message || String(e);
    console.log(`[ExamPool] Fatal: ${msg}`);
    await failAndUnlock(msg);
    return json({ ok: false, error: msg }, 500);
  }
});
