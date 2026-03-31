import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// ── Guardrail Constants ──────────────────────────────────────
const DAILY_BUDGET_LIMIT_EUR = 15.0;
const REGRESSION_FREEZE_THRESHOLD = 0; // score must improve by > this

function json(body: unknown, status = 200, origin?: string | null) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...getCorsHeaders(origin), "Content-Type": "application/json" },
  });
}

interface GapPlan {
  round: number;
  actions: Array<{ job_type: string; count: number; scope: string; payload_extra?: Record<string, unknown> }>;
  estimated_jobs: number;
}

Deno.serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req);
  if (corsResponse) return corsResponse;
  const origin = req.headers.get("origin");

  if (req.method !== "POST") return json({ error: "POST only" }, 405, origin);

  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const body = await req.json().catch(() => ({}));
  const p = body.payload || body;

  const packageId = p.package_id;
  const curriculumId = p.curriculum_id;
  const courseId = p.course_id;
  const targetScore = p.target_score || 85;
  const maxRounds = p.max_rounds || 3;
  const budgetEur = p.budget_eur || 2.0;
  const dryRun = p.dry_run === true;
  const autofixRunId = p.autofix_run_id; // if continuing an existing run

  if (!packageId || !curriculumId) {
    return json({ error: "package_id and curriculum_id required" }, 400, origin);
  }

  try {
    // ═══════════════════════════════════════════════════════════
    // GUARDRAIL A: Budget Circuit-Breaker (€15/day across all runs)
    // ═══════════════════════════════════════════════════════════
    const dailyCost = await getDailyAutofixCost(sb);
    if (dailyCost >= DAILY_BUDGET_LIMIT_EUR) {
      console.warn(`[AutoGap] CIRCUIT BREAKER: Daily cost €${dailyCost.toFixed(2)} >= limit €${DAILY_BUDGET_LIMIT_EUR}`);
      
      await alertAdmin(sb, {
        title: `🚨 Budget Circuit-Breaker ausgelöst: €${dailyCost.toFixed(2)}/Tag`,
        body: `Auto-Gap-Closer wurde gestoppt. Tagesbudget von €${DAILY_BUDGET_LIMIT_EUR} überschritten.\n\nBetroffenes Paket: ${packageId}`,
        severity: "critical",
        category: "circuit_breaker",
      });

      // Stop any running autofix for this package
      if (autofixRunId) {
        await sb.from("autofix_runs").update({
          status: "stopped",
        stop_reason: `Budget Circuit-Breaker: €${dailyCost.toFixed(2)} today >= €${DAILY_BUDGET_LIMIT_EUR} limit`,
        stop_reason_code: "CIRCUIT_BREAKER",
      }).eq("id", autofixRunId);
      }

      return json({
        ok: false,
        status: "circuit_breaker",
        reason: `Daily autofix cost €${dailyCost.toFixed(2)} exceeds €${DAILY_BUDGET_LIMIT_EUR} limit`,
        daily_cost_eur: dailyCost,
        limit_eur: DAILY_BUDGET_LIMIT_EUR,
      }, 200, origin);
    }

    // 1) Load or create autofix_run
    let run: any;
    if (autofixRunId) {
      const { data, error } = await sb.from("autofix_runs").select("*").eq("id", autofixRunId).single();
      if (error || !data) return json({ error: "Autofix run not found" }, 404, origin);
      run = data;
      if (run.status !== "running") {
        return json({ error: `Autofix run is ${run.status}, not running` }, 409, origin);
      }
    } else {
      // Check for existing running autofix for this package
      const { data: existing } = await sb.from("autofix_runs")
        .select("id").eq("package_id", packageId).eq("status", "running").maybeSingle();
      if (existing) {
        return json({ error: "Autofix already running", autofix_run_id: existing.id }, 409, origin);
      }
      const { data: newRun, error: insertErr } = await sb.from("autofix_runs").insert({
        package_id: packageId,
        curriculum_id: curriculumId,
        course_id: courseId,
        target_score: targetScore,
        max_rounds: maxRounds,
        budget_eur: budgetEur,
      }).select("*").single();
      if (insertErr) throw insertErr;
      run = newRun;
    }

    // 2) Structural Gate: verify generators actually wrote data before spending budget
    const structuralCheck = await verifyStructuralHealth(sb, curriculumId, packageId);
    if (!structuralCheck.ok) {
      await sb.from("autofix_runs").update({
        status: "stopped",
        stop_reason: `Structural gate failed: ${structuralCheck.reason}`,
        stop_reason_code: "STRUCTURAL_FAIL",
        last_report: structuralCheck as any,
      }).eq("id", run.id);
      return json({
        ok: false,
        status: "structural_fix_required",
        reason: structuralCheck.reason,
        structural: structuralCheck,
        autofix_run_id: run.id,
      }, 200, origin);
    }

    // ═══════════════════════════════════════════════════════════
    // GUARDRAIL C: Baseline Guard — reject autofix if gap is too large
    // Autofix is only for small residual gaps, not structural underproduction.
    // SSOT FIX: Uses ops_package_baseline_v1 view instead of broken RPC
    // ═══════════════════════════════════════════════════════════
    if (run.current_round <= 1) {
      // ── SSOT: Read canonical baseline from ops_package_baseline_v1 ──
      const { data: ssotBaseline, error: ssotErr } = await sb
        .from("ops_package_baseline_v1")
        .select("*")
        .eq("package_id", packageId)
        .maybeSingle();

      if (ssotErr) {
        console.error(`[AutoGap] SSOT baseline query failed: ${ssotErr.message}`);
      }

      // If SSOT view returns integrity_passed=true, skip autofix entirely
      if (ssotBaseline?.integrity_passed === true) {
        await sb.from("autofix_runs").update({
          status: "skipped",
          stop_reason: "Package already passed integrity. Autofix not required.",
          stop_reason_code: "ALREADY_PASSED",
          last_score: 100,
          baseline_snapshot: ssotBaseline as any,
        }).eq("id", run.id);

        return json({
          ok: true,
          skipped: true,
          reason: "ALREADY_PASSED",
          autofix_run_id: run.id,
        }, 200, origin);
      }

      // Use SSOT values for baseline, fall back to structural check
      const ssotQuestions = ssotBaseline?.approved_questions ?? structuralCheck.exam;
      const ssotOral = ssotBaseline?.oral_blueprints ?? structuralCheck.oral;
      const ssotHandbook = ssotBaseline?.handbook_sections ?? structuralCheck.handbook_sections;
      const ssotCompetencyCoverage = Number(ssotBaseline?.competency_coverage_pct ?? 0);

      // Run quick integrity to get current score
      const { data: baselineReport } = await sb.rpc("validate_course_integrity_v2", {
        p_curriculum_id: curriculumId,
      });
      const baselineScore = Number((baselineReport as any)?.score ?? 0);
      const examTarget = (baselineReport as any)?.exam?.target || 500;

      const baselineSnapshot = {
        questions: ssotQuestions,
        oral: ssotOral,
        handbook_sections: ssotHandbook,
        score: baselineScore,
        competency_coverage_pct: ssotCompetencyCoverage,
        exam_target: examTarget,
        exam_fill_pct: examTarget > 0 ? Math.round((ssotQuestions / examTarget) * 100) : 0,
        ssot_source: "ops_package_baseline_v1",
      };

      // Save baseline for later delta tracking
      await sb.from("autofix_runs").update({
        baseline_snapshot: baselineSnapshot as any,
      }).eq("id", run.id);

      // Minimum thresholds for autofix eligibility
      const MIN_EXAM_FILL_PCT = 50;       // At least 50% of questions already exist
      const MIN_COMPETENCY_PCT = 40;      // At least 40% competency coverage
      const MIN_BASELINE_SCORE = 35;      // At least score 35

      const rejections: string[] = [];
      if (baselineSnapshot.exam_fill_pct < MIN_EXAM_FILL_PCT) {
        rejections.push(`exam_fill=${baselineSnapshot.exam_fill_pct}%<${MIN_EXAM_FILL_PCT}%`);
      }
      if (ssotCompetencyCoverage < MIN_COMPETENCY_PCT) {
        rejections.push(`competency_coverage=${ssotCompetencyCoverage}%<${MIN_COMPETENCY_PCT}%`);
      }
      if (baselineScore < MIN_BASELINE_SCORE) {
        rejections.push(`score=${baselineScore}<${MIN_BASELINE_SCORE}`);
      }

      if (rejections.length > 0) {
        const rejectReason = `INSUFFICIENT_BASELINE: ${rejections.join(", ")}. Full production run required.`;
        console.warn(`[AutoGap] BASELINE GUARD: ${rejectReason}`);

        await sb.from("autofix_runs").update({
          status: "failed",
          stop_reason: rejectReason,
          stop_reason_code: "INSUFFICIENT_BASELINE",
          last_score: baselineScore,
          last_report: baselineReport as any,
          baseline_snapshot: baselineSnapshot as any,
        }).eq("id", run.id);

        // Set package to quality_gate_failed immediately
        await sb.from("course_packages").update({
          status: "quality_gate_failed",
        }).eq("id", packageId);

        await alertAdmin(sb, {
          title: `🚫 Autofix abgelehnt: Baseline zu niedrig`,
          body: [
            `Auto-Gap-Closer wurde **nicht gestartet**, weil die Ausgangslage zu weit unter dem Ziel liegt.`,
            ``,
            `**Paket:** ${packageId}`,
            `**Score:** ${baselineScore}/100`,
            `**Fragen:** ${ssotQuestions}/${examTarget} (${baselineSnapshot.exam_fill_pct}%)`,
            `**Kompetenzabdeckung:** ${ssotCompetencyCoverage}%`,
            ``,
            `**Ablehnungsgründe:** ${rejections.join(", ")}`,
            ``,
            `→ Ein neuer Produktionslauf ist erforderlich.`,
          ].join("\n"),
          severity: "warning",
          category: "baseline_guard",
        });

        return json({
          ok: false,
          status: "insufficient_baseline",
          reason: rejectReason,
          baseline: baselineSnapshot,
          autofix_run_id: run.id,
        }, 200, origin);
      }
    }

    // 3) Run integrity check
    const { data: report, error: rpcErr } = await sb.rpc("validate_course_integrity_v2", {
      p_curriculum_id: curriculumId,
    });
    if (rpcErr) throw rpcErr;

    const score = Number((report as any)?.score ?? 0);

    // Update run with latest score
    await sb.from("autofix_runs").update({
      last_score: score,
      last_report: report as any,
      current_round: run.current_round + 1,
    }).eq("id", run.id);

    // ═══════════════════════════════════════════════════════════
    // GUARDRAIL B: Regression-Freeze (score must improve each round)
    // ═══════════════════════════════════════════════════════════
    if (run.last_score !== null && run.current_round > 1) {
      const scoreDelta = score - run.last_score;
      
      if (scoreDelta <= REGRESSION_FREEZE_THRESHOLD) {
        const freezeReason = scoreDelta < 0
          ? `REGRESSION: Score dropped from ${run.last_score} to ${score} (Δ${scoreDelta})`
          : `STAGNATION: Score unchanged at ${score} (Δ${scoreDelta})`;
        const reasonCode = scoreDelta < 0 ? "REGRESSION" : "STAGNATION";

        console.warn(`[AutoGap] REGRESSION FREEZE: ${freezeReason}`);

        // Freeze: stop run + alert admin
        await sb.from("autofix_runs").update({
          status: "frozen",
          stop_reason: freezeReason,
          stop_reason_code: reasonCode,
          last_score: score,
          last_report: report as any,
        }).eq("id", run.id);

        await alertAdmin(sb, {
          title: `🧊 Regression-Freeze: ${freezeReason}`,
          body: [
            `Auto-Gap-Closer wurde eingefroren weil der Score sich nicht verbessert hat.`,
            ``,
            `**Paket:** ${packageId}`,
            `**Runde:** ${run.current_round + 1}`,
            `**Vorheriger Score:** ${run.last_score}`,
            `**Aktueller Score:** ${score}`,
            `**Delta:** ${scoreDelta}`,
            ``,
            `Mögliche Ursachen:`,
            `- Generator produziert Duplikate`,
            `- Validierung zählt neue Items nicht`,
            `- Content-Qualität reicht nicht für Score-Anstieg`,
            ``,
            `Nächster Schritt: Manuell prüfen und ggf. Generator-Logik anpassen.`,
          ].join("\n"),
          severity: "warning",
          category: "regression_freeze",
        });

        return json({
          ok: false,
          status: "frozen",
          reason: freezeReason,
          previous_score: run.last_score,
          current_score: score,
          delta: scoreDelta,
          autofix_run_id: run.id,
        }, 200, origin);
      }
    }

    // 4) Check other termination conditions
    if (score >= targetScore) {
      await sb.from("autofix_runs").update({
        status: "succeeded",
        stop_reason: `Score ${score} >= target ${targetScore}`,
      }).eq("id", run.id);

      // Trigger auto_publish
      if (!dryRun) {
        // SSOT: Write to package_steps, not the legacy view
        await sb.from("package_steps")
          .update({ status: "queued", last_error: null, meta: null })
          .eq("package_id", packageId).eq("step_key", "auto_publish");

        await sb.from("job_queue").insert({
          job_type: "package_auto_publish",
          status: "pending",
          package_id: packageId,
          payload: { package_id: packageId, course_id: courseId, curriculum_id: curriculumId, job_version: "auto_gap_close" },
          max_attempts: 3,
        });
      }

      return json({ ok: true, status: "succeeded", score, autofix_run_id: run.id }, 200, origin);
    }

    if (run.current_round + 1 > maxRounds) {
      await sb.from("autofix_runs").update({
        status: "stopped",
        stop_reason: `Max rounds reached (${maxRounds})`,
        stop_reason_code: "MAX_ROUNDS_EXCEEDED",
      }).eq("id", run.id);
      return json({ ok: false, status: "stopped", score, reason: "max_rounds", autofix_run_id: run.id }, 200, origin);
    }

    // Per-run budget check
    if (run.budget_used_eur >= budgetEur) {
      await sb.from("autofix_runs").update({
        status: "stopped",
        stop_reason: `Per-run budget exhausted: €${run.budget_used_eur} >= €${budgetEur}`,
        stop_reason_code: "BUDGET_EXHAUSTED",
      }).eq("id", run.id);
      return json({ ok: false, status: "stopped", score, reason: "budget_exhausted", autofix_run_id: run.id }, 200, origin);
    }

    // 5) Build gap-close plan
    const plan = buildPlan(report as any, run.current_round + 1, curriculumId, courseId, packageId);

    await sb.from("autofix_runs").update({ last_plan: plan as any }).eq("id", run.id);

    if (dryRun) {
      return json({ ok: true, status: "dry_run", score, plan, autofix_run_id: run.id }, 200, origin);
    }

    // ═══════════════════════════════════════════════════════════
    // CRITICAL FIX: Transition package to "building" BEFORE enqueuing jobs.
    // Without this, OPS_GUARD kills all jobs for non-building packages,
    // creating a deadlock where auto-gap-close enqueues → OPS_GUARD kills → nothing runs.
    // ═══════════════════════════════════════════════════════════
    const { data: pkgState } = await sb.from("course_packages")
      .select("status")
      .eq("id", packageId)
      .single();

    const previousStatus = pkgState?.status;
    if (previousStatus && previousStatus !== "building") {
      console.log(`[AutoGap] Transitioning package ${packageId} from '${previousStatus}' → 'building' to allow job execution`);
      // Use RPC to prevent uniq_visible_package_per_curriculum violation
      await sb.rpc("safe_transition_package_status", {
        p_package_id: packageId,
        p_new_status: "building",
        p_extra: {},
      });

      // Log the transition for audit trail
      await sb.from("admin_actions").insert({
        action: "auto_gap_close_status_transition",
        scope: "course_packages",
        affected_ids: [packageId],
        before_state: { status: previousStatus },
        after_state: { status: "building" },
        payload: { autofix_run_id: run.id, reason: "OPS_GUARD bypass: package must be building for jobs to run" },
      });
    }

    // 6) Enqueue gap-closing jobs (with dedup)
    let enqueued = 0;
    for (const action of plan.actions) {
      const { data: existing } = await sb.from("job_queue")
        .select("id")
        .eq("job_type", action.job_type)
        .in("status", ["pending", "processing"])
        .contains("payload", { package_id: packageId } as any)
        .limit(1);

      if (existing && existing.length > 0) {
        console.log(`[AutoGap] Skipping ${action.job_type} – already queued`);
        continue;
      }

      for (let i = 0; i < action.count; i++) {
        await sb.from("job_queue").insert({
          job_type: action.job_type,
          status: "pending",
          package_id: packageId,
          payload: {
            package_id: packageId,
            course_id: courseId,
            curriculum_id: curriculumId,
            job_version: "auto_gap_close",
            autofix_run_id: run.id,
            ...(action.payload_extra || {}),
          },
          max_attempts: 3,
        });
        enqueued++;
      }
    }

    // 7) Schedule self-check after workers finish (~3 min)
    const recheckAfter = new Date(Date.now() + 180_000).toISOString();
    await sb.from("job_queue").insert({
      job_type: "auto_gap_close",
      status: "pending",
      package_id: packageId,
      run_after: recheckAfter,
      payload: {
        package_id: packageId,
        course_id: courseId,
        curriculum_id: curriculumId,
        autofix_run_id: run.id,
        target_score: targetScore,
        max_rounds: maxRounds,
        budget_eur: budgetEur,
      },
      max_attempts: 1,
    });

    // Reset integrity check step for next round
    // SSOT: Write to package_steps, not the legacy view
    await sb.from("package_steps")
      .update({ status: "queued", last_error: null, meta: null, started_at: null, finished_at: null })
      .eq("package_id", packageId).eq("step_key", "run_integrity_check");

    return json({
      ok: true,
      status: "running",
      score,
      round: run.current_round + 1,
      plan,
      enqueued,
      autofix_run_id: run.id,
      next_check: recheckAfter,
      guardrails: {
        daily_cost_eur: dailyCost,
        daily_limit_eur: DAILY_BUDGET_LIMIT_EUR,
        budget_remaining_pct: Math.round((1 - dailyCost / DAILY_BUDGET_LIMIT_EUR) * 100),
      },
    }, 200, origin);

  } catch (e: unknown) {
    const msg = (e as Error)?.message || String(e);
    console.error("[AutoGapClose] Error:", msg);

    if (autofixRunId) {
      try {
        await sb.from("autofix_runs").update({
          status: "failed",
          stop_reason: msg.slice(0, 500),
        }).eq("id", autofixRunId);
      } catch (_) { /* ignore */ }
    }

    return json({ error: msg }, 500, origin);
  }
});

// ═══════════════════════════════════════════════════════════════
// GUARDRAIL HELPERS
// ═══════════════════════════════════════════════════════════════

/**
 * Calculates total autofix cost for today by summing budget_used_eur
 * from all autofix_runs created or updated today.
 */
async function getDailyAutofixCost(
  sb: ReturnType<typeof createClient>,
): Promise<number> {
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  
  const { data } = await sb
    .from("autofix_runs")
    .select("budget_used_eur")
    .gte("updated_at", todayStart.toISOString())
    .in("status", ["running", "succeeded", "stopped", "frozen", "failed"]);

  if (!data || data.length === 0) return 0;
  return data.reduce((sum: number, r: any) => sum + (r.budget_used_eur || 0), 0);
}

/**
 * Sends an admin notification (stored in DB, logged for email pickup).
 */
async function alertAdmin(
  sb: ReturnType<typeof createClient>,
  notification: { title: string; body: string; severity: string; category: string },
) {
  await sb.from("admin_notifications").insert({
    title: notification.title,
    body: notification.body,
    severity: notification.severity,
    category: notification.category,
    metadata: { triggered_at: new Date().toISOString(), source: "auto_gap_close" },
  });

  console.warn(`[AutoGap] ALERT → ${notification.title}`);
}

// ═══════════════════════════════════════════════════════════════
// PLANNING
// ═══════════════════════════════════════════════════════════════

/**
 * Deterministic planner: translates integrity report deficits into concrete jobs.
 */
function buildPlan(
  report: any,
  round: number,
  curriculumId: string,
  courseId: string,
  packageId: string,
): GapPlan {
  const actions: GapPlan["actions"] = [];

  // Exam questions gap
  const examActual = report?.exam?.total || 0;
  const examTarget = report?.exam?.target || 1000;
  if (examActual < examTarget) {
    const missing = examTarget - examActual;
    const batchCount = Math.min(5, Math.ceil(missing / 50));
    actions.push({
      job_type: "package_generate_exam_pool",
      count: batchCount,
      scope: "per_curriculum",
      payload_extra: { step_key: "generate_exam_pool", batch_mode: true },
    });
  }

  // Oral exam gap
  const oralActual = report?.oral?.total || 0;
  const oralTarget = report?.oral?.target || 20;
  if (oralActual < oralTarget) {
    actions.push({
      job_type: "package_generate_oral_exam",
      count: 1,
      scope: "full",
      payload_extra: { step_key: "generate_oral_exam" },
    });
  }

    // Handbook gap – check both chapters AND sections
    const handbookChapters = report?.handbook?.chapters || 0;
    const handbookSections = report?.handbook?.sections || 0;
    const handbookChapterTarget = report?.handbook?.target || 5;
    const handbookSectionTarget = 10; // minimum sections
    if (handbookChapters < handbookChapterTarget || handbookSections < handbookSectionTarget) {
      const mode = handbookChapters < handbookChapterTarget
        ? "chapters_and_sections"
        : "sections_only";
      actions.push({
        job_type: "package_generate_handbook",
        count: 1,
        scope: mode,
        payload_extra: { step_key: "generate_handbook", fill_gaps: true, mode },
      });
    }

  // AI Tutor Index
  if (!report?.tutor_index) {
    actions.push({
      job_type: "package_build_ai_tutor_index",
      count: 1,
      scope: "full",
      payload_extra: { step_key: "build_ai_tutor_index" },
    });
  }

  return {
    round,
    actions,
    estimated_jobs: actions.reduce((sum, a) => sum + a.count, 0),
  };
}

// ═══════════════════════════════════════════════════════════════
// STRUCTURAL GATE
// ═══════════════════════════════════════════════════════════════

/**
 * Verifies generators actually wrote data before allowing gap-close budget spend.
 */
async function verifyStructuralHealth(
  sb: ReturnType<typeof createClient>,
  curriculumId: string,
  packageId: string,
): Promise<{ ok: boolean; reason?: string; exam: number; oral: number; handbook_sections: number }> {
  const { count: examN } = await sb.from("exam_questions").select("id", { count: "exact", head: true }).eq("curriculum_id", curriculumId).neq("status", "rejected").not("qc_status", "in", "(tier1_failed,rejected)");
  const { count: oralN } = await sb.from("oral_exam_blueprints").select("id", { count: "exact", head: true }).eq("curriculum_id", curriculumId);

  const { data: chapterIds } = await sb.from("handbook_chapters").select("id").eq("curriculum_id", curriculumId);
  let sectionN = 0;
  if (chapterIds && chapterIds.length > 0) {
    const { count } = await sb.from("handbook_sections").select("id", { count: "exact", head: true }).in("chapter_id", chapterIds.map((c: { id: string }) => c.id));
    sectionN = count ?? 0;
  }

  const reasons: string[] = [];
  if ((examN ?? 0) === 0) reasons.push("exam_questions=0");
  if ((oralN ?? 0) === 0) reasons.push("oral_exam_blueprints=0");
  if (sectionN === 0) reasons.push("handbook_sections=0");

  if (reasons.length > 0) {
    return { ok: false, reason: `Structural fix required: ${reasons.join(", ")}. Re-run generators first.`, exam: examN ?? 0, oral: oralN ?? 0, handbook_sections: sectionN };
  }

  return { ok: true, exam: examN ?? 0, oral: oralN ?? 0, handbook_sections: sectionN };
}
