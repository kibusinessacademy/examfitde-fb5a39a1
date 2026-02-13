import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const CHUNK_SIZE = 100; // Questions per invocation (Mass Production Mode)
const SHIP_TARGET = 850;  // Ship-Level: marktfähig ab 850
const IDEAL_TARGET = 1000; // Hard-Goal: iterativ auf 1000 polieren

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

  // Batch cursor from job runner (chunked generation)
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
    // Prereq: scaffold_learning_course must be done
    if (!(await prereqDone(sb, packageId, "scaffold_learning_course"))) {
      return json({ ok: false, retry: true, error: "PREREQ_NOT_DONE: scaffold_learning_course" }, 409);
    }

    // On first chunk, mark step as running
    if (generatedSoFar === 0) {
      await sb.rpc("update_course_package_step", {
        p_package_id: packageId, p_step_key: "generate_exam_pool", p_status: "running",
        p_log: { note: `Generating exam pool target=${examTarget} (chunked, ${CHUNK_SIZE}/run)` },
      });
    }

    // Get approved blueprints
    const { data: bps, error: bpErr } = await sb
      .from("question_blueprints")
      .select("id, max_variations")
      .eq("curriculum_id", curriculumId)
      .eq("status", "approved")
      .order("created_at", { ascending: true });

    if (bpErr) throw bpErr;
    if (!bps?.length) throw new Error("No approved question_blueprints for curriculum");

    // Calculate how many questions per blueprint
    const perBlueprint = Math.max(1, Math.ceil(examTarget / bps.length));

    // Process a chunk: generate for CHUNK_SIZE questions worth of blueprints
    let questionsThisChunk = 0;
    let currentBpIndex = bpIndex;
    const errors: string[] = [];

    while (questionsThisChunk < CHUNK_SIZE && currentBpIndex < bps.length) {
      const bp = bps[currentBpIndex] as { id: string; max_variations: number | null };
      const cap = typeof bp.max_variations === "number" && bp.max_variations > 0 ? bp.max_variations : perBlueprint;
      const count = Math.min(perBlueprint, cap);

      try {
        const { error } = await sb.functions.invoke("generate-blueprint-questions", {
          body: { blueprintId: bp.id, count, baseSeed: Date.now() + currentBpIndex },
        });
        if (error) {
          errors.push(`BP ${bp.id.slice(0, 8)}: ${error.message || String(error)}`);
        } else {
          questionsThisChunk += count;
        }
      } catch (e: unknown) {
        errors.push(`BP ${bp.id.slice(0, 8)}: ${(e as Error)?.message || String(e)}`);
      }
      currentBpIndex++;
    }

    // Count actual questions in DB
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

    // Update progress
    const progress = Math.min(55, Math.round(25 + (actualTotal / examTarget) * 30));
    await sb.from("course_packages").update({ build_progress: progress }).eq("id", packageId);

    if (allBlueprintsProcessed || targetReached) {
      // Done! Mark step complete
      await sb.rpc("update_course_package_step", {
        p_package_id: packageId, p_step_key: "generate_exam_pool", p_status: "done",
        p_log: {
          ok: true,
          target: examTarget,
          actual: actualTotal,
          blueprints_processed: currentBpIndex,
          blueprints_total: bps.length,
          chunk_errors: errors.length,
        },
      });
      await sb.from("course_packages").update({ build_progress: 55 }).eq("id", packageId);

      return json({
        ok: true,
        batch_complete: true,
        total_questions: actualTotal,
        target: examTarget,
        blueprints_processed: currentBpIndex,
      });
    } else {
      // More chunks needed → signal job runner to re-queue
      return json({
        ok: true,
        batch_complete: false,
        batch_cursor: {
          generated: actualTotal,
          blueprint_index: currentBpIndex,
          target: examTarget,
          blueprints_total: bps.length,
        },
        total_questions: actualTotal,
        chunk_errors: errors.length,
      });
    }
  } catch (e: unknown) {
    const msg = (e as Error)?.message || String(e);
    console.error(`[ExamPool] Error: ${msg}`);
    await failAndUnlock(msg);
    return json({ ok: false, error: msg }, 500);
  }
});
