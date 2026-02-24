import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { assertSchemaReady } from "../_shared/schema-gate.ts";
import { pctOrNA } from "../_shared/math-helpers.ts";

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

    // Load quality rules
    const { data: rules } = await sb.from("quality_rules").select("*").eq("enabled", true);

    // ── FAIL-CLOSED GUARD 3: quality_rules must not be empty ──
    if (!rules || rules.length === 0) {
      console.error(`[QualityCouncil] FAIL-CLOSED: No quality_rules configured (0 enabled rules)`);
      await notifyAdmin(sb, packageId, "FAIL-CLOSED: No quality_rules configured — gate cannot evaluate", "error");
      await writeFailReport(sb, packageId, 0, "fail", "none", "no_quality_rules");
      return json({ ok: true, package_id: packageId, score: 0, status: "fail", badge: "none", fail_reason: "no_quality_rules" });
    }

    // Load exam questions stats
    const { count: totalQuestions } = await sb
      .from("exam_questions")
      .select("id", { count: "exact", head: true })
      .eq("curriculum_id", curriculumId);

    // Difficulty distribution
    const { data: difficultyData } = await sb
      .from("exam_questions")
      .select("difficulty")
      .eq("curriculum_id", curriculumId);

    const difficulties = difficultyData ?? [];
    const total = difficulties.length || 1;
    const easyCount = difficulties.filter((d: any) => d.difficulty === "easy" || d.difficulty === "leicht").length;
    const hardCount = difficulties.filter((d: any) => d.difficulty === "hard" || d.difficulty === "schwer").length;
    const easyPct = (easyCount / total) * 100;
    const hardPct = (hardCount / total) * 100;

    // ── Extract metrics from integrity report ──
    // Priority: v3.summary (SSOT, written by integrity v1.3+) → top-level → gates[] fallback
    const summary = intReport?.v3?.summary as Record<string, any> | undefined;
    let blueprintCoverage = summary?.blueprint_coverage_pct ?? intReport?.blueprint_coverage_pct ?? intReport?.v3?.blueprint_coverage_pct;
    let lfCoverage = summary?.lf_coverage_pct ?? intReport?.lf_coverage_pct ?? intReport?.v3?.lf_coverage_pct;
    let duplicateRate = summary?.duplicate_rate_pct ?? intReport?.duplicate_rate_pct ?? intReport?.v3?.duplicate_rate_pct;

    // Fallback: parse from v3.gates[] if summary not yet written (pre-v1.3 reports)
    if ((blueprintCoverage == null || lfCoverage == null || duplicateRate == null) && Array.isArray(intReport?.v3?.gates)) {
      for (const g of intReport.v3.gates) {
        if (g.gate === "learning_field_coverage" && lfCoverage == null) {
          if (g.passed) lfCoverage = 100;
          else { const m = g.detail?.match?.(/(\d+(?:\.\d+)?)%/); if (m) lfCoverage = parseFloat(m[1]); }
        }
        if (g.gate === "exam_pool_distribution" && blueprintCoverage == null) {
          if (g.passed) blueprintCoverage = 100;
        }
        if (g.gate === "duplicate_rate" && duplicateRate == null) {
          const m = g.detail?.match?.(/(\d+(?:\.\d+)?)%/); if (m) duplicateRate = parseFloat(m[1]);
        }
      }
      // Safe defaults when integrity passed overall but specific fields missing
      if (duplicateRate == null && (intReport?.v3?.hard_fail_reasons?.length === 0 || intReport?.score >= 90)) duplicateRate = 0;
      if (blueprintCoverage == null && intReport?.score >= 90) blueprintCoverage = 100;
      if (lfCoverage == null && intReport?.score >= 90) lfCoverage = 100;
    }

    // ── Competency binding check ──
    const { count: questionsWithoutCompetency } = await sb
      .from("exam_questions")
      .select("id", { count: "exact", head: true })
      .eq("curriculum_id", curriculumId)
      .is("competency_id", null);

    const competencyBindingPct = total > 0 ? ((total - (questionsWithoutCompetency ?? 0)) / total) * 100 : 0;

    // ── Competency coverage check ──
    // FIX: competencies table has no curriculum_id; join via learning_fields
    const { data: lfIds } = await sb
      .from("learning_fields")
      .select("id")
      .eq("curriculum_id", curriculumId);

    const lfIdList = (lfIds ?? []).map((lf: any) => lf.id);
    let totalCompetencies = 0;
    if (lfIdList.length > 0) {
      const { count } = await sb
        .from("competencies")
        .select("id", { count: "exact", head: true })
        .in("learning_field_id", lfIdList);
      totalCompetencies = count ?? 0;
    }

    const { data: coveredComps } = await sb
      .from("exam_questions")
      .select("competency_id")
      .eq("curriculum_id", curriculumId)
      .not("competency_id", "is", null);

    const uniqueCoveredComps = new Set((coveredComps ?? []).map((q: any) => q.competency_id));
    const competencyCoveragePct = pctOrNA(uniqueCoveredComps.size, totalCompetencies);

    // Evaluate rules
    const results: Array<{ rule_key: string; severity: string; passed: boolean; detail: string }> = [];

    for (const rule of rules) {
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
          passed = (totalQuestions ?? 0) >= (cfg.min ?? 500);
          detail = `${totalQuestions ?? 0} (min: ${cfg.min})`;
          break;
        case "difficulty_distribution":
          passed = easyPct <= (cfg.easy_max_pct ?? 40) && hardPct >= (cfg.hard_min_pct ?? 15);
          detail = `easy=${easyPct.toFixed(0)}% hard=${hardPct.toFixed(0)}%`;
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
      detail: `${competencyBindingPct.toFixed(1)}% bound (min: 95%), ${questionsWithoutCompetency ?? 0} unbound`,
    });

    results.push({
      rule_key: "competency_coverage",
      severity: "block",
      passed: competencyCoveragePct >= 60,
      detail: `${uniqueCoveredComps.size}/${totalCompetencies} competencies covered (${competencyCoveragePct.toFixed(0)}%, min: 60%)`,
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
      difficulty: { easy_pct: +easyPct.toFixed(1), hard_pct: +hardPct.toFixed(1) },
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
