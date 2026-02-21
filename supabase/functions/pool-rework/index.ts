import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { resolveProfession } from "../_shared/profession-resolver.ts";
import { ERROR_TAG_VOCABULARY } from "../_shared/error-tag-vocabulary.ts";

/**
 * pool-rework — Scheduled Batch Job: Incremental Quality Upgrades
 *
 * PLANNER ONLY — this function checks KPIs and enqueues worker jobs.
 * It does NOT run LLM calls or long operations inline.
 *
 * Four rework dimensions:
 *   1. CALC_QUOTA  — Backfill calculation questions to hit math_ratio target
 *   2. DIFFICULTY  — Delete surplus-difficulty questions + enqueue regen (no blind relabel)
 *   3. QC_REPLACE  — Snapshot + delete tier1_failed/needs_revision, trigger regen
 *   4. TRAP_TAGS   — Enqueue retrofit jobs (no inline LLM)
 *
 * Auth: Requires Admin JWT OR x-job-runner-key matching SERVICE_ROLE_KEY.
 */

const MAX_PACKAGES_PER_RUN = 5;
const MAX_CALC_BACKFILL = 50;
const MAX_DIFFICULTY_DELETE = 100;
const MAX_QC_DELETE = 100;
const MAX_TRAP_RETROFIT = 30;

const TARGET_DIFFICULTY: Record<string, number> = {
  easy: 0.25, medium: 0.35, hard: 0.25, very_hard: 0.15,
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

function authenticateRequest(req: Request): { ok: boolean; error?: string } {
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // Path 1: Internal cron / job-runner with shared secret
  const jobRunnerKey = req.headers.get("x-job-runner-key");
  if (jobRunnerKey && jobRunnerKey === serviceKey) {
    return { ok: true };
  }

  // Path 2: Admin JWT (validated downstream via validateAuth)
  const authHeader = req.headers.get("Authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.replace("Bearer ", "");
    // Block service role key used as Bearer token
    if (token === serviceKey) {
      return { ok: false, error: "Service role key cannot be used as Bearer token" };
    }
    // Token will be validated below in the handler
    return { ok: true };
  }

  return { ok: false, error: "Missing authorization. Requires Admin JWT or x-job-runner-key." };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-job-runner-key",
      },
    });
  }

  // ── Auth check ──
  const auth = authenticateRequest(req);
  if (!auth.ok) {
    return json({ error: auth.error }, 401);
  }

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // If Bearer token (not job-runner), validate admin role
  const jobRunnerKey = req.headers.get("x-job-runner-key");
  const isJobRunner = jobRunnerKey && jobRunnerKey === Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  if (!isJobRunner) {
    const authHeader = req.headers.get("Authorization")!;
    const token = authHeader.replace("Bearer ", "");
    const anonClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user }, error: userErr } = await anonClient.auth.getUser(token);
    if (userErr || !user) {
      return json({ error: "Invalid or expired token" }, 401);
    }
    const { data: roleRow } = await sb
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .eq("role", "admin")
      .maybeSingle();
    if (!roleRow) {
      return json({ error: "Admin access required" }, 403);
    }
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

    // ── Load math_ratio from certification_catalog (SSOT) ──
    let calcRatio = 0.20; // fallback
    try {
      const searchName = professionName.split("/")[0].trim();
      const { data: catRow } = await sb
        .from("certification_catalog")
        .select("math_ratio")
        .ilike("title", `%${searchName}%`)
        .limit(1)
        .maybeSingle();
      if (catRow?.math_ratio && catRow.math_ratio > 0) {
        calcRatio = catRow.math_ratio;
        console.log(`[pool-rework] math_ratio from catalog: ${calcRatio} for "${searchName}"`);
      } else {
        console.log(`[pool-rework] No catalog match for "${searchName}", using default ${calcRatio}`);
      }
    } catch (e) {
      console.log(`[pool-rework] catalog lookup error: ${(e as Error).message}`);
    }

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
      const calcTarget = Math.ceil(total * calcRatio);
      const deficit = calcTarget - calc;

      report.calcBackfill.deficit = deficit;

      if (deficit > 0) {
        const cappedDeficit = Math.min(deficit, MAX_CALC_BACKFILL);
        const { error: jobErr } = await sb.from("job_queue").insert({
          function_name: "package-generate-exam-pool",
          payload: {
            package_id: pkg.id,
            curriculum_id: pkg.curriculum_id,
            certification_id: pkg.certification_id,
            rework_mode: "calc_backfill_only",
            calc_deficit: cappedDeficit,
          },
          status: "pending",
          job_type: "generate_exam_pool",
          curriculum_id: pkg.curriculum_id,
          package_id: pkg.id,
        });

        if (jobErr && !jobErr.message?.includes("duplicate")) {
          console.log(`[pool-rework] Calc backfill job enqueue failed: ${jobErr.message}`);
        } else {
          report.calcBackfill.triggered = true;
          console.log(`[pool-rework] CALC_BACKFILL queued: deficit=${cappedDeficit}/${deficit}`);
        }
      } else {
        console.log(`[pool-rework] CALC_OK: ${calc}/${total} = ${(100 * calc / Math.max(total, 1)).toFixed(1)}%`);
      }
    } catch (e) {
      console.log(`[pool-rework] Calc check error: ${(e as Error).message}`);
    }

    // ════════════════════════════════════════════════════════════════
    // DIMENSION 2: DIFFICULTY RE-BALANCING (Delete + Regen, NOT relabel)
    // ════════════════════════════════════════════════════════════════
    try {
      const { data: diffDist } = await sb
        .from("exam_questions")
        .select("difficulty, id")
        .eq("curriculum_id", pkg.curriculum_id);

      if (diffDist && diffDist.length > 0) {
        const total = diffDist.length;
        const counts: Record<string, string[]> = {};
        for (const q of diffDist) {
          const d = q.difficulty || "medium";
          if (!counts[d]) counts[d] = [];
          counts[d].push(q.id);
        }

        let totalDeleted = 0;

        for (const [diff, targetRatio] of Object.entries(TARGET_DIFFICULTY)) {
          const targetCount = Math.round(total * targetRatio);
          const current = counts[diff]?.length ?? 0;
          const surplus = current - targetCount;

          if (surplus > 10 && totalDeleted < MAX_DIFFICULTY_DELETE) {
            const toDelete = Math.min(surplus, MAX_DIFFICULTY_DELETE - totalDeleted);
            // Delete surplus questions (from the end of the list, least recently created)
            const ids = counts[diff]!.slice(-toDelete);

            for (let i = 0; i < ids.length; i += 50) {
              const chunk = ids.slice(i, i + 50);
              await sb.from("exam_questions").delete().in("id", chunk);
            }

            totalDeleted += toDelete;
            console.log(`[pool-rework] DIFF_DELETE: ${toDelete} surplus "${diff}" questions removed`);
          }
        }

        report.difficultyRebalance.deleted = totalDeleted;

        if (totalDeleted > 0) {
          // Enqueue regen to fill the gap with correct difficulty distribution
          const { error: jobErr } = await sb.from("job_queue").insert({
            function_name: "package-generate-exam-pool",
            payload: {
              package_id: pkg.id,
              curriculum_id: pkg.curriculum_id,
              certification_id: pkg.certification_id,
              rework_mode: "difficulty_rebalance",
              replacement_count: totalDeleted,
            },
            status: "pending",
            job_type: "generate_exam_pool",
            curriculum_id: pkg.curriculum_id,
            package_id: pkg.id,
          });
          if (!jobErr || jobErr.message?.includes("duplicate")) {
            report.difficultyRebalance.regenTriggered = true;
          }
          console.log(`[pool-rework] DIFF_REGEN queued: ${totalDeleted} replacements needed`);
        } else {
          console.log(`[pool-rework] DIFF_OK: distribution within tolerance`);
        }
      }
    } catch (e) {
      console.log(`[pool-rework] Difficulty rebalance error: ${(e as Error).message}`);
    }

    // ════════════════════════════════════════════════════════════════
    // DIMENSION 3: QC-FAILED REPLACEMENT (with snapshot)
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

        // Snapshot before delete for auditability
        report.qcReplace.deletedIds = ids;
        await sb.from("ops_alerts").insert({
          source: "pool-rework",
          severity: "info",
          message: `QC_SNAPSHOT: ${ids.length} questions to be deleted from pkg ${pkg.id.slice(0, 8)}`,
          payload: {
            action: "qc_delete_snapshot",
            package_id: pkg.id,
            questions: failedQs.map((q) => ({
              id: q.id,
              qc_status: q.qc_status,
              difficulty: q.difficulty,
              question_type: q.question_type,
              text_preview: q.question_text?.slice(0, 100),
            })),
          },
        }).then(() => {}).catch(() => {});

        // Delete in chunks
        for (let i = 0; i < ids.length; i += 50) {
          const chunk = ids.slice(i, i + 50);
          await sb.from("exam_questions").delete().in("id", chunk);
        }
        report.qcReplace.deleted = ids.length;

        // Trigger regen with min_needed
        const { error: jobErr } = await sb.from("job_queue").insert({
          function_name: "package-generate-exam-pool",
          payload: {
            package_id: pkg.id,
            curriculum_id: pkg.curriculum_id,
            certification_id: pkg.certification_id,
            rework_mode: "qc_replacement",
            replacement_count: ids.length,
            min_needed: ids.length, // regen must produce at least this many
          },
          status: "pending",
          job_type: "generate_exam_pool",
          curriculum_id: pkg.curriculum_id,
          package_id: pkg.id,
        });

        if (!jobErr || jobErr.message?.includes("duplicate")) {
          report.qcReplace.regenTriggered = true;
        }

        console.log(`[pool-rework] QC_REPLACE: deleted ${ids.length}, regen queued`);
      } else {
        console.log(`[pool-rework] QC_OK: no failed questions`);
      }
    } catch (e) {
      console.log(`[pool-rework] QC replace error: ${(e as Error).message}`);
    }

    // ════════════════════════════════════════════════════════════════
    // DIMENSION 4: TRAP-TAGS RETROFIT (Job Queue, NO inline LLM)
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
        // Enqueue a single job for batch trap-tag retrofit
        const { error: jobErr } = await sb.from("job_queue").insert({
          function_name: "pool-rework-trap-retrofit",
          payload: {
            package_id: pkg.id,
            curriculum_id: pkg.curriculum_id,
            certification_id: pkg.certification_id,
            question_ids: untagged.map((q) => q.id),
            error_tag_vocabulary: [...ERROR_TAG_VOCABULARY], // SSOT vocabulary
            profession_name: professionName,
          },
          status: "pending",
          job_type: "rework_trap_retrofit",
          curriculum_id: pkg.curriculum_id,
          package_id: pkg.id,
        });

        if (jobErr && !jobErr.message?.includes("duplicate")) {
          console.log(`[pool-rework] Trap retrofit job enqueue failed: ${jobErr.message}`);
        } else {
          report.trapRetrofit.enqueued = untagged.length;
          console.log(`[pool-rework] TRAP_RETROFIT queued: ${untagged.length} questions`);
        }
      } else {
        console.log(`[pool-rework] TRAP_OK: all calc questions have trap_tags`);
      }
    } catch (e) {
      console.log(`[pool-rework] Trap retrofit error: ${(e as Error).message}`);
    }

    reports.push(report);
  }

  // ── Summary ──
  const summary = {
    packagesProcessed: reports.length,
    totalCalcBackfills: reports.filter((r) => r.calcBackfill.triggered).length,
    totalDiffDeleted: reports.reduce((s, r) => s + r.difficultyRebalance.deleted, 0),
    totalQcDeleted: reports.reduce((s, r) => s + r.qcReplace.deleted, 0),
    totalTrapEnqueued: reports.reduce((s, r) => s + r.trapRetrofit.enqueued, 0),
  };

  console.log(`[pool-rework] DONE: ${JSON.stringify(summary)}`);

  await sb.from("ops_alerts").insert({
    source: "pool-rework",
    severity: "info",
    message: `Rework: ${summary.packagesProcessed} pkgs, +${summary.totalCalcBackfills} calc-jobs, ${summary.totalDiffDeleted} diff-deleted, ${summary.totalQcDeleted} qc-deleted, ${summary.totalTrapEnqueued} trap-queued`,
    payload: { summary, reports },
  }).then(() => {}).catch(() => {});

  return json({ ok: true, summary, reports });
});
