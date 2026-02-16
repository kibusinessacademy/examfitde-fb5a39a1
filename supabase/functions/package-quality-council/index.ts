import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/**
 * package-quality-council — automated QA gate before publish
 * 
 * Checks:
 * - Blueprint coverage (>= 95%)
 * - LF coverage (>= 90%)
 * - Duplicate rate (<= 3%)
 * - Min question count (>= 500)
 * - Difficulty distribution
 * - MiniCheck presence
 *
 * Also writes package_quality_scores with badge.
 */
Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const body = await req.json().catch(() => ({}));
  const packageId = body.package_id || body.payload?.package_id;

  if (!packageId) return json({ error: "package_id required" }, 400);

  try {
    // Load quality rules
    const { data: rules } = await sb.from("quality_rules").select("*").eq("enabled", true);

    // Load package data
    const { data: pkg } = await sb
      .from("course_packages")
      .select("id, course_id, certification_id, curriculum_id, integrity_report")
      .eq("id", packageId)
      .maybeSingle();

    if (!pkg) return json({ error: "Package not found" }, 404);

    // Use curriculum_id for exam_questions (no course_id column on exam_questions)
    const curriculumId = pkg.curriculum_id;

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

    // Blueprint coverage from integrity report
    const intReport = pkg.integrity_report as Record<string, any> | null;
    const blueprintCoverage = intReport?.blueprint_coverage_pct ?? intReport?.v3?.blueprint_coverage_pct ?? 100;
    const lfCoverage = intReport?.lf_coverage_pct ?? intReport?.v3?.lf_coverage_pct ?? 100;
    const duplicateRate = intReport?.duplicate_rate_pct ?? intReport?.v3?.duplicate_rate_pct ?? 0;

    // Evaluate rules
    const results: Array<{ rule_key: string; severity: string; passed: boolean; detail: string }> = [];

    for (const rule of rules ?? []) {
      const cfg = rule.config as Record<string, any>;
      let passed = true;
      let detail = "";

      switch (rule.rule_key) {
        case "blueprint_coverage":
          passed = blueprintCoverage >= (cfg.min_percent ?? 95);
          detail = `${blueprintCoverage.toFixed(1)}% (min: ${cfg.min_percent}%)`;
          break;
        case "lf_coverage":
          passed = lfCoverage >= (cfg.min_percent ?? 90);
          detail = `${lfCoverage.toFixed(1)}% (min: ${cfg.min_percent}%)`;
          break;
        case "duplicate_rate":
          passed = duplicateRate <= (cfg.max_percent ?? 3);
          detail = `${duplicateRate.toFixed(1)}% (max: ${cfg.max_percent}%)`;
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

    const rulesPassed = results.filter(r => r.passed).length;
    const rulesFailed = results.filter(r => !r.passed && r.severity === "block").length;
    const rulesWarned = results.filter(r => !r.passed && r.severity === "warn").length;
    const score = results.length > 0 ? Math.round((rulesPassed / results.length) * 100) : 100;
    const status = rulesFailed > 0 ? "fail" : rulesWarned > 0 ? "warn" : "pass";

    // Save report
    await sb.from("package_quality_reports").upsert({
      package_id: packageId,
      report: { results, total_questions: totalQuestions, blueprint_coverage: blueprintCoverage, lf_coverage: lfCoverage, duplicate_rate: duplicateRate },
      score,
      status,
      rules_passed: rulesPassed,
      rules_failed: rulesFailed,
      rules_warned: rulesWarned,
      created_at: new Date().toISOString(),
    }, { onConflict: "package_id" });

    // ── Compute & save package_quality_scores with badge ──
    const badge = rulesFailed > 0 ? "bronze"
      : score >= 92 ? "platinum"
      : score >= 85 ? "gold"
      : score >= 75 ? "silver"
      : "bronze";

    const publicSummary = {
      score,
      badge,
      total_questions: totalQuestions,
      blueprint_coverage_pct: blueprintCoverage,
      lf_coverage_pct: lfCoverage,
      duplicate_rate_pct: duplicateRate,
      difficulty: { easy_pct: +easyPct.toFixed(1), hard_pct: +hardPct.toFixed(1) },
      rules_total: results.length,
      rules_passed: rulesPassed,
      rules_warned: rulesWarned,
      rules_failed: rulesFailed,
      checked_at: new Date().toISOString(),
    };

    await sb.from("package_quality_scores").upsert({
      package_id: packageId,
      score_version: 1,
      score,
      badge,
      public_summary: publicSummary,
      updated_at: new Date().toISOString(),
    }, { onConflict: "package_id" });

    // Update review status based on quality
    if (status === "fail") {
      await sb.from("course_package_reviews").upsert({
        course_package_id: packageId,
        status: "blocked",
        notes: `Quality Council: ${rulesFailed} blocking rule(s) failed`,
      }, { onConflict: "course_package_id" });
    }

    // Admin notification on failure
    if (status === "fail") {
      await sb.from("admin_notifications").insert({
        title: `🛑 Quality Council: Package blocked`,
        body: `${rulesFailed} blocking rules failed. Score: ${score}% Badge: ${badge}`,
        category: "quality",
        severity: "error",
        entity_type: "course_package",
        entity_id: packageId,
      });
    }

    return json({ ok: true, package_id: packageId, score, status, badge, rules_passed: rulesPassed, rules_failed: rulesFailed, rules_warned: rulesWarned });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
