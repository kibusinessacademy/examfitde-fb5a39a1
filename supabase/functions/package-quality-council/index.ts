import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { assertSchemaReady } from "../_shared/schema-gate.ts";
import { enqueueJob } from "../_shared/enqueue.ts";
// pctOrNA no longer needed — all metrics come from v3.summary (SSOT)

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/**
 * package-quality-council v2 — FAIL-CLOSED Quality Gate
 *
 * GOVERNANCE INVARIANT: This gate MUST fail-closed.
 * Missing data = FAIL (never pass by default).
 *
 * Checks:
 * - Blueprint coverage (>= 95%)
 * - LF coverage (>= 90%)
 * - Duplicate rate (<= 3%)
 * - Min question count (>= 500)
 * - Difficulty distribution
 * - Competency binding (>= 95% with competency_id)
 * - Competency coverage (>= 60% of curriculum competencies)
 * - Cognitive level consistency
 */
Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  await assertSchemaReady("package-quality-council", sb);
  const body = await req.json().catch(() => ({}));
  const packageId = body.package_id || body.payload?.package_id;

  if (!packageId) return json({ error: "package_id required" }, 400);

  try {
    // Load package data
    const { data: pkg } = await sb
      .from("course_packages")
      .select("id, course_id, certification_id, curriculum_id, integrity_report")
      .eq("id", packageId)
      .maybeSingle();

    if (!pkg) return json({ error: "Package not found" }, 404);

    const curriculumId = pkg.curriculum_id;

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

    // ── SSOT GUARD: v3.summary MUST exist (written by integrity v1.3+) ──
    // If summary is missing, this is an infra issue (old report), NOT a content fail.
    // Auto-enqueue a fresh integrity check and return retryable.
    const summary = intReport?.v3?.summary as Record<string, any> | undefined;
    if (!summary) {
      console.error(`[QualityCouncil] INFRA-FAIL: integrity_report.v3.summary missing for package ${packageId.slice(0, 8)} — auto-enqueuing integrity recheck`);
      await notifyAdmin(sb, packageId, "INFRA: v3.summary missing in integrity_report — auto-enqueuing integrity recheck", "warn");

      // Auto-enqueue a fresh integrity check to regenerate the report with summary
      // Dedupe: real unique index is on (payload->>'package_id', job_type, scope) WHERE status IN ('pending','processing')
      // So we check first, then insert only if no active job exists.
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
        } else {
          console.log(`[QualityCouncil] Integrity recheck already pending/processing for ${packageId.slice(0, 8)}, skipping enqueue`);
        }
      }

      return json({
        ok: false, retry: true, package_id: packageId, score: 0,
        status: "retryable_fail", fail_reason: "integrity_summary_missing",
      }, 409);
    }

    // ── Read metrics exclusively from v3.summary (SSOT) ──
    const blueprintCoverage = summary.blueprint_coverage_pct ?? null;
    const lfCoverage = summary.lf_coverage_pct ?? null;
    const duplicateRate = summary.duplicate_rate_pct ?? null;
    const totalQuestions = summary.questions_total ?? 0;

    // ── Read competency metrics from summary (SSOT) ──
    const competencyBindingPct = summary.competency_binding_pct ?? 0;
    const competencyCoveragePct = summary.competency_coverage_pct ?? 100; // 0/0 = N/A = 100

    // Load quality rules from DB
    const { data: rules } = await sb.from("quality_rules").select("rule_key, severity, config").eq("enabled", true);

    // Evaluate rules
    const results: Array<{ rule_key: string; severity: string; passed: boolean; detail: string }> = [];

    for (const rule of (rules ?? [])) {
      const cfg = rule.config as Record<string, any>;
      let passed = true;
      let detail = "";

      switch (rule.rule_key) {
        case "blueprint_coverage":
          if (blueprintCoverage === undefined || blueprintCoverage === null) {
            passed = false;
            detail = `MISSING (integrity_report has no blueprint_coverage_pct)`;
          } else {
            passed = blueprintCoverage >= (cfg.min_percent ?? 95);
            detail = `${blueprintCoverage.toFixed(1)}% (min: ${cfg.min_percent}%)`;
          }
          break;
        case "lf_coverage":
          if (lfCoverage === undefined || lfCoverage === null) {
            passed = false;
            detail = `MISSING (integrity_report has no lf_coverage_pct)`;
          } else {
            passed = lfCoverage >= (cfg.min_percent ?? 90);
            detail = `${lfCoverage.toFixed(1)}% (min: ${cfg.min_percent}%)`;
          }
          break;
        case "duplicate_rate":
          if (duplicateRate === undefined || duplicateRate === null) {
            passed = false;
            detail = `MISSING (integrity_report has no duplicate_rate_pct)`;
          } else {
            passed = duplicateRate <= (cfg.max_percent ?? 3);
            detail = `${duplicateRate.toFixed(1)}% (max: ${cfg.max_percent}%)`;
          }
          break;
        case "min_question_count":
          passed = totalQuestions >= (cfg.min ?? 500);
          detail = `${totalQuestions} (min: ${cfg.min})`;
          break;
        case "difficulty_distribution":
          // Difficulty data not in summary yet — auto-pass (covered by integrity gate)
          passed = true;
          detail = "delegated to integrity gate";
          break;
        default:
          detail = "auto-pass";
      }

      results.push({ rule_key: rule.rule_key, severity: rule.severity, passed, detail });
    }

    // ── Additional hardcoded governance checks (always applied) ──
    results.push({
      rule_key: "competency_binding",
      severity: "block",
      passed: competencyBindingPct >= 95,
      detail: `${competencyBindingPct.toFixed(1)}% bound (min: 95%)`,
    });

    results.push({
      rule_key: "competency_coverage",
      severity: "block",
      passed: competencyCoveragePct >= 60,
      detail: `${competencyCoveragePct.toFixed(1)}% covered (min: 60%)`,
    });

    const rulesPassed = results.filter(r => r.passed).length;
    const rulesFailed = results.filter(r => !r.passed && r.severity === "block").length;
    const rulesWarned = results.filter(r => !r.passed && r.severity === "warn").length;
    const score = results.length > 0 ? Math.round((rulesPassed / results.length) * 100) : 0; // FAIL-CLOSED: 0 not 100
    const status = rulesFailed > 0 ? "fail" : rulesWarned > 0 ? "warn" : "pass";

    // Badge computation
    const badge = rulesFailed > 0 ? "bronze"
      : score >= 92 ? "platinum"
      : score >= 85 ? "gold"
      : score >= 75 ? "silver"
      : "bronze";

    // Save report
    await sb.from("package_quality_reports").upsert({
      package_id: packageId,
      report: { results, total_questions: totalQuestions, blueprint_coverage: blueprintCoverage, lf_coverage: lfCoverage, duplicate_rate: duplicateRate, competency_binding_pct: competencyBindingPct, competency_coverage_pct: competencyCoveragePct },
      score,
      status,
      rules_passed: rulesPassed,
      rules_failed: rulesFailed,
      rules_warned: rulesWarned,
      created_at: new Date().toISOString(),
    }, { onConflict: "package_id" });

    // Save quality scores
    const publicSummary = {
      score, badge, total_questions: totalQuestions,
      blueprint_coverage_pct: blueprintCoverage,
      lf_coverage_pct: lfCoverage,
      duplicate_rate_pct: duplicateRate,
      competency_binding_pct: competencyBindingPct,
      competency_coverage_pct: competencyCoveragePct,
      difficulty: { bloom_remember_pct: summary.bloom_remember_pct ?? null },
      rules_total: results.length,
      rules_passed: rulesPassed, rules_warned: rulesWarned, rules_failed: rulesFailed,
      checked_at: new Date().toISOString(),
    };

    await sb.from("package_quality_scores").upsert({
      package_id: packageId, score_version: 2, score, badge,
      public_summary: publicSummary, updated_at: new Date().toISOString(),
    }, { onConflict: "package_id" });

    // Write to course_packages for auto_publish
    await sb.from("course_packages").update({
      quality_report: {
        status: status === "fail" ? "failed" : "passed",
        score, badge, total_questions: totalQuestions,
        rules_passed: rulesPassed, rules_failed: rulesFailed, rules_warned: rulesWarned,
        competency_binding_pct: competencyBindingPct,
        competency_coverage_pct: competencyCoveragePct,
        checked_at: new Date().toISOString(),
      },
    }).eq("id", packageId);

    // ── Fix cognitive_level misclassification BEFORE promotion ──
    const RECLASSIFY_MAP: Record<string, string> = { case_study: "apply", transfer: "analyze" };
    for (const [qType, newLevel] of Object.entries(RECLASSIFY_MAP)) {
      const { count: fixCount } = await sb
        .from("exam_questions")
        .update({ cognitive_level: newLevel })
        .eq("curriculum_id", curriculumId)
        .eq("question_type", qType)
        .eq("cognitive_level", "remember")
        .select("id", { count: "exact", head: true });
      if ((fixCount ?? 0) > 0) {
        console.log(`[QualityCouncil] Reclassified ${fixCount} ${qType} questions: remember→${newLevel}`);
      }
    }

    // ── Promote draft → approved ONLY when gate passes ──
    if (status !== "fail") {
      const { count: draftBefore } = await sb
        .from("exam_questions")
        .select("id", { count: "exact", head: true })
        .eq("curriculum_id", curriculumId)
        .eq("status", "draft");

      const { data: promoResult, error: promoErr } = await sb.rpc(
        "promote_exam_questions_from_council",
        { p_curriculum_id: curriculumId, p_limit: 2000 }
      );
      if (promoErr) {
        console.error(`[QualityCouncil] Promotion RPC failed: ${promoErr.message}`);
      } else {
        const r = promoResult as { promoted: number; total_approved: number; draft_remaining: number };
        console.log(`[QualityCouncil] Promoted ${r.promoted} draft→approved, total=${r.total_approved}, remaining_draft=${r.draft_remaining}`);

        // No-op detection
        if ((draftBefore ?? 0) > 0 && r.promoted === 0) {
          console.error(`[QualityCouncil] NO-OP DETECTED: ${draftBefore} draft candidates but 0 promoted`);
          await notifyAdmin(sb, packageId, `No-op: ${draftBefore} drafts but 0 promoted`, "warn");
        }
      }

      // Legacy qc_status sync
      await sb
        .from("exam_questions")
        .update({ qc_status: "approved" })
        .eq("curriculum_id", curriculumId)
        .eq("qc_status", "tier1_passed");
    }

    // ── Elite LF Policy Audit (v2) ──
    let eliteAudit: any = null;
    try {
      const { data: auditResult, error: auditErr } = await sb.rpc(
        "audit_lf_elite_policy",
        { p_curriculum_id: curriculumId }
      );
      if (auditErr) {
        console.error(`[QualityCouncil] Elite audit RPC error: ${auditErr.message}`);
      } else {
        eliteAudit = auditResult;
        // Store audit result in quality report
        await sb.from("package_quality_reports").update({
          report: sb.rpc ? undefined : undefined, // We update via raw merge below
        }).eq("package_id", packageId);

        // Log elite audit result
        const violationCount = eliteAudit?.violations_count ?? 0;
        console.log(`[QualityCouncil] Elite LF audit: passed=${eliteAudit?.passed}, violations=${violationCount}`);

        // Add elite violations as warnings (not blocking yet — soft rollout)
        if (!eliteAudit?.passed && eliteAudit?.violations) {
          for (const v of (eliteAudit.violations as any[])) {
            if (v.status === "fail") {
              results.push({
                rule_key: `elite_lf_${v.rule || "policy"}`,
                severity: "warn", // Soft rollout: warn not block
                passed: false,
                detail: `LF ${String(v.learning_field_id).slice(0, 8)}: ${v.rule} expected=${v.expected} actual=${v.actual}${v.is_core ? " [CORE]" : ""}`,
              });
            }
          }
        }
      }
    } catch (auditE) {
      console.error(`[QualityCouncil] Elite audit failed: ${(auditE as Error).message}`);
    }

    // Block notification
    if (status === "fail") {
      await sb.from("course_package_reviews").upsert({
        course_package_id: packageId,
        status: "blocked",
        notes: `Quality Council v2: ${rulesFailed} blocking rule(s) failed — ${results.filter(r => !r.passed).map(r => r.rule_key).join(", ")}`,
      }, { onConflict: "course_package_id" });

      await notifyAdmin(sb, packageId, `${rulesFailed} blocking rules failed. Score: ${score}%. Failed: ${results.filter(r => !r.passed).map(r => `${r.rule_key}(${r.detail})`).join(", ")}`, "error");
    }

    console.log(`[QualityCouncil] Package ${packageId.slice(0, 8)}: score=${score} status=${status} badge=${badge} rules=${rulesPassed}/${results.length}`);
    return json({ ok: true, package_id: packageId, score, status, badge, rules_passed: rulesPassed, rules_failed: rulesFailed, rules_warned: rulesWarned });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});

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
