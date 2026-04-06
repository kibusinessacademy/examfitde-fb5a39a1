import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { QC_COVERAGE_ELIGIBLE } from "../_shared/qc-status.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    // Auth check
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authErr } = await userClient.auth.getUser();
    if (authErr || !user) return json({ error: "Unauthorized" }, 401);

    const sb = createClient(supabaseUrl, serviceKey);

    const url = new URL(req.url);
    const packageId = url.searchParams.get("package_id");
    const curriculumId = url.searchParams.get("curriculum_id");

    if (!packageId && !curriculumId) {
      return json({ error: "package_id or curriculum_id required" }, 400);
    }

    // Resolve package → curriculum if needed
    let targetCurriculumId = curriculumId;
    let targetPackageId = packageId;
    if (packageId && !curriculumId) {
      const { data: pkg } = await sb.from("course_packages").select("curriculum_id").eq("id", packageId).single();
      targetCurriculumId = pkg?.curriculum_id;
    }

    if (!targetCurriculumId) return json({ error: "Could not resolve curriculum" }, 400);

    // Fetch all data in parallel
    const [questionsRes, blueprintsRes, lfsRes, currRes] = await Promise.all([
      sb.from("exam_questions")
        .select("id, learning_field_id, cognitive_level, bloom_level_validated, scenario_type, exam_part, time_estimate_seconds, typical_errors, item_difficulty, item_discrimination, discrimination_tier, normalized_hash, status, competency_id")
        .eq("curriculum_id", targetCurriculumId)
        .in("status", [...QC_COVERAGE_ELIGIBLE, "pending"] as string[])
        .limit(5000),
      sb.from("question_blueprints")
        .select("id, learning_field_id, exam_context_type, typical_errors, bloom_level")
        .eq("curriculum_id", targetCurriculumId)
        .limit(3000),
      sb.from("learning_fields")
        .select("id, title, exam_part, weight_percent, bloom_distribution_target, exam_time_minutes, question_target")
        .eq("curriculum_id", targetCurriculumId)
        .limit(100),
      sb.from("curricula")
        .select("id, exam_structure, passing_rules")
        .eq("id", targetCurriculumId)
        .single(),
    ]);

    const questions = questionsRes.data || [];
    const blueprints = blueprintsRes.data || [];
    const lfs = lfsRes.data || [];
    const curriculum = currRes.data;

    const approved = questions.filter((q: any) => q.status === "approved" || q.status === "tier1_passed");

    // ── 1. Bloom-Score: Ist vs. Soll per LF ──
    const bloomScore = computeBloomScore(approved, lfs);

    // ── 2. Transfer-Score: % case-based ──
    const transferScore = computeTransferScore(approved);

    // ── 3. Fehlerdichte: Ø typical_errors per Blueprint ──
    const errorDensity = computeErrorDensity(blueprints);

    // ── 4. Redundanz-Score: normalized_hash clustering ──
    const redundancyScore = computeRedundancyScore(approved);

    // ── 5. Difficulty-Drift ──
    const difficultyDrift = computeDifficultyDrift(approved);

    // ── 6. Discrimination-Index ──
    const discriminationIndex = computeDiscriminationIndex(approved);

    // ── 7. Exam-Part-Balance ──
    const examPartBalance = computeExamPartBalance(approved, curriculum);

    // Overall health score (0-100)
    const overallScore = Math.round(
      bloomScore.score * 0.20 +
      transferScore.score * 0.15 +
      errorDensity.score * 0.10 +
      (100 - redundancyScore.redundancy_pct) * 0.10 +
      difficultyDrift.score * 0.15 +
      discriminationIndex.score * 0.15 +
      examPartBalance.score * 0.15
    );

    return json({
      ok: true,
      curriculum_id: targetCurriculumId,
      package_id: targetPackageId,
      total_questions: questions.length,
      approved_questions: approved.length,
      overall_score: overallScore,
      metrics: {
        bloom_score: bloomScore,
        transfer_score: transferScore,
        error_density: errorDensity,
        redundancy_score: redundancyScore,
        difficulty_drift: difficultyDrift,
        discrimination_index: discriminationIndex,
        exam_part_balance: examPartBalance,
      },
      per_lf: lfs.map((lf: any) => {
        const lfQuestions = approved.filter((q: any) => q.learning_field_id === lf.id);
        const lfBlueprints = blueprints.filter((b: any) => b.learning_field_id === lf.id);
        return {
          lf_id: lf.id,
          lf_title: lf.title,
          exam_part: lf.exam_part,
          question_count: lfQuestions.length,
          question_target: lf.question_target,
          bloom: computeBloomDistribution(lfQuestions),
          bloom_target: lf.bloom_distribution_target,
          case_based_pct: lfQuestions.length > 0
            ? Math.round(lfQuestions.filter((q: any) => q.scenario_type && q.scenario_type !== "isolated_knowledge").length / lfQuestions.length * 100)
            : 0,
          avg_discrimination: lfQuestions.length > 0
            ? +(lfQuestions.reduce((a: number, q: any) => a + (q.item_discrimination || 0), 0) / lfQuestions.length).toFixed(3)
            : null,
          blueprint_error_density: lfBlueprints.length > 0
            ? +(lfBlueprints.reduce((a: number, b: any) => a + (Array.isArray(b.typical_errors) ? b.typical_errors.length : 0), 0) / lfBlueprints.length).toFixed(1)
            : 0,
        };
      }),
    });
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

// ── Helper Functions ──

function computeBloomDistribution(questions: any[]) {
  const dist: Record<string, number> = { remember: 0, understand: 0, apply: 0, analyze: 0, evaluate: 0 };
  for (const q of questions) {
    const bl = (q.bloom_level_validated || q.cognitive_level || "").toLowerCase();
    if (bl in dist) dist[bl]++;
  }
  const total = questions.length || 1;
  return Object.fromEntries(Object.entries(dist).map(([k, v]) => [k, +(v / total).toFixed(3)]));
}

function computeBloomScore(questions: any[], lfs: any[]) {
  if (questions.length === 0) return { score: 0, details: [] };
  let totalDrift = 0;
  let lfCount = 0;
  const details: any[] = [];

  for (const lf of lfs) {
    const lfQ = questions.filter((q: any) => q.learning_field_id === lf.id);
    if (lfQ.length < 5) continue;
    lfCount++;
    const actual = computeBloomDistribution(lfQ);
    const target = lf.bloom_distribution_target || { remember: 0.15, understand: 0.25, apply: 0.30, analyze: 0.20, evaluate: 0.10 };
    let drift = 0;
    for (const key of Object.keys(target)) {
      drift += Math.abs((actual[key] || 0) - (target[key] || 0));
    }
    totalDrift += drift;
    details.push({ lf_id: lf.id, lf_title: lf.title, actual, target, drift: +drift.toFixed(3) });
  }

  const avgDrift = lfCount > 0 ? totalDrift / lfCount : 0;
  // Score: 100 at 0 drift, 0 at 1.0 drift
  const score = Math.max(0, Math.round((1 - avgDrift) * 100));
  return { score, avg_drift: +avgDrift.toFixed(3), details };
}

function computeTransferScore(questions: any[]) {
  if (questions.length === 0) return { score: 0, case_based_pct: 0 };
  const caseBased = questions.filter((q: any) => q.scenario_type && q.scenario_type !== "isolated_knowledge").length;
  const pct = Math.round(caseBased / questions.length * 100);
  // Target: 30%+ = 100, 0% = 0
  const score = Math.min(100, Math.round(pct / 30 * 100));
  return { score, case_based_pct: pct, case_based_count: caseBased, total: questions.length };
}

function computeErrorDensity(blueprints: any[]) {
  if (blueprints.length === 0) return { score: 0, avg_errors: 0 };
  const totalErrors = blueprints.reduce((a: number, b: any) => a + (Array.isArray(b.typical_errors) ? b.typical_errors.length : 0), 0);
  const avg = totalErrors / blueprints.length;
  const withErrors = blueprints.filter((b: any) => Array.isArray(b.typical_errors) && b.typical_errors.length >= 2).length;
  const coverage = withErrors / blueprints.length;
  // Score: 100 if avg >= 3 and coverage >= 0.8
  const score = Math.min(100, Math.round((Math.min(avg / 3, 1) * 0.5 + Math.min(coverage / 0.8, 1) * 0.5) * 100));
  return { score, avg_errors: +avg.toFixed(1), coverage_pct: Math.round(coverage * 100), with_errors: withErrors, total: blueprints.length };
}

function computeRedundancyScore(questions: any[]) {
  if (questions.length === 0) return { score: 100, redundancy_pct: 0 };
  const hashes = questions.map((q: any) => q.normalized_hash).filter(Boolean);
  const unique = new Set(hashes).size;
  const duplicates = hashes.length - unique;
  const pct = hashes.length > 0 ? Math.round(duplicates / hashes.length * 100) : 0;
  return { redundancy_pct: pct, duplicates, hashed: hashes.length, unique };
}

function computeDifficultyDrift(questions: any[]) {
  if (questions.length === 0) return { score: 0, distribution: {} };
  const dist: Record<string, number> = { easy: 0, medium: 0, hard: 0, elite: 0 };
  for (const q of questions) {
    const d = q.item_difficulty ?? 0.5;
    if (d < 0.3) dist.easy++;
    else if (d < 0.6) dist.medium++;
    else if (d < 0.8) dist.hard++;
    else dist.elite++;
  }
  const total = questions.length;
  const pcts = Object.fromEntries(Object.entries(dist).map(([k, v]) => [k, Math.round(v / total * 100)]));
  // Target: easy <= 15%, medium ~40%, hard ~35%, elite ~10%
  const target = { easy: 15, medium: 40, hard: 35, elite: 10 };
  let drift = 0;
  for (const key of Object.keys(target)) {
    drift += Math.abs((pcts[key] || 0) - (target as any)[key]);
  }
  const score = Math.max(0, Math.round((1 - drift / 200) * 100));
  return { score, distribution: pcts, target, drift: Math.round(drift) };
}

function computeDiscriminationIndex(questions: any[]) {
  if (questions.length === 0) return { score: 0, avg: 0 };
  const withDisc = questions.filter((q: any) => q.item_discrimination != null);
  if (withDisc.length === 0) return { score: 50, avg: null, coverage: 0, note: "No discrimination data" };
  const avg = withDisc.reduce((a: number, q: any) => a + q.item_discrimination, 0) / withDisc.length;
  const weak = withDisc.filter((q: any) => q.item_discrimination < 0.20).length;
  const elite = withDisc.filter((q: any) => q.item_discrimination >= 0.40).length;
  // Score: 100 if avg >= 0.35 and weak < 10%
  const weakPct = weak / withDisc.length;
  const score = Math.min(100, Math.round(
    (Math.min(avg / 0.35, 1) * 0.6 + Math.max(0, 1 - weakPct / 0.1) * 0.4) * 100
  ));
  return {
    score, avg: +avg.toFixed(3),
    weak_count: weak, weak_pct: Math.round(weakPct * 100),
    elite_count: elite, elite_pct: Math.round(elite / withDisc.length * 100),
    coverage: withDisc.length,
  };
}

function computeExamPartBalance(questions: any[], curriculum: any) {
  const parts: Record<string, number> = {};
  for (const q of questions) {
    const ep = q.exam_part || "unknown";
    parts[ep] = (parts[ep] || 0) + 1;
  }

  const examStructure = curriculum?.exam_structure;
  if (!examStructure?.parts || !Array.isArray(examStructure.parts)) {
    // No target → just return distribution
    const total = questions.length || 1;
    return {
      score: 50,
      distribution: Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, { count: v, pct: Math.round(v / total * 100) }])),
      note: "No exam_structure defined",
    };
  }

  const total = questions.length || 1;
  let drift = 0;
  const dist: any = {};
  for (const part of examStructure.parts) {
    const actual = (parts[part.key] || 0) / total * 100;
    const target = part.weight_pct || 0;
    drift += Math.abs(actual - target);
    dist[part.key] = { count: parts[part.key] || 0, actual_pct: Math.round(actual), target_pct: target };
  }
  const score = Math.max(0, Math.round((1 - drift / 200) * 100));
  return { score, distribution: dist, drift: Math.round(drift) };
}
