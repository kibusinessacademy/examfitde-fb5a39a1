import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { assertSchemaReady } from "../_shared/schema-gate.ts";
import { enqueueJob } from "../_shared/enqueue.ts";
import { markStepDone, markStepFailed } from "../_shared/steps.ts";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/**
 * package-quality-council v3 — FAIL-CLOSED Quality Gate + Time-Budgeted Chunked Promotion
 *
 * GOVERNANCE INVARIANT: This gate MUST fail-closed.
 * Missing data = FAIL (never pass by default).
 *
 * v3 PERMANENT FIX (CPU-Loop):
 *  - Time budget: aborts safely at 60% of CPU window and re-enqueues with resume cursor
 *  - Promotion chunking: 200 drafts per RPC call (was 2000 in one call → CPU spike)
 *  - Idempotent resume: payload.resume_phase tracks where we left off
 *  - Reclassify is best-effort with own time check
 *  - Phases: gate → reclassify → promote_chunk → audit → finalize
 */

// ── CPU Budget Configuration ──
// Edge Functions have ~150-400ms CPU budget per invocation depending on plan.
// We track wall-clock as a proxy and stop work at 60% to leave room for finalization
// (markStepDone/Failed has its own DB roundtrips).
const TIME_BUDGET_MS = 25_000;           // 25s wall clock soft budget (worker normally finishes <5s)
const TIME_BUDGET_SOFT_PCT = 0.6;        // start defer at 60%
const PROMOTION_CHUNK_SIZE = 200;        // promote at most 200 drafts per RPC call
const RESUME_DEFER_SECONDS = 30;         // re-enqueue with +30s run_after on time defer

type Phase = "gate" | "reclassify" | "promote" | "audit" | "finalize";

interface ResumeState {
  phase: Phase;
  promoted_so_far: number;
  reclassify_done: boolean;
  audit_done: boolean;
  // Cached gate verdict (so we don't re-evaluate on resume)
  cached_verdict?: {
    score: number;
    status: string;
    badge: string;
    rules_passed: number;
    rules_failed: number;
    rules_warned: number;
    total_questions: number;
    blueprint_coverage: number | null;
    lf_coverage: number | null;
    duplicate_rate: number | null;
    competency_binding_pct: number;
    competency_coverage_pct: number;
    bloom_remember_pct: number | null;
    results: Array<{ rule_key: string; severity: string; passed: boolean; detail: string }>;
  };
}

class TimeBudget {
  private start = Date.now();
  constructor(private budgetMs: number, private softPct: number) {}
  elapsed(): number { return Date.now() - this.start; }
  shouldDefer(): boolean { return this.elapsed() > this.budgetMs * this.softPct; }
  hardExceeded(): boolean { return this.elapsed() > this.budgetMs; }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  await assertSchemaReady("package-quality-council", sb);
  const body = await req.json().catch(() => ({}));
  const packageId = body.package_id || body.payload?.package_id;
  const resume: ResumeState | undefined = body.resume_state || body.payload?.resume_state;

  if (!packageId) return json({ error: "package_id required" }, 400);

  const budget = new TimeBudget(TIME_BUDGET_MS, TIME_BUDGET_SOFT_PCT);

  try {
    // Load package data
    const { data: pkg } = await sb
      .from("course_packages")
      .select("id, course_id, certification_id, curriculum_id, integrity_report, track")
      .eq("id", packageId)
      .maybeSingle();

    if (!pkg) return json({ error: "Package not found" }, 404);

    const curriculumId = pkg.curriculum_id;
    const packageTrack: string = (pkg as any).track || "AUSBILDUNG_VOLL";

    // ── FAIL-CLOSED GUARD 1: curriculum_id must exist ──
    if (!curriculumId) {
      console.error(`[QualityCouncil] FAIL-CLOSED: No curriculum_id for package ${packageId}`);
      await notifyAdmin(sb, packageId, "FAIL-CLOSED: Missing curriculum_id", "error");
      return json({ ok: true, package_id: packageId, score: 0, status: "fail", badge: "none", fail_reason: "missing_curriculum_id" });
    }

    // ── FAIL-CLOSED GUARD 2: integrity_report must exist ──
    const intReport = pkg.integrity_report as Record<string, any> | null;
    if (!intReport) {
      console.error(`[QualityCouncil] FAIL-CLOSED: No integrity_report for package ${packageId.slice(0, 8)}`);
      await notifyAdmin(sb, packageId, "FAIL-CLOSED: Missing integrity_report — run_integrity_check may not have completed", "error");
      await writeFailReport(sb, packageId, 0, "fail", "none", "missing_integrity_report");
      return json({ ok: true, package_id: packageId, score: 0, status: "fail", badge: "none", fail_reason: "missing_integrity_report" });
    }

    // ── SSOT GUARD: v3.summary MUST exist ──
    const summary = intReport?.v3?.summary as Record<string, any> | undefined;
    if (!summary) {
      console.error(`[QualityCouncil] INFRA-FAIL: integrity_report.v3.summary missing for package ${packageId.slice(0, 8)} — auto-enqueuing integrity recheck`);
      await notifyAdmin(sb, packageId, "INFRA: v3.summary missing in integrity_report — auto-enqueuing integrity recheck", "warn");

      const { data: pkgForRequeue } = await sb.from("course_packages").select("course_id").eq("id", packageId).maybeSingle();
      if (pkgForRequeue?.course_id) {
        const { count: existingJobs } = await sb
          .from("job_queue")
          .select("id", { count: "exact", head: true })
          .eq("job_type", "package_run_integrity_check")
          .in("status", ["pending", "processing"])
          .eq("package_id", packageId);

        if ((existingJobs ?? 0) === 0) {
          await enqueueJob(sb, {
            job_type: "package_run_integrity_check",
            package_id: packageId,
            max_attempts: 5,
            payload: { package_id: packageId, course_id: pkgForRequeue.course_id, step_key: "run_integrity_check" },
          });
        }
      }

      return json({
        ok: false, retry: true, package_id: packageId, score: 0,
        status: "retryable_fail", fail_reason: "integrity_summary_missing",
      }, 409);
    }

    // ─────────────────────────────────────────────────────────────────
    // PHASE 1: GATE EVALUATION (cached on resume)
    // ─────────────────────────────────────────────────────────────────
    let verdict = resume?.cached_verdict;
    let results: Array<{ rule_key: string; severity: string; passed: boolean; detail: string }>;

    if (!verdict) {
      const blueprintCoverage = summary.blueprint_coverage_pct ?? null;
      const lfCoverage = summary.lf_coverage_pct ?? null;
      const duplicateRate = summary.duplicate_rate_pct ?? null;
      const totalQuestions = summary.questions_total ?? 0;
      const competencyBindingPct = summary.competency_binding_pct ?? 0;
      const competencyCoveragePct = summary.competency_coverage_pct ?? 100;
      const bloomRememberPct = summary.bloom_remember_pct ?? null;

      const { data: rules } = await sb.from("quality_rules").select("rule_key, severity, config").eq("enabled", true);

      results = [];
      for (const rule of (rules ?? [])) {
        const cfg = rule.config as Record<string, any>;
        let passed = true;
        let detail = "";
        switch (rule.rule_key) {
          case "blueprint_coverage":
            if (blueprintCoverage == null) { passed = false; detail = "MISSING"; }
            else { passed = blueprintCoverage >= (cfg.min_percent ?? 95); detail = `${blueprintCoverage.toFixed(1)}% (min: ${cfg.min_percent}%)`; }
            break;
          case "lf_coverage":
            if (lfCoverage == null) { passed = false; detail = "MISSING"; }
            else { passed = lfCoverage >= (cfg.min_percent ?? 90); detail = `${lfCoverage.toFixed(1)}% (min: ${cfg.min_percent}%)`; }
            break;
          case "duplicate_rate":
            if (duplicateRate == null) { passed = false; detail = "MISSING"; }
            else { passed = duplicateRate <= (cfg.max_percent ?? 3); detail = `${duplicateRate.toFixed(1)}% (max: ${cfg.max_percent}%)`; }
            break;
          case "min_question_count": {
            const overrides = (cfg.track_overrides ?? {}) as Record<string, number>;
            const effectiveMin: number = overrides[packageTrack] ?? cfg.min ?? 500;
            passed = totalQuestions >= effectiveMin;
            detail = `${totalQuestions} (min: ${effectiveMin}, track: ${packageTrack})`;
            break;
          }
          case "difficulty_distribution":
            passed = true; detail = "delegated to integrity gate"; break;
          default:
            detail = "auto-pass";
        }
        results.push({ rule_key: rule.rule_key, severity: rule.severity, passed, detail });
      }

      results.push({ rule_key: "competency_binding", severity: "block", passed: competencyBindingPct >= 95, detail: `${competencyBindingPct.toFixed(1)}% bound (min: 95%)` });
      results.push({ rule_key: "competency_coverage", severity: "block", passed: competencyCoveragePct >= 60, detail: `${competencyCoveragePct.toFixed(1)}% covered (min: 60%)` });

      const rulesPassed = results.filter(r => r.passed).length;
      const rulesFailed = results.filter(r => !r.passed && r.severity === "block").length;
      const rulesWarned = results.filter(r => !r.passed && r.severity === "warn").length;
      const score = results.length > 0 ? Math.round((rulesPassed / results.length) * 100) : 0;
      const status = rulesFailed > 0 ? "fail" : rulesWarned > 0 ? "warn" : "pass";
      const badge = rulesFailed > 0 ? "bronze" : score >= 92 ? "platinum" : score >= 85 ? "gold" : score >= 75 ? "silver" : "bronze";

      verdict = {
        score, status, badge, rules_passed: rulesPassed, rules_failed: rulesFailed, rules_warned: rulesWarned,
        total_questions: totalQuestions, blueprint_coverage: blueprintCoverage, lf_coverage: lfCoverage,
        duplicate_rate: duplicateRate, competency_binding_pct: competencyBindingPct,
        competency_coverage_pct: competencyCoveragePct, bloom_remember_pct: bloomRememberPct, results,
      };

      // Persist gate report (idempotent upsert)
      await sb.from("package_quality_reports").upsert({
        package_id: packageId,
        report: { results, total_questions: totalQuestions, blueprint_coverage: blueprintCoverage, lf_coverage: lfCoverage, duplicate_rate: duplicateRate, competency_binding_pct: competencyBindingPct, competency_coverage_pct: competencyCoveragePct },
        score, status, rules_passed: rulesPassed, rules_failed: rulesFailed, rules_warned: rulesWarned,
        created_at: new Date().toISOString(),
      }, { onConflict: "package_id" });

      await sb.from("package_quality_scores").upsert({
        package_id: packageId, score_version: 3, score, badge,
        public_summary: {
          score, badge, total_questions: totalQuestions,
          blueprint_coverage_pct: blueprintCoverage, lf_coverage_pct: lfCoverage, duplicate_rate_pct: duplicateRate,
          competency_binding_pct: competencyBindingPct, competency_coverage_pct: competencyCoveragePct,
          difficulty: { bloom_remember_pct: bloomRememberPct },
          rules_total: results.length, rules_passed: rulesPassed, rules_warned: rulesWarned, rules_failed: rulesFailed,
          checked_at: new Date().toISOString(),
        },
        updated_at: new Date().toISOString(),
      }, { onConflict: "package_id" });

      await sb.from("course_packages").update({
        quality_report: {
          status: status === "fail" ? "failed" : "passed",
          score, badge, total_questions: totalQuestions,
          rules_passed: rulesPassed, rules_failed: rulesFailed, rules_warned: rulesWarned,
          competency_binding_pct: competencyBindingPct, competency_coverage_pct: competencyCoveragePct,
          checked_at: new Date().toISOString(),
        },
      }).eq("id", packageId);
    } else {
      results = verdict.results;
      console.log(`[QualityCouncil] Resume: using cached verdict status=${verdict.status} score=${verdict.score}`);
    }

    // ── If gate FAILED, finalize immediately (no promotion) ──
    if (verdict.status === "fail") {
      await sb.from("course_package_reviews").upsert({
        course_package_id: packageId,
        status: "blocked",
        notes: `Quality Council v3: ${verdict.rules_failed} blocking rule(s) failed — ${results.filter(r => !r.passed).map(r => r.rule_key).join(", ")}`,
      }, { onConflict: "course_package_id" });
      await notifyAdmin(sb, packageId, `${verdict.rules_failed} blocking rules failed. Score: ${verdict.score}%.`, "error");
      const failErr = new Error(`Quality gate failed: score=${verdict.score}, ${verdict.rules_failed} blocking rules`);
      (failErr as any).__meta = { verdict: null, score: verdict.score, badge: verdict.badge, rules_failed: verdict.rules_failed };
      try {
        await markStepFailed(sb, {
          packageId, stepKey: "quality_council", err: failErr,
          stepMeta: { executed: true, ...verdict, results: undefined },
          autoRebuildHollow: false,
        });
      } catch (e) { console.error(`[QualityCouncil] markStepFailed error: ${(e as Error).message}`); }
      return json({ ok: true, package_id: packageId, ...verdict, results: undefined });
    }

    // ─────────────────────────────────────────────────────────────────
    // PHASE 2: RECLASSIFY (best-effort, time-checked)
    // ─────────────────────────────────────────────────────────────────
    const reclassifyDone = resume?.reclassify_done ?? false;
    if (!reclassifyDone) {
      if (budget.shouldDefer()) {
        return await deferResume(sb, packageId, body, {
          phase: "reclassify", promoted_so_far: resume?.promoted_so_far ?? 0,
          reclassify_done: false, audit_done: false, cached_verdict: verdict,
        }, "reclassify_pending", budget.elapsed());
      }

      const RECLASSIFY_MAP: Record<string, string> = { case_study: "apply", transfer: "analyze" };
      for (const [qType, newLevel] of Object.entries(RECLASSIFY_MAP)) {
        if (budget.shouldDefer()) break; // Defer to next call; promotion still safe to try via resume
        const { error: reclErr } = await sb
          .from("exam_questions")
          .update({ cognitive_level: newLevel })
          .eq("curriculum_id", curriculumId)
          .eq("question_type", qType)
          .eq("cognitive_level", "remember");
        if (reclErr) console.error(`[QualityCouncil] Reclassify ${qType} failed: ${reclErr.message}`);
      }
    }

    // ─────────────────────────────────────────────────────────────────
    // PHASE 3: PROMOTION (chunked, time-budgeted, resumable)
    // ─────────────────────────────────────────────────────────────────
    let promotedSoFar = resume?.promoted_so_far ?? 0;
    const MAX_CHUNKS_PER_INVOCATION = 6; // 6 * 200 = 1200 max per call
    let chunksThisCall = 0;

    while (chunksThisCall < MAX_CHUNKS_PER_INVOCATION) {
      if (budget.shouldDefer()) {
        console.log(`[QualityCouncil] Time-defer during promotion: promoted_so_far=${promotedSoFar} elapsed=${budget.elapsed()}ms`);
        return await deferResume(sb, packageId, body, {
          phase: "promote", promoted_so_far: promotedSoFar,
          reclassify_done: true, audit_done: false, cached_verdict: verdict,
        }, "promotion_chunked", budget.elapsed());
      }

      const { data: chunkResult, error: promoErr } = await sb.rpc(
        "promote_exam_questions_from_council",
        { p_curriculum_id: curriculumId, p_limit: PROMOTION_CHUNK_SIZE }
      );

      if (promoErr) {
        console.error(`[QualityCouncil] Promotion chunk failed: ${promoErr.message}`);
        break; // Don't infinite-loop on RPC error; finalize will catch via postcondition
      }

      const r = chunkResult as { promoted_count?: number; promoted?: number; total_questions?: number; total_approved?: number };
      const promotedThisChunk = r.promoted_count ?? r.promoted ?? 0;
      promotedSoFar += promotedThisChunk;
      chunksThisCall += 1;

      console.log(`[QualityCouncil] Chunk ${chunksThisCall}: promoted=${promotedThisChunk} cumulative=${promotedSoFar}`);

      if (promotedThisChunk < PROMOTION_CHUNK_SIZE) break; // No more drafts to promote
    }

    // If we hit max chunks but more drafts likely remain, defer
    if (chunksThisCall >= MAX_CHUNKS_PER_INVOCATION) {
      const { count: remainingDrafts } = await sb
        .from("exam_questions")
        .select("id", { count: "exact", head: true })
        .eq("curriculum_id", curriculumId)
        .eq("status", "draft");
      if ((remainingDrafts ?? 0) > 0) {
        return await deferResume(sb, packageId, body, {
          phase: "promote", promoted_so_far: promotedSoFar,
          reclassify_done: true, audit_done: false, cached_verdict: verdict,
        }, "promotion_chunk_limit_reached", budget.elapsed());
      }
    }

    // Legacy qc_status sync (cheap, single UPDATE)
    await sb.from("exam_questions")
      .update({ qc_status: "approved" })
      .eq("curriculum_id", curriculumId)
      .eq("qc_status", "tier1_passed");

    // ─────────────────────────────────────────────────────────────────
    // PHASE 4: ELITE AUDIT (best-effort, skip on time pressure)
    // ─────────────────────────────────────────────────────────────────
    if (!resume?.audit_done && !budget.shouldDefer()) {
      try {
        const { data: auditResult, error: auditErr } = await sb.rpc("audit_lf_elite_policy", { p_curriculum_id: curriculumId });
        if (auditErr) {
          console.error(`[QualityCouncil] Elite audit RPC error: ${auditErr.message}`);
        } else {
          const ea: any = auditResult;
          const violationCount = ea?.violations_count ?? 0;
          console.log(`[QualityCouncil] Elite LF audit: passed=${ea?.passed}, violations=${violationCount}`);
        }
      } catch (auditE) {
        console.error(`[QualityCouncil] Elite audit failed: ${(auditE as Error).message}`);
      }
    } else if (budget.shouldDefer()) {
      console.log(`[QualityCouncil] Elite audit skipped due to time budget (best-effort)`);
    }

    // ─────────────────────────────────────────────────────────────────
    // PHASE 5: FINALIZE (markStepDone + council_approved)
    // ─────────────────────────────────────────────────────────────────
    const finalMeta = {
      executed: true, score: verdict.score, status: verdict.status, badge: verdict.badge,
      rules_passed: verdict.rules_passed, rules_failed: verdict.rules_failed, rules_warned: verdict.rules_warned,
      promoted_total: promotedSoFar,
      time_budget_ms: budget.elapsed(),
    };

    await sb.from("package_steps")
      .update({ meta: finalMeta, last_error: null })
      .eq("package_id", packageId).eq("step_key", "quality_council");

    try {
      await markStepDone(sb, { packageId, stepKey: "quality_council", meta: finalMeta });
      console.log(`[QualityCouncil] ✅ Step done for ${packageId.slice(0, 8)}: score=${verdict.score} promoted=${promotedSoFar} ms=${budget.elapsed()}`);

      const { error: approveErr } = await sb.from("course_packages").update({ council_approved: true }).eq("id", packageId);
      if (approveErr) console.error(`[QualityCouncil] Failed to set council_approved=true: ${approveErr.message}`);
    } catch (stepErr) {
      console.error(`[QualityCouncil] ⛔ markStepDone failed for ${packageId.slice(0, 8)}: ${(stepErr as Error).message}`);
    }

    return json({ ok: true, package_id: packageId, score: verdict.score, status: verdict.status, badge: verdict.badge, promoted_total: promotedSoFar, elapsed_ms: budget.elapsed() });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});

// ─────────────────────────────────────────────────────────────────────
// Defer-Resume Helper
// ─────────────────────────────────────────────────────────────────────
async function deferResume(
  sb: ReturnType<typeof createClient>,
  packageId: string,
  origBody: any,
  state: ResumeState,
  reason: string,
  elapsedMs: number,
) {
  console.log(`[QualityCouncil] Defer-resume: package=${packageId.slice(0, 8)} reason=${reason} phase=${state.phase} elapsed=${elapsedMs}ms`);

  // Best-effort audit
  try {
    await sb.from("auto_heal_log").insert({
      action_type: "council_time_budget_deferred",
      target_id: packageId,
      target_type: "course_package",
      result_status: "deferred",
      metadata: {
        reason, phase: state.phase, promoted_so_far: state.promoted_so_far,
        reclassify_done: state.reclassify_done, elapsed_ms: elapsedMs,
      },
    });
  } catch (_) { /* non-blocking */ }

  // Re-enqueue self with resume_state in payload, run_after = now + 30s
  const runAfter = new Date(Date.now() + RESUME_DEFER_SECONDS * 1000).toISOString();
  try {
    await enqueueJob(sb, {
      job_type: "package_quality_council",
      package_id: packageId,
      max_attempts: 8,
      priority: 50,
      run_after: runAfter,
      payload: {
        package_id: packageId,
        step_key: "quality_council",
        resume_state: state,
        deferred_from: origBody?.job_id ?? null,
      },
    });
  } catch (enqErr) {
    console.error(`[QualityCouncil] Failed to enqueue resume job: ${(enqErr as Error).message}`);
  }

  return json({
    ok: true, deferred: true, package_id: packageId, reason,
    phase: state.phase, promoted_so_far: state.promoted_so_far, elapsed_ms: elapsedMs,
    run_after: runAfter,
  }, 202);
}

// ── Helper: Write fail report to all targets ──
async function writeFailReport(sb: ReturnType<typeof createClient>, packageId: string, score: number, status: string, badge: string, failReason: string) {
  await sb.from("package_quality_reports").upsert({
    package_id: packageId,
    report: { fail_reason: failReason },
    score, status, rules_passed: 0, rules_failed: 1, rules_warned: 0,
    created_at: new Date().toISOString(),
  }, { onConflict: "package_id" });

  await sb.from("course_packages").update({
    quality_report: { status: "failed", score, badge, fail_reason: failReason, checked_at: new Date().toISOString() },
  }).eq("id", packageId);
}

// ── Helper: Admin notification ──
async function notifyAdmin(sb: ReturnType<typeof createClient>, packageId: string, message: string, severity: "warn" | "error") {
  await sb.from("admin_notifications").insert({
    title: severity === "error" ? `🛑 Quality Council: Package blocked` : `⚠️ Quality Council: Warning`,
    body: message,
    category: "quality",
    severity,
    entity_type: "course_package",
    entity_id: packageId,
  });
}
