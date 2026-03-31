import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { resolveProfession } from "../_shared/profession-resolver.ts";
import { ERROR_TAG_VOCABULARY } from "../_shared/error-tag-vocabulary.ts";
import { loadMathRatio } from "../_shared/math-ratio.ts";
import { handleDbFailure } from "../_shared/job-fail.ts";
import { enqueueJob } from "../_shared/enqueue.ts";

/**
 * pool-rework — Scheduled Batch Job: Incremental Quality Upgrades (PLANNER)
 *
 * Auth: REWORK_CRON_SECRET via x-rework-secret header (cron/runner)
 *       OR Admin JWT (manual trigger).
 *       Service Role Key is NEVER used as auth factor.
 */

const MAX_PACKAGES_PER_RUN = 5;
const MAX_CALC_BACKFILL = 50;
const MAX_DIFFICULTY_DELETE = 100;
const MAX_QC_DELETE = 100;
const MAX_TRAP_RETROFIT = 30;

const TARGET_DIFFICULTY: Record<string, number> = {
  easy: 0.10, medium: 0.45, hard: 0.35, very_hard: 0.10,
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

interface ReworkReport {
  packageId: string;
  curriculumId: string;
  profession: string;
  calcBackfill: { deficit: number; triggered: boolean };
  difficultyRebalance: { deleted: number; regenTriggered: boolean };
  qcReplace: { deleted: number; deletedIds: string[]; regenTriggered: boolean };
  trapRetrofit: { enqueued: number };
}

// ── Auth Guard ────────────────────────────────────────────────────────────────

function authenticateRequest(req: Request): { ok: boolean; needsJwtCheck: boolean; error?: string } {
  // Path 1: Dedicated cron secret (cron/runner)
  const cronSecret = Deno.env.get("REWORK_CRON_SECRET");
  const headerSecret = req.headers.get("x-rework-secret");
  if (cronSecret && headerSecret && headerSecret === cronSecret) {
    return { ok: true, needsJwtCheck: false };
  }

  // Path 2: Admin JWT (manual trigger from UI)
  const authHeader = req.headers.get("Authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.replace("Bearer ", "");
    if (token === Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) {
      return { ok: false, needsJwtCheck: false, error: "Service role key cannot be used as Bearer token" };
    }
    return { ok: true, needsJwtCheck: true };
  }

  return { ok: false, needsJwtCheck: false, error: "Missing authorization. Requires x-rework-secret or Admin JWT." };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-rework-secret",
      },
    });
  }

  // ── Auth ──
  const auth = authenticateRequest(req);
  if (!auth.ok) return json({ error: auth.error }, 401);

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // If JWT path, validate admin role
  if (auth.needsJwtCheck) {
    const authHeader = req.headers.get("Authorization")!;
    const token = authHeader.replace("Bearer ", "");
    const anonClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user }, error: userErr } = await anonClient.auth.getUser(token);
    if (userErr || !user) return json({ error: "Invalid or expired token" }, 401);
    const { data: roleRow } = await sb
      .from("user_roles").select("role")
      .eq("user_id", user.id).eq("role", "admin")
      .maybeSingle();
    if (!roleRow) return json({ error: "Admin access required" }, 403);
  }

  const body = await req.json().catch(() => ({}));
  const forcePackageId = body.package_id || null;

  // ── Find eligible packages ──
  let query = sb
    .from("course_packages")
    .select("id, curriculum_id, certification_id")
    .eq("status", "published")
    .order("updated_at", { ascending: true })
    .limit(MAX_PACKAGES_PER_RUN);

  if (forcePackageId) {
    query = sb
      .from("course_packages")
      .select("id, curriculum_id, certification_id")
      .eq("id", forcePackageId)
      .limit(1);
  }

  const { data: packages, error: pkgErr } = await query;
  if (pkgErr) return json({ error: pkgErr.message }, 500);
  if (!packages?.length) return json({ ok: true, message: "No packages to rework" });

  console.log(`[pool-rework] Starting rework for ${packages.length} package(s)`);
  const reports: ReworkReport[] = [];

  for (const pkg of packages) {
    const report: ReworkReport = {
      packageId: pkg.id,
      curriculumId: pkg.curriculum_id,
      profession: "",
      calcBackfill: { deficit: 0, triggered: false },
      difficultyRebalance: { deleted: 0, regenTriggered: false },
      qcReplace: { deleted: 0, deletedIds: [], regenTriggered: false },
      trapRetrofit: { enqueued: 0 },
    };

    let professionName: string;
    try {
      const prof = await resolveProfession(sb, {
        certificationId: pkg.certification_id,
        curriculumId: pkg.curriculum_id,
      });
      professionName = prof.professionName;
      report.profession = professionName;
    } catch {
      console.log(`[pool-rework] Skip ${pkg.id.slice(0, 8)}: profession resolve failed`);
      continue;
    }

    // ── Load math_ratio from SSOT shared module ──
    const calcRatio = await loadMathRatio(sb, professionName);
    console.log(`[pool-rework] math_ratio=${calcRatio} for "${professionName}"`);

    // ════════════════════════════════════════════════════════════════
    // DIMENSION 1: CALC QUOTA BACKFILL
    // ════════════════════════════════════════════════════════════════
    try {
      const { count: totalCount } = await sb
        .from("exam_questions")
        .select("id", { count: "exact", head: true })
        .eq("curriculum_id", pkg.curriculum_id);
      const { count: calcCount } = await sb
        .from("exam_questions")
        .select("id", { count: "exact", head: true })
        .eq("curriculum_id", pkg.curriculum_id)
        .eq("question_type", "calculation");

      const total = totalCount ?? 0;
      const calc = calcCount ?? 0;
      const deficit = Math.ceil(total * calcRatio) - calc;
      report.calcBackfill.deficit = deficit;

      if (deficit > 0) {
        const capped = Math.min(deficit, MAX_CALC_BACKFILL);
        const { error: jobErr } = await enqueueJob(sb, {
          job_type: "package_generate_exam_pool",
          package_id: pkg.id,
          payload: {
            package_id: pkg.id, curriculum_id: pkg.curriculum_id,
            certification_id: pkg.certification_id,
            rework_mode: "calc_backfill_only", calc_deficit: capped,
          },
        }).then(() => ({ error: null })).catch(e => ({ error: e as Error }));
        if (jobErr && !jobErr.message?.includes("duplicate")) {
          console.log(`[pool-rework] Calc backfill enqueue failed: ${jobErr.message}`);
        } else {
          report.calcBackfill.triggered = true;
          console.log(`[pool-rework] CALC_BACKFILL queued: deficit=${capped}/${deficit}`);
        }
      } else {
        console.log(`[pool-rework] CALC_OK: ${calc}/${total} = ${(100 * calc / Math.max(total, 1)).toFixed(1)}%`);
      }
    } catch (e) { console.log(`[pool-rework] Calc error: ${(e as Error).message}`); }

    // ════════════════════════════════════════════════════════════════
    // DIMENSION 2: DIFFICULTY RE-BALANCING (Delete surplus + Regen)
    // ════════════════════════════════════════════════════════════════
    try {
      // Load with quality-relevant fields for smart deletion
      const { data: diffDist } = await sb
        .from("exam_questions")
        .select("difficulty, id, qc_status, question_type, created_at")
        .eq("curriculum_id", pkg.curriculum_id);

      if (diffDist && diffDist.length > 0) {
        const total = diffDist.length;
        const counts: Record<string, typeof diffDist> = {};
        for (const q of diffDist) {
          const d = q.difficulty || "medium";
          if (!counts[d]) counts[d] = [];
          counts[d].push(q);
        }

        let totalDeleted = 0;
        for (const [diff, targetRatio] of Object.entries(TARGET_DIFFICULTY)) {
          const targetCount = Math.round(total * targetRatio);
          const current = counts[diff]?.length ?? 0;
          const surplus = current - targetCount;

          if (surplus > 10 && totalDeleted < MAX_DIFFICULTY_DELETE) {
            const bucket = (counts[diff] || []);
            const nonApproved = bucket.filter((x) => x.qc_status !== "approved");
            const approved = bucket.filter((x) => x.qc_status === "approved");

            // newest first within each group
            nonApproved.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
            approved.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

            const toDelete = Math.min(surplus, MAX_DIFFICULTY_DELETE - totalDeleted);
            // prefer non-approved; only delete approved if absolutely necessary (cap 10)
            const ids = [
              ...nonApproved.map((x) => x.id),
              ...approved.map((x) => x.id).slice(0, 10),
            ].slice(0, toDelete);

            for (let i = 0; i < ids.length; i += 50) {
              const { error: delErr } = await sb.from("exam_questions").delete().in("id", ids.slice(i, i + 50));
              if (delErr) {
                const r = await handleDbFailure({ supabase: sb }, delErr);
                if (r?.permanent) return json(r, 422);
              }
            }
            totalDeleted += toDelete;
            console.log(`[pool-rework] DIFF_DELETE: ${toDelete} surplus "${diff}" removed (non-approved first)`);
          }
        }

        report.difficultyRebalance.deleted = totalDeleted;
        if (totalDeleted > 0) {
          const { error: jobErr } = await sb.from("job_queue").insert({
            function_name: "package-generate-exam-pool",
            payload: {
              package_id: pkg.id, curriculum_id: pkg.curriculum_id,
              certification_id: pkg.certification_id,
              rework_mode: "difficulty_rebalance", replacement_count: totalDeleted,
            },
            status: "pending", job_type: "generate_exam_pool",
            curriculum_id: pkg.curriculum_id, package_id: pkg.id,
          });
          if (!jobErr || jobErr.message?.includes("duplicate")) report.difficultyRebalance.regenTriggered = true;
          console.log(`[pool-rework] DIFF_REGEN queued: ${totalDeleted} replacements`);
        } else {
          console.log(`[pool-rework] DIFF_OK: within tolerance`);
        }
      }
    } catch (e) { console.log(`[pool-rework] Difficulty error: ${(e as Error).message}`); }

    // ════════════════════════════════════════════════════════════════
    // DIMENSION 3: QC-FAILED REPLACEMENT (snapshot before delete)
    // ════════════════════════════════════════════════════════════════
    try {
      const { data: failedQs } = await sb
        .from("exam_questions")
        .select("id, qc_status, question_text, difficulty, question_type")
        .eq("curriculum_id", pkg.curriculum_id)
        .in("qc_status", ["tier1_failed", "needs_revision"])
        .limit(MAX_QC_DELETE);

      if (failedQs && failedQs.length > 0) {
        const ids = failedQs.map((q) => q.id);
        report.qcReplace.deletedIds = ids;

        // Snapshot before delete
        try {
          await sb.from("ops_alerts").insert({
            source: "pool-rework", severity: "info",
            message: `QC_SNAPSHOT: ${ids.length} questions to delete from pkg ${pkg.id.slice(0, 8)}`,
            payload: {
              action: "qc_delete_snapshot", package_id: pkg.id,
              questions: failedQs.map((q) => ({
                id: q.id, qc_status: q.qc_status, difficulty: q.difficulty,
                question_type: q.question_type, text_preview: q.question_text?.slice(0, 100),
              })),
            },
          });
        } catch (_e) { /* best-effort */ }

        for (let i = 0; i < ids.length; i += 50) {
          const { error: delErr } = await sb.from("exam_questions").delete().in("id", ids.slice(i, i + 50));
          if (delErr) {
            const r = await handleDbFailure({ supabase: sb }, delErr);
            if (r?.permanent) return json(r, 422);
          }
        }
        report.qcReplace.deleted = ids.length;

        const { error: jobErr } = await sb.from("job_queue").insert({
          function_name: "package-generate-exam-pool",
          payload: {
            package_id: pkg.id, curriculum_id: pkg.curriculum_id,
            certification_id: pkg.certification_id,
            rework_mode: "qc_replacement", replacement_count: ids.length, min_needed: ids.length,
          },
          status: "pending", job_type: "generate_exam_pool",
          curriculum_id: pkg.curriculum_id, package_id: pkg.id,
        });
        if (!jobErr || jobErr.message?.includes("duplicate")) report.qcReplace.regenTriggered = true;
        console.log(`[pool-rework] QC_REPLACE: deleted ${ids.length}, regen queued`);
      } else {
        console.log(`[pool-rework] QC_OK: no failed questions`);
      }
    } catch (e) { console.log(`[pool-rework] QC error: ${(e as Error).message}`); }

    // ════════════════════════════════════════════════════════════════
    // DIMENSION 4: TRAP-TAGS RETROFIT (enqueue only, NO inline LLM)
    // Vocabulary comes from shared module, NOT from payload.
    // ════════════════════════════════════════════════════════════════
    try {
      const { data: untagged } = await sb
        .from("exam_questions")
        .select("id")
        .eq("curriculum_id", pkg.curriculum_id)
        .eq("question_type", "calculation")
        .or("trap_tags.is.null,trap_tags.eq.{}")
        .limit(MAX_TRAP_RETROFIT);

      if (untagged && untagged.length > 0) {
        const { error: jobErr } = await sb.from("job_queue").insert({
          function_name: "pool-rework-trap-retrofit",
          payload: {
            package_id: pkg.id,
            curriculum_id: pkg.curriculum_id,
            certification_id: pkg.certification_id,
            question_ids: untagged.map((q) => q.id),
            profession_name: professionName,
            // NO vocabulary in payload — worker imports from SSOT module
          },
          status: "pending", job_type: "rework_trap_retrofit",
          curriculum_id: pkg.curriculum_id, package_id: pkg.id,
        });
        if (jobErr && !jobErr.message?.includes("duplicate")) {
          console.log(`[pool-rework] Trap enqueue failed: ${jobErr.message}`);
        } else {
          report.trapRetrofit.enqueued = untagged.length;
          console.log(`[pool-rework] TRAP_RETROFIT queued: ${untagged.length} questions`);
        }
      } else {
        console.log(`[pool-rework] TRAP_OK: all calc questions have trap_tags`);
      }
    } catch (e) { console.log(`[pool-rework] Trap error: ${(e as Error).message}`); }

    reports.push(report);
  }

  const summary = {
    packagesProcessed: reports.length,
    totalCalcBackfills: reports.filter((r) => r.calcBackfill.triggered).length,
    totalDiffDeleted: reports.reduce((s, r) => s + r.difficultyRebalance.deleted, 0),
    totalQcDeleted: reports.reduce((s, r) => s + r.qcReplace.deleted, 0),
    totalTrapEnqueued: reports.reduce((s, r) => s + r.trapRetrofit.enqueued, 0),
  };
  console.log(`[pool-rework] DONE: ${JSON.stringify(summary)}`);

  try {
    await sb.from("ops_alerts").insert({
      source: "pool-rework", severity: "info",
      message: `Rework: ${summary.packagesProcessed} pkgs, +${summary.totalCalcBackfills} calc, ${summary.totalDiffDeleted} diff-del, ${summary.totalQcDeleted} qc-del, ${summary.totalTrapEnqueued} trap-q`,
      payload: { summary, reports },
    });
  } catch (_e) { /* best-effort */ }

  return json({ ok: true, summary, reports });
});
