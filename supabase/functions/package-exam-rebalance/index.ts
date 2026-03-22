import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { enqueueJob } from "../_shared/enqueue.ts";

/**
 * package-exam-rebalance — Targeted exam pool repair orchestrator
 *
 * Diagnoses hard_fail_reasons from the integrity report and dispatches
 * the minimum necessary repairs:
 *
 *   A. DIFFICULTY_REBALANCE: easy_pct too high → prune weakest easy, backfill harder
 *   B. COMPETENCY_COVERAGE:  gaps in competency coverage → targeted question generation
 *   C. BLOOM_GATE:           missing bloom levels → targeted bloom backfill
 *   D. MINICHECK_REPAIR:     unparsed/empty minichecks → re-trigger minicheck generation
 *
 * After repair:
 *   1. Reset run_integrity_check step → queued
 *   2. Reset auto_publish step → queued
 *   3. Set package status → building (unblock)
 *
 * SSOT principles:
 *   - Never regenerate what's already approved and conformant
 *   - Prune excess easy questions from publish selection, don't delete
 *   - All actions are audited in auto_heal_log
 *   - Idempotent: re-running is safe
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

// ── Difficulty thresholds (from integrity check SSOT) ──
const EASY_MAX_PCT = 15;
const HARDISH_MIN_PCT = 40; // medium + hard + very_hard combined

// ── Repair action results ──
interface RepairAction {
  type: string;
  detail: string;
  affected_count: number;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const p = body.payload || body;
  const packageId = (p as Record<string, unknown>).package_id as string;

  if (!packageId) return json({ error: "package_id required" }, 400);

  try {
    // ── 1. Load package + integrity report ──
    const { data: pkg, error: pkgErr } = await sb
      .from("course_packages")
      .select("id, status, course_id, curriculum_id, integrity_passed, integrity_report, blocked_reason")
      .eq("id", packageId)
      .maybeSingle();

    if (pkgErr || !pkg) return json({ error: "Package not found" }, 404);

    // ── P0 GUARD: integrity_report must be present and fresh ──
    // If report is NULL, rebalance cannot determine hard_fail_reasons.
    // This was the root cause of the MFA ghost-block (2026-03-20).
    if (!pkg.integrity_report) {
      console.error(`[exam-rebalance] ABORT: integrity_report=NULL for ${packageId.slice(0, 8)}. Cannot diagnose. Run integrity check first.`);
      return json({
        ok: false,
        error: "INTEGRITY_REPORT_MISSING",
        message: "integrity_report is NULL. Run package-run-integrity-check with force=true first.",
        package_id: packageId,
        hard_fails: [],
        actions: [],
        unblocked: false,
      });
    }

    const report = (pkg.integrity_report as Record<string, unknown>) ?? {};
    const v3 = (report.v3 ?? {}) as Record<string, unknown>;
    const hardFails = (v3.hard_fail_reasons ?? []) as string[];

    if (hardFails.length === 0 && pkg.integrity_passed) {
      return json({ ok: true, message: "no_hard_fails", actions: [] });
    }

    console.log(`[exam-rebalance] Package ${packageId.slice(0, 8)}: ${hardFails.length} hard fails: ${hardFails.join("; ")}`);

    const actions: RepairAction[] = [];
    const curriculumId = pkg.curriculum_id as string;
    const courseId = pkg.course_id as string;

    // ── 2. Classify and execute repairs ──
    // Also check warnings for new gates
    const allWarnings = (v3.warnings ?? []) as string[];
    const allSignals = [...hardFails, ...allWarnings];

    // ═══ A. DIFFICULTY REBALANCE (EASY_TOO_HIGH → prune) ═══
    const diffFails = hardFails.filter(f =>
      f.includes("EASY_TOO_HIGH") || f.includes("HARDISH_TOO_LOW"),
    );
    if (diffFails.length > 0) {
      const result = await repairDifficulty(sb, packageId, curriculumId);
      actions.push(result);
    }

    // ═══ A2. EASY_TOO_LOW → generate more easy questions ═══
    const easyLowSignals = allSignals.filter(f => f.includes("EASY_TOO_LOW"));
    if (easyLowSignals.length > 0) {
      const result = await repairEasyDeficit(sb, packageId, curriculumId);
      actions.push(result);
    }

    // ═══ A3. TRAP_COVERAGE_LOW → enqueue trap retrofit ═══
    const trapSignals = allSignals.filter(f => f.includes("TRAP_COVERAGE_LOW"));
    if (trapSignals.length > 0) {
      const result = await repairTrapCoverage(sb, packageId, curriculumId);
      actions.push(result);
    }

    // ═══ A4. EXAM_PART_MISSING → backfill from mappings ═══
    const examPartSignals = allSignals.filter(f => f.includes("EXAM_PART_MISSING"));
    if (examPartSignals.length > 0) {
      const result = await repairExamPartMapping(sb, packageId, curriculumId);
      actions.push(result);
    }

    // ═══ B. BLOOM GATE ═══
    const bloomFails = hardFails.filter(f =>
      f.includes("BLOOM_GATE") || f.includes("MISSING_UNDERSTAND") ||
      f.includes("MISSING_APPLY") || f.includes("MISSING_ANALYZE") ||
      f.includes("ONLY_1_LEVELS") || f.includes("APPLY_TOO_LOW") ||
      f.includes("ANALYZE_TOO_LOW"),
    );
    if (bloomFails.length > 0) {
      const result = await repairBloomGaps(sb, packageId, curriculumId);
      actions.push(result);
    }

    // ═══ C. COMPETENCY COVERAGE ═══
    const compFails = hardFails.filter(f => f.includes("COMPETENCY_COVERAGE"));
    if (compFails.length > 0) {
      const result = await repairCompetencyCoverage(sb, packageId, curriculumId);
      actions.push(result);
    }

    // ═══ D. MINICHECK REPAIR ═══
    const mcFails = hardFails.filter(f => f.includes("MINICHECK_UNPARSED"));
    if (mcFails.length > 0) {
      const result = await repairMinichecks(sb, packageId, courseId);
      actions.push(result);
    }

    // ── 3. Unblock package + reset pipeline tail ──
    if (actions.length > 0) {
      // Reset package to building
      await sb.from("course_packages").update({
        status: "building",
        blocked_reason: null,
        stuck_reason: null,
        integrity_passed: false, // will be re-evaluated
      }).eq("id", packageId);

      // Reset integrity check + auto_publish steps
      for (const stepKey of ["run_integrity_check", "auto_publish"]) {
        await sb.from("package_steps").update({
          status: "queued",
          attempts: 0,
          started_at: null,
          finished_at: null,
          last_error: `exam-rebalance: reset after ${actions.length} repair actions`,
        }).eq("package_id", packageId).eq("step_key", stepKey);
      }

      // Also reset quality_council if bloom/difficulty changed significantly
      if (diffFails.length > 0 || bloomFails.length > 0) {
        await sb.from("package_steps").update({
          status: "queued",
          attempts: 0,
          started_at: null,
          finished_at: null,
          last_error: "exam-rebalance: re-validate after pool changes",
        }).eq("package_id", packageId).eq("step_key", "quality_council");

        // Also reset elite_harden to re-annotate
        await sb.from("package_steps").update({
          status: "queued",
          attempts: 0,
          started_at: null,
          finished_at: null,
          last_error: "exam-rebalance: re-harden after pool changes",
        }).eq("package_id", packageId).eq("step_key", "elite_harden");
      }

      // Enqueue bloom gap fill if needed (existing worker)
      if (bloomFails.length > 0 || compFails.length > 0) {
        try {
          await enqueueJob(sb, {
            job_type: "pool_fill_bloom_gaps",
            package_id: packageId,
            payload: {
              package_id: packageId,
              curriculum_id: curriculumId,
            },
            priority: 15,
            max_attempts: 3,
          });
        } catch (e) {
          console.warn(`[exam-rebalance] Failed to enqueue bloom gap fill: ${(e as Error).message}`);
        }
      }

      // Audit
      await sb.from("auto_heal_log").insert({
        action_type: "exam_rebalance",
        trigger_source: "package-exam-rebalance",
        target_type: "course_packages",
        target_id: packageId,
        result_status: "applied",
        result_detail: `${actions.length} repair actions: ${actions.map(a => a.type).join(", ")}`,
        metadata: {
          hard_fails: hardFails,
          actions,
          curriculum_id: curriculumId,
        },
      });

      // Admin notification
      await sb.from("admin_notifications").insert({
        title: `🔧 Exam-Rebalance: ${actions.length} Reparaturen`,
        body: `Package ${packageId.slice(0, 8)}: ${actions.map(a => `${a.type} (${a.affected_count})`).join(", ")}. Pipeline neu gestartet.`,
        category: "pipeline",
        severity: "info",
        entity_type: "package",
        entity_id: packageId,
        metadata: { actions, hard_fails: hardFails },
      });
    }

    console.log(`[exam-rebalance] Completed: ${actions.length} repair actions for ${packageId.slice(0, 8)}`);

    return json({
      ok: true,
      package_id: packageId,
      hard_fails: hardFails,
      actions,
      unblocked: actions.length > 0,
    });
  } catch (e: unknown) {
    const msg = (e as Error)?.message || String(e);
    console.error(`[exam-rebalance] Error: ${msg}`);
    return json({ ok: false, error: msg }, 500);
  }
});

// ═══════════════════════════════════════════════════════════════
// REPAIR STRATEGIES
// ═══════════════════════════════════════════════════════════════

/**
 * A. Difficulty Rebalance
 * - Identify excess easy questions
 * - Demote weakest easy → rejected (not deleted)
 * - This shifts the distribution ratio without needing new questions
 */
async function repairDifficulty(
  sb: ReturnType<typeof createClient>,
  packageId: string,
  curriculumId: string,
): Promise<RepairAction> {
  // Count current distribution
  const { data: dist } = await sb
    .from("exam_questions")
    .select("difficulty")
    .eq("curriculum_id", curriculumId)
    .in("qc_status", ["approved", "tier1_passed"]);

  if (!dist || dist.length === 0) {
    return { type: "difficulty_rebalance", detail: "no_approved_questions", affected_count: 0 };
  }

  const total = dist.length;
  const easyCnt = dist.filter((q: any) => q.difficulty === "easy").length;
  const easyPct = (easyCnt / total) * 100;

  if (easyPct <= EASY_MAX_PCT) {
    return { type: "difficulty_rebalance", detail: `easy_pct=${easyPct.toFixed(1)}% already OK`, affected_count: 0 };
  }

  // Calculate how many easy questions to demote
  const targetEasy = Math.floor(total * (EASY_MAX_PCT / 100));
  const toRemove = easyCnt - targetEasy;

  if (toRemove <= 0) {
    return { type: "difficulty_rebalance", detail: "no_excess", affected_count: 0 };
  }

  // Find the weakest easy questions (lowest quality_score, oldest first)
  const { data: weakest } = await sb
    .from("exam_questions")
    .select("id")
    .eq("curriculum_id", curriculumId)
    .eq("difficulty", "easy")
    .in("qc_status", ["approved", "tier1_passed"])
    .order("quality_score", { ascending: true, nullsFirst: true })
    .order("created_at", { ascending: true })
    .limit(toRemove);

  if (!weakest || weakest.length === 0) {
    return { type: "difficulty_rebalance", detail: "no_candidates", affected_count: 0 };
  }

  const ids = weakest.map((q: any) => q.id);

  // Demote: set qc_status to 'rejected' with reason
  const { error: upErr } = await sb
    .from("exam_questions")
    .update({
      qc_status: "rejected",
      status: "rejected",
      meta: {
        rejected_reason: "exam_rebalance_difficulty_pruning",
        rejected_at: new Date().toISOString(),
        original_qc_status: "approved",
      },
    })
    .in("id", ids);

  if (upErr) {
    console.error(`[exam-rebalance] Difficulty prune error: ${upErr.message}`);
    return { type: "difficulty_rebalance", detail: `error: ${upErr.message}`, affected_count: 0 };
  }

  const newEasyPct = ((easyCnt - ids.length) / (total)) * 100;
  console.log(`[exam-rebalance] Pruned ${ids.length} easy questions: ${easyPct.toFixed(1)}% → ${newEasyPct.toFixed(1)}%`);

  return {
    type: "difficulty_rebalance",
    detail: `Pruned ${ids.length} weakest easy questions (${easyPct.toFixed(1)}% → ${newEasyPct.toFixed(1)}%)`,
    affected_count: ids.length,
  };
}

/**
 * B. Bloom Gap Repair
 * - Triggers the existing pool-fill-bloom-gaps worker
 * - Also applies heuristic reclassification for borderline questions
 */
async function repairBloomGaps(
  sb: ReturnType<typeof createClient>,
  _packageId: string,
  curriculumId: string,
): Promise<RepairAction> {
  // Apply heuristic reclassification first (cheaper than AI generation)
  let reclassified = 0;

  // Reclassify remember → understand for questions with explanation keywords
  const understandKeywords = ["warum", "erklär", "unterschied", "prinzip", "zusammenhang", "bedeutung", "zweck", "funktion", "begründ"];
  const { data: rememberQs } = await sb
    .from("exam_questions")
    .select("id, question_text, explanation")
    .eq("curriculum_id", curriculumId)
    .eq("cognitive_level", "remember")
    .in("qc_status", ["approved", "tier1_passed"])
    .limit(200);

  const toReclassifyUnderstand: string[] = [];
  for (const q of rememberQs || []) {
    const text = `${q.question_text} ${q.explanation || ""}`.toLowerCase();
    if (understandKeywords.some(kw => text.includes(kw))) {
      toReclassifyUnderstand.push(q.id);
    }
  }

  if (toReclassifyUnderstand.length > 0) {
    await sb.from("exam_questions")
      .update({ cognitive_level: "understand" })
      .in("id", toReclassifyUnderstand);
    reclassified += toReclassifyUnderstand.length;
  }

  // Reclassify easy → medium for questions with calculation or strategic context
  const mediumKeywords = ["berechne", "ermittle", "kalkulier", "entscheidung", "empfehlung", "welche maßnahme", "strategi"];
  const { data: easyQs } = await sb
    .from("exam_questions")
    .select("id, question_text")
    .eq("curriculum_id", curriculumId)
    .eq("difficulty", "easy")
    .in("qc_status", ["approved", "tier1_passed"])
    .limit(200);

  const toReclassifyMedium: string[] = [];
  for (const q of easyQs || []) {
    const text = (q.question_text || "").toLowerCase();
    if (mediumKeywords.some(kw => text.includes(kw))) {
      toReclassifyMedium.push(q.id);
    }
  }

  if (toReclassifyMedium.length > 0) {
    await sb.from("exam_questions")
      .update({ difficulty: "medium" })
      .in("id", toReclassifyMedium);
    reclassified += toReclassifyMedium.length;
  }

  console.log(`[exam-rebalance] Bloom heuristic reclassification: ${reclassified} questions adjusted`);

  return {
    type: "bloom_repair",
    detail: `Reclassified ${toReclassifyUnderstand.length} remember→understand, ${toReclassifyMedium.length} easy→medium. Pool-fill-bloom-gaps enqueued for AI backfill.`,
    affected_count: reclassified,
  };
}

/**
 * C. Competency Coverage Repair
 * - Identifies competencies with 0 exam questions
 * - Enqueues pool-fill-bloom-gaps which handles competency gaps
 */
async function repairCompetencyCoverage(
  sb: ReturnType<typeof createClient>,
  _packageId: string,
  curriculumId: string,
): Promise<RepairAction> {
  // Find competencies without questions
  const { data: report, error: rpcErr } = await sb.rpc(
    "get_exam_pool_gap_report",
    { p_curriculum_id: curriculumId },
  );

  if (rpcErr || !report) {
    return { type: "competency_coverage", detail: `rpc_error: ${rpcErr?.message}`, affected_count: 0 };
  }

  const compGaps = ((report as Record<string, unknown>).competency_gaps as Array<{ competency_id: string; approved_count: number }>) || [];
  const missing = compGaps.filter(c => c.approved_count < 3);

  console.log(`[exam-rebalance] Competency coverage: ${missing.length} competencies below threshold`);

  return {
    type: "competency_coverage",
    detail: `${missing.length} competencies below threshold. Pool-fill-bloom-gaps will generate targeted questions.`,
    affected_count: missing.length,
  };
}

/**
 * D. MiniCheck Repair
 * - Resets minicheck step to re-generate for lessons with unparsed/empty minichecks
 */
async function repairMinichecks(
  sb: ReturnType<typeof createClient>,
  packageId: string,
  courseId: string,
): Promise<RepairAction> {
  // Find lessons with unparsed or empty minichecks
  const { data: lessons } = await sb
    .from("lessons")
    .select("id, minicheck_parsed")
    .eq("course_id", courseId)
    .or("minicheck_parsed.is.null,minicheck_parsed.eq.false");

  if (!lessons || lessons.length === 0) {
    return { type: "minicheck_repair", detail: "no_unparsed_minichecks", affected_count: 0 };
  }

  // Reset the minicheck generation step
  await sb.from("package_steps").update({
    status: "queued",
    attempts: 0,
    started_at: null,
    finished_at: null,
    last_error: `exam-rebalance: ${lessons.length} unparsed minichecks need regeneration`,
  }).eq("package_id", packageId).eq("step_key", "generate_lesson_minichecks");

  // Also reset validation
  await sb.from("package_steps").update({
    status: "queued",
    attempts: 0,
    started_at: null,
    finished_at: null,
  }).eq("package_id", packageId).eq("step_key", "validate_lesson_minichecks");

  console.log(`[exam-rebalance] Reset minicheck generation for ${lessons.length} lessons`);

  return {
    type: "minicheck_repair",
    detail: `Reset minicheck generation for ${lessons.length} unparsed lessons`,
    affected_count: lessons.length,
  };
}

// ═══════════════════════════════════════════════════════════════
// NEW REPAIR STRATEGIES (Fix 1, 2, 3)
// ═══════════════════════════════════════════════════════════════

/**
 * A2. Easy Deficit Repair (Fix 1)
 * - When easy_pct < 5%, generate new easy questions from blueprints
 * - Uses existing blueprint infrastructure
 */
async function repairEasyDeficit(
  sb: ReturnType<typeof createClient>,
  packageId: string,
  curriculumId: string,
): Promise<RepairAction> {
  // Count current distribution
  const { data: dist } = await sb
    .from("exam_questions")
    .select("difficulty")
    .eq("curriculum_id", curriculumId)
    .in("qc_status", ["approved", "tier1_passed"]);

  if (!dist || dist.length === 0) {
    return { type: "easy_deficit_repair", detail: "no_approved_questions", affected_count: 0 };
  }

  const total = dist.length;
  const easyCnt = dist.filter((q: any) => q.difficulty === "easy").length;
  const easyPct = (easyCnt / total) * 100;

  // Load target from difficulty_distribution_targets
  const { data: target } = await sb
    .from("difficulty_distribution_targets")
    .select("target_pct")
    .eq("difficulty", "easy")
    .eq("track", "AUSBILDUNG_VOLL")
    .maybeSingle();
  
  const targetPct = (target?.target_pct as number) ?? 10;

  if (easyPct >= targetPct) {
    return { type: "easy_deficit_repair", detail: `easy_pct=${easyPct.toFixed(1)}% already at target`, affected_count: 0 };
  }

  // Calculate how many easy questions we need
  const targetEasyCount = Math.ceil(total * (targetPct / 100));
  const deficit = targetEasyCount - easyCnt;

  if (deficit <= 0) {
    return { type: "easy_deficit_repair", detail: "no_deficit", affected_count: 0 };
  }

  // Strategy 1: Reclassify medium questions with simple remember patterns as easy
  const simpleKeywords = ["nenne", "was ist", "welcher", "definiere", "wie heißt", "wofür steht", "was bedeutet", "wo befindet"];
  const { data: mediumQs } = await sb
    .from("exam_questions")
    .select("id, question_text, cognitive_level")
    .eq("curriculum_id", curriculumId)
    .eq("difficulty", "medium")
    .in("qc_status", ["approved", "tier1_passed"])
    .limit(200);

  const toReclassify: string[] = [];
  for (const q of mediumQs || []) {
    if (toReclassify.length >= Math.ceil(deficit * 0.6)) break; // max 60% from reclassification
    const text = (q.question_text || "").toLowerCase();
    const cl = (q.cognitive_level || "").toLowerCase();
    if (cl === "remember" || simpleKeywords.some(kw => text.includes(kw))) {
      toReclassify.push(q.id);
    }
  }

  let reclassified = 0;
  if (toReclassify.length > 0) {
    await sb.from("exam_questions")
      .update({ difficulty: "easy" })
      .in("id", toReclassify);
    reclassified = toReclassify.length;
  }

  // Strategy 2: Enqueue generation of new easy questions from blueprints
  const remainingDeficit = deficit - reclassified;
  if (remainingDeficit > 0) {
    try {
      await enqueueJob(sb, {
        job_type: "pool_fill_bloom_gaps",
        package_id: packageId,
        payload: {
          package_id: packageId,
          curriculum_id: curriculumId,
          target_difficulty: "easy",
          target_count: remainingDeficit,
          source: "easy_deficit_repair",
        },
        priority: 15,
        max_attempts: 3,
      });
    } catch (e) {
      console.warn(`[exam-rebalance] Failed to enqueue easy backfill: ${(e as Error).message}`);
    }
  }

  const newEasyPct = ((easyCnt + reclassified) / total) * 100;
  console.log(`[exam-rebalance] Easy deficit repair: reclassified=${reclassified}, enqueued=${remainingDeficit}, ${easyPct.toFixed(1)}% → ${newEasyPct.toFixed(1)}%`);

  return {
    type: "easy_deficit_repair",
    detail: `Reclassified ${reclassified} medium→easy, enqueued ${remainingDeficit} new easy questions. (${easyPct.toFixed(1)}% → ~${targetPct}%)`,
    affected_count: reclassified + remainingDeficit,
  };
}

/**
 * A3. Trap Coverage Repair (Fix 3)
 * - Identifies questions without trap classification
 * - Enqueues trap-retrofit worker for batch analysis
 */
async function repairTrapCoverage(
  sb: ReturnType<typeof createClient>,
  packageId: string,
  curriculumId: string,
): Promise<RepairAction> {
  // Find approved questions without trap_type
  const { data: untagged } = await sb
    .from("exam_questions")
    .select("id")
    .eq("curriculum_id", curriculumId)
    .in("qc_status", ["approved", "tier1_passed"])
    .is("trap_type", null)
    .limit(500);

  if (!untagged || untagged.length === 0) {
    return { type: "trap_coverage_repair", detail: "all_questions_have_trap_type", affected_count: 0 };
  }

  // Enqueue trap retrofit in batches of 50
  const batchSize = 50;
  let enqueued = 0;
  for (let i = 0; i < Math.min(untagged.length, 200); i += batchSize) {
    const batch = untagged.slice(i, i + batchSize).map((q: any) => q.id);
    try {
      await enqueueJob(sb, {
        job_type: "pool_rework_trap_retrofit",
        package_id: packageId,
        payload: {
          question_ids: batch,
          curriculum_id: curriculumId,
          source: "trap_coverage_repair",
        },
        priority: 20,
        max_attempts: 2,
      });
      enqueued += batch.length;
    } catch (e) {
      console.warn(`[exam-rebalance] Failed to enqueue trap retrofit batch: ${(e as Error).message}`);
      break;
    }
  }

  console.log(`[exam-rebalance] Trap coverage repair: ${untagged.length} untagged, ${enqueued} enqueued for retrofit`);

  return {
    type: "trap_coverage_repair",
    detail: `${untagged.length} questions without trap_type. Enqueued ${enqueued} for AI trap analysis.`,
    affected_count: enqueued,
  };
}

/**
 * A4. Exam-Part Mapping Repair (Fix 2)
 * - Backfills exam_part from exam_part_mappings table
 * - Uses learning_field_id chain to propagate
 */
async function repairExamPartMapping(
  sb: ReturnType<typeof createClient>,
  _packageId: string,
  curriculumId: string,
): Promise<RepairAction> {
  // Load mappings for this curriculum
  const { data: mappings } = await sb
    .from("exam_part_mappings")
    .select("learning_field_id, exam_part, exam_weight")
    .eq("curriculum_id", curriculumId);

  if (!mappings || mappings.length === 0) {
    return {
      type: "exam_part_mapping",
      detail: "no_mappings_configured — add exam_part_mappings for this curriculum first",
      affected_count: 0,
    };
  }

  let updated = 0;
  for (const mapping of mappings) {
    // Direct match: question has this learning_field_id
    const { data: directQs } = await sb
      .from("exam_questions")
      .select("id")
      .eq("curriculum_id", curriculumId)
      .eq("learning_field_id", mapping.learning_field_id)
      .is("exam_part", null)
      .in("qc_status", ["approved", "tier1_passed"])
      .limit(500);

    if (directQs && directQs.length > 0) {
      const ids = directQs.map((q: any) => q.id);
      await sb.from("exam_questions")
        .update({ exam_part: mapping.exam_part, exam_weight: mapping.exam_weight })
        .in("id", ids);
      updated += ids.length;
    }

    // Indirect match: question has competency_id whose learning_field_id matches
    const { data: compIds } = await sb
      .from("competencies")
      .select("id")
      .eq("learning_field_id", mapping.learning_field_id);

    if (compIds && compIds.length > 0) {
      const cIds = compIds.map((c: any) => c.id);
      for (let i = 0; i < cIds.length; i += 50) {
        const chunk = cIds.slice(i, i + 50);
        const { data: indirectQs } = await sb
          .from("exam_questions")
          .select("id")
          .eq("curriculum_id", curriculumId)
          .in("competency_id", chunk)
          .is("exam_part", null)
          .in("qc_status", ["approved", "tier1_passed"])
          .limit(200);

        if (indirectQs && indirectQs.length > 0) {
          const ids = indirectQs.map((q: any) => q.id);
          await sb.from("exam_questions")
            .update({ exam_part: mapping.exam_part, exam_weight: mapping.exam_weight })
            .in("id", ids);
          updated += ids.length;
        }
      }
    }
  }

  console.log(`[exam-rebalance] Exam-part mapping: ${updated} questions updated from ${mappings.length} mappings`);

  return {
    type: "exam_part_mapping",
    detail: `Propagated exam_part to ${updated} questions from ${mappings.length} LF mappings`,
    affected_count: updated,
  };
}
