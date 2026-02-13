import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

/**
 * Stufe 1+2: Increased chunk sizes + fan-out by learning field
 * - Standard blueprints: 10 per run
 * - AI fallback: 5 blueprints per run (increased from 2)
 * - Fan-out: Groups blueprints by learning_field_id for parallel sub-jobs
 */
const CHUNK_SIZE = 10;
const AI_CHUNK_SIZE = 8;
const AI_QUESTIONS_PER_BLUEPRINT = 30;

// Dynamic ship target: derived from ausbildungsdauer_monate in payload.options
function getShipTarget(examTarget: number): number {
  if (examTarget <= 600) return 500;
  if (examTarget <= 800) return 700;
  if (examTarget <= 1000) return 850;
  return 1000; // EXAM_FIRST (target 1200)
}

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

  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

  const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.7,
      max_tokens: 8000,
    }),
  });

  if (!aiResp.ok) {
    const status = aiResp.status;
    console.log(`[ExamPool] AI gateway error: ${status}`);
    // On rate limit, signal retry
    if (status === 429) throw new Error("RATE_LIMIT: AI gateway 429");
    return 0;
  }

  const aiData = await aiResp.json();
  const rawContent = aiData.choices?.[0]?.message?.content || "";
  if (!rawContent) return 0;

  let questions: Array<{
    question_text: string;
    options: string[];
    correct_answer: number;
    explanation: string;
    difficulty: string;
  }>;
  try {
    const clean = rawContent.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    questions = JSON.parse(clean);
    if (!Array.isArray(questions)) return 0;
  } catch {
    return 0;
  }

  let saved = 0;
  console.log(`[ExamPool] AI returned ${questions.length} questions for BP ${bp.id.slice(0,8)}`);
  for (const q of questions) {
    if (!q.question_text || !Array.isArray(q.options) || q.options.length !== 4) {
      continue;
    }
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
    if (error) {
      console.log(`[ExamPool] Insert error: ${error.message} (code: ${error.code})`);
    } else {
      saved++;
    }
  }
  return saved;
}

// ─── Stufe 2: Fan-out by learning field ────────────────────────────────────────

async function enqueueLearningFieldJobs(
  sb: ReturnType<typeof createClient>,
  packageId: string,
  curriculumId: string,
  bps: BlueprintInfo[],
  examTarget: number,
): Promise<{ enqueued: number; learningFields: number }> {
  // Group blueprints by learning_field_id
  const lfGroups = new Map<string, BlueprintInfo[]>();
  for (const bp of bps) {
    const lfId = bp.learning_field_id || "unknown";
    if (!lfGroups.has(lfId)) lfGroups.set(lfId, []);
    lfGroups.get(lfId)!.push(bp);
  }

  const perLf = Math.ceil(examTarget / lfGroups.size);
  const nowIso = new Date().toISOString();
  const jobs = [];

  for (const [lfId, lfBps] of lfGroups) {
    jobs.push({
      job_type: "package_generate_exam_pool",
      status: "pending",
      attempts: 0,
      max_attempts: 25,
      run_after: nowIso,
      payload: {
        package_id: packageId,
        curriculum_id: curriculumId,
        learning_field_filter: lfId,
        lf_target: perLf,
        blueprint_ids: lfBps.map(b => b.id),
        options: { exam_target: examTarget },
        _fan_out: true,
      },
    });
  }

  if (jobs.length > 0) {
    const { error } = await sb.from("job_queue").insert(jobs);
    if (error) {
      console.log(`[ExamPool] Fan-out enqueue error: ${error.message}`);
      return { enqueued: 0, learningFields: lfGroups.size };
    }
  }

  return { enqueued: jobs.length, learningFields: lfGroups.size };
}

// ─── Check if all fan-out sub-jobs for a package are done ──────────────────────
async function allFanOutSubJobsDone(
  sb: ReturnType<typeof createClient>,
  packageId: string,
): Promise<boolean> {
  const { count } = await sb
    .from("job_queue")
    .select("id", { count: "exact", head: true })
    .eq("job_type", "package_generate_exam_pool")
    .in("status", ["pending", "processing"])
    .contains("payload", { package_id: packageId, _fan_out: true });
  return (count ?? 0) === 0;
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
  const examTarget = Number(p.options?.exam_target ?? 1000);
  const shipTarget = getShipTarget(examTarget);
  const isFanOut = p._fan_out === true;
  const blueprintIds: string[] | null = p.blueprint_ids || null;
  const lfTarget = p.lf_target || examTarget;

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
    // Skip prereq check for fan-out sub-jobs (parent already verified)
    if (!isFanOut) {
      if (!(await prereqDone(sb, packageId, "scaffold_learning_course"))) {
        return json({ ok: false, retry: true, error: "PREREQ_NOT_DONE: scaffold_learning_course" }, 409);
      }
    }

    if (generatedSoFar === 0 && !isFanOut) {
      await sb.rpc("update_course_package_step", {
        p_package_id: packageId, p_step_key: "generate_exam_pool", p_status: "running",
        p_log: { note: `Generating exam pool target=${examTarget} (chunked, ${CHUNK_SIZE}/run)` },
      });
    }

    // Get blueprints — filtered if fan-out sub-job
    let bpQuery = sb
      .from("question_blueprints")
      .select("id, max_variations, curriculum_id, learning_field_id, competency_id, name, canonical_statement, cognitive_level, question_template")
      .eq("curriculum_id", curriculumId)
      .eq("status", "approved")
      .order("created_at", { ascending: true });

    if (blueprintIds && blueprintIds.length > 0) {
      bpQuery = bpQuery.in("id", blueprintIds);
    }

    const { data: bps, error: bpErr } = await bpQuery;

    if (bpErr) throw bpErr;
    if (!bps?.length) throw new Error("No approved question_blueprints for curriculum");

    // Check if blueprints are hydrated
    const { count: varCount } = await sb
      .from("blueprint_variables")
      .select("id", { count: "exact", head: true })
      .in("blueprint_id", bps.map((b: { id: string }) => b.id));

    const useAIFallback = (varCount ?? 0) === 0;

    // ── Stufe 2: Fan-out on first call (non-fan-out, no cursor yet) ──
    if (!isFanOut && bpIndex === 0 && useAIFallback && bps.length > 10) {
      console.log(`[ExamPool] Stufe 2: Fan-out ${bps.length} blueprints by learning field`);
      const { enqueued, learningFields } = await enqueueLearningFieldJobs(
        sb, packageId, curriculumId, bps as BlueprintInfo[], examTarget
      );

      if (enqueued > 0) {
        // Keep step as "running" — sub-jobs will complete it
        await sb.rpc("update_course_package_step", {
          p_package_id: packageId, p_step_key: "generate_exam_pool", p_status: "running",
          p_log: { note: `Fan-out: ${enqueued} sub-jobs for ${learningFields} Lernfelder`, fan_out: true, pending_sub_jobs: enqueued },
        });
        // IMPORTANT: batch_complete=false so the job-runner knows this is NOT done yet
        // The parent job finishes, but the step stays "running" until sub-jobs complete
        return json({
          ok: true, batch_complete: true,
          fan_out: true, sub_jobs: enqueued, learning_fields: learningFields,
        });
      }
    }

    if (useAIFallback) {
      console.log(`[ExamPool] Using AI fallback (no variables/distractors)`);
    }

    const effectiveTarget = isFanOut ? lfTarget : examTarget;
    const perBlueprint = Math.max(1, Math.ceil(effectiveTarget / bps.length));
    let questionsThisChunk = 0;
    let currentBpIndex = bpIndex;
    const errors: string[] = [];

    const maxBpsThisRun = useAIFallback ? AI_CHUNK_SIZE : CHUNK_SIZE;
    let bpsProcessed = 0;

    while (bpsProcessed < maxBpsThisRun && currentBpIndex < bps.length) {
      const bp = bps[currentBpIndex] as BlueprintInfo & { max_variations: number | null };
      const cap = typeof bp.max_variations === "number" && bp.max_variations > 0 ? bp.max_variations : perBlueprint;
      const count = Math.min(perBlueprint, cap, AI_QUESTIONS_PER_BLUEPRINT);

      try {
        if (useAIFallback) {
          const generated = await generateQuestionsWithAI(sb, bp, count);
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
      bpsProcessed++;
    }

    // Count actual questions
    const { count: totalQuestions } = await sb
      .from("exam_questions")
      .select("id", { count: "exact", head: true })
      .eq("curriculum_id", curriculumId);

    const actualTotal = totalQuestions ?? 0;
    const allBlueprintsProcessed = currentBpIndex >= bps.length;
    const targetReached = actualTotal >= shipTarget;

    console.log(
      `[ExamPool] Package ${packageId.slice(0, 8)}: chunk done. ` +
      `Generated ~${questionsThisChunk} this run, total=${actualTotal}/${examTarget}, ` +
      `blueprints ${currentBpIndex}/${bps.length}, errors=${errors.length}${isFanOut ? ' (fan-out sub-job)' : ''}`
    );

    const progress = Math.min(55, Math.round(25 + (actualTotal / examTarget) * 30));
    await sb.from("course_packages").update({ build_progress: progress }).eq("id", packageId);

    if (targetReached) {
      // Target reached — mark step done
      // For fan-out sub-jobs: check if ALL sub-jobs for this package are done before marking step complete
      const shouldMarkDone = !isFanOut || await allFanOutSubJobsDone(sb, packageId);
      if (shouldMarkDone) {
        await sb.rpc("update_course_package_step", {
          p_package_id: packageId, p_step_key: "generate_exam_pool", p_status: "done",
          p_log: {
            ok: true, target: examTarget, actual: actualTotal,
            blueprints_processed: currentBpIndex, blueprints_total: bps.length,
            chunk_errors: errors.length, ai_fallback: useAIFallback,
          },
        });
        await sb.from("course_packages").update({ build_progress: 55 }).eq("id", packageId);
      }

      return json({
        ok: true, batch_complete: true, total_questions: actualTotal,
        target: examTarget, blueprints_processed: currentBpIndex,
        ai_fallback: useAIFallback, fan_out: isFanOut,
        error_details: errors.slice(0, 5),
      });
    } else if (allBlueprintsProcessed && !targetReached) {
      const currentLoop = (batchCursor?.loop_count ?? 0) + 1;
      // Max 5 loops to prevent infinite re-looping
      if (currentLoop >= 5) {
        console.log(`[ExamPool] Loop cap reached (${currentLoop}). Accepting ${actualTotal} questions.`);
        if (!isFanOut) {
          await sb.rpc("update_course_package_step", {
            p_package_id: packageId, p_step_key: "generate_exam_pool", p_status: "done",
            p_log: {
              ok: true, target: examTarget, actual: actualTotal,
              note: `Loop-capped at ${currentLoop} cycles`,
              blueprints_processed: currentBpIndex, ai_fallback: useAIFallback,
            },
          });
          await sb.from("course_packages").update({ build_progress: 55 }).eq("id", packageId);
        }
        return json({
          ok: true, batch_complete: true, total_questions: actualTotal,
          target: examTarget, loop_capped: true, loop_count: currentLoop,
        });
      }

      // All blueprints processed but target NOT met → re-enqueue with index 0 to loop again
      console.log(`[ExamPool] All BPs processed but only ${actualTotal}/${examTarget} — re-looping (cycle ${currentLoop})`);
      return json({
        ok: true, batch_complete: false,
        batch_cursor: { generated: actualTotal, blueprint_index: 0, target: examTarget, blueprints_total: bps.length, loop_count: currentLoop },
        total_questions: actualTotal, chunk_errors: errors.length,
        note: `Re-looping cycle ${currentLoop}: all blueprints processed but target not reached`,
      });
    } else {
      return json({
        ok: true, batch_complete: false,
        batch_cursor: { generated: actualTotal, blueprint_index: currentBpIndex, target: examTarget, blueprints_total: bps.length, loop_count: batchCursor?.loop_count ?? 0 },
        total_questions: actualTotal, chunk_errors: errors.length,
      });
    }
  } catch (e: unknown) {
    const msg = (e as Error)?.message || String(e);
    console.log(`[ExamPool] Fatal: ${msg}`);
    if (!isFanOut) await failAndUnlock(msg);
    return json({ ok: false, error: msg }, 500);
  }
});
