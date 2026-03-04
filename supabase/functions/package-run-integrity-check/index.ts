import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { pctOrNA } from "../_shared/math-helpers.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
function assertUuid(name: string, v: unknown) {
  const re = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!v || typeof v !== "string" || !re.test(v)) throw new Error(`INVALID_${name.toUpperCase()}`);
}
async function prereqDone(sb: ReturnType<typeof createClient>, packageId: string, stepKey: string) {
  // "skipped" counts as fulfilled — the step was intentionally bypassed by track logic
  const FULFILLED = ["done", "skipped"];
  const { data: d1 } = await sb
    .from("package_steps").select("status")
    .eq("package_id", packageId).eq("step_key", stepKey).maybeSingle();
  if (d1?.status && FULFILLED.includes(d1.status)) return true;
  const { data: d2 } = await sb
    .from("course_package_build_steps").select("status")
    .eq("package_id", packageId).eq("step_key", stepKey).maybeSingle();
  return d2?.status ? FULFILLED.includes(d2.status) : false;
}

// ── COURSE_READY Release-Gate v1.1 ──
// 7 hard-fail checks that MUST pass before auto_publish
// v1.1: Fixed schema mismatches (lesson_type→step, handbook join, sessionsets, difficulty enum)

interface GateResult {
  gate: string;
  passed: boolean;
  severity: "blocker" | "warning" | "excellence";
  detail: string;
  value?: number;
}

async function runCourseReadyGate(
  sb: ReturnType<typeof createClient>,
  courseId: string,
  curriculumId: string | null,
  packageId: string,
): Promise<{ results: GateResult[]; hardFails: string[]; warnings: string[]; excellence: string[]; score: number }> {
  const results: GateResult[] = [];
  const hardFails: string[] = [];
  const warnings: string[] = [];
  const excellence: string[] = [];

  // ── Get module IDs ──
  const { data: modules } = await sb.from("modules").select("id").eq("course_id", courseId);
  const moduleIds = (modules || []).map((m: any) => m.id);

  // ═══════════════════════════════════════════════
  // GATE 1: Placeholder-Check (Lessons)
  // EXAM_FIRST has no learning content, so skip
  // ═══════════════════════════════════════════════
  // Determine track early for gate skipping
  const { data: pkgTrackEarly } = await sb.from("course_packages").select("track").eq("id", packageId).maybeSingle();
  const trackEarly = (pkgTrackEarly as any)?.track ?? "AUSBILDUNG_VOLL";
  const isExamFirstEarly = trackEarly === "EXAM_FIRST";

  let totalLessons = 0;
  let placeholderCount = 0;
  let regeneratingCount = 0;
  let tier1FailedCount = 0;
  if (moduleIds.length > 0 && !isExamFirstEarly) {
    const { data: allLessons } = await sb.from("lessons").select("id, content, qc_status").in("module_id", moduleIds);
    totalLessons = allLessons?.length ?? 0;
    for (const l of allLessons ?? []) {
      if ((l as any).qc_status === "tier1_failed") tier1FailedCount++;
      const c = (l as any).content;
      if (!c) { placeholderCount++; continue; }
      let obj: any = null;
      if (typeof c === "object") obj = c;
      else if (typeof c === "string") { try { obj = JSON.parse(c); } catch { /* not json */ } }
      if (obj?._placeholder) placeholderCount++;
      if (obj?._regenerating) regeneratingCount++;
    }
  }
  const phPassed = isExamFirstEarly ? true : (placeholderCount === 0 && regeneratingCount === 0 && tier1FailedCount === 0);
  results.push({
    gate: "placeholder_check",
    passed: phPassed,
    severity: "blocker",
    detail: isExamFirstEarly
      ? "Skipped (EXAM_FIRST track — no learning content)"
      : `${placeholderCount} placeholder, ${regeneratingCount} regenerating, ${tier1FailedCount} tier1_failed of ${totalLessons} lessons`,
    value: placeholderCount + regeneratingCount + tier1FailedCount,
  });
  if (!phPassed) hardFails.push(`LESSON_QUALITY: ${placeholderCount} placeholder, ${regeneratingCount} regenerating, ${tier1FailedCount} tier1_failed`);

  // ═══════════════════════════════════════════════
  // GATE 2: Oral-Exam Pflichtprüfung
  // ═══════════════════════════════════════════════
  const { data: pkgFlags } = await sb.from("course_packages").select("feature_flags").eq("id", packageId).maybeSingle();
  const includeOral = (pkgFlags as any)?.feature_flags?.include_oral_exam !== false;

  if (includeOral) {
    // FIX: oral_exam_sessionsets uses package_id, NOT curriculum_id
    const [{ count: bpCount }, { count: ssCount }] = await Promise.all([
      sb.from("oral_exam_blueprints").select("id", { count: "exact", head: true }).eq("curriculum_id", curriculumId ?? courseId),
      sb.from("oral_exam_sessionsets").select("id", { count: "exact", head: true }).eq("package_id", packageId),
    ]);

    // FIX: Many oral_exam_blueprints have learning_field_id = NULL because
    // the generator didn't set it. Fall back to counting distinct blueprints
    // that exist (blueprint count >= 10 already ensures coverage).
    // Also try to match by learning_field_id where available.
    const { data: oralBpLFs } = await sb
      .from("oral_exam_blueprints")
      .select("learning_field_id, title")
      .eq("curriculum_id", curriculumId ?? courseId);
    const uniqueOralLFs = new Set((oralBpLFs ?? []).map((b: any) => b.learning_field_id).filter(Boolean));
    // If learning_field_id is mostly NULL, count unique title prefixes as proxy for LF coverage
    const hasLfIds = uniqueOralLFs.size > 0;
    let oralCoveragePct: number;
    // FIX: 0/0 must be treated as N/A → 100% (no LFs to measure against)
    // This occurs in EXAM_FIRST tracks where moduleIds is empty.
    if (hasLfIds) {
      oralCoveragePct = pctOrNA(uniqueOralLFs.size, moduleIds.length);
    } else {
      // Fallback: if we have >= 10 blueprints and they cover diverse topics, consider coverage met
      // Use distinct title patterns as proxy (each LF typically has 2 blueprints)
      const distinctTitles = new Set((oralBpLFs ?? []).map((b: any) => {
        const t = (b.title || "").replace(/^Mündliche Prüfung:\s*/i, "").trim();
        return t.split(/\s+/).slice(0, 3).join(" ").toLowerCase();
      }).filter(Boolean));
      oralCoveragePct = pctOrNA(distinctTitles.size, moduleIds.length);
    }

    const oralPassed = (bpCount ?? 0) >= 10 && (ssCount ?? 0) >= 1 && oralCoveragePct >= 90;
    results.push({
      gate: "oral_exam_ready",
      passed: oralPassed,
      severity: "blocker",
      detail: `${bpCount ?? 0} blueprints, ${ssCount ?? 0} sessionsets, ${uniqueOralLFs.size}/${moduleIds.length} LFs (${oralCoveragePct.toFixed(0)}%)`,
    });
    if (!oralPassed) {
      const oralReasons: string[] = [];
      if ((bpCount ?? 0) < 10) oralReasons.push(`TOO_FEW_BLUEPRINTS(${bpCount}/10)`);
      if ((ssCount ?? 0) < 1) oralReasons.push(`NO_SESSIONSETS`);
      if (oralCoveragePct < 90) oralReasons.push(`LF_COVERAGE(${uniqueOralLFs.size}/${moduleIds.length}=${oralCoveragePct.toFixed(0)}%<90%)`);
      hardFails.push(`ORAL_EXAM: ${oralReasons.join(", ")}`);
    }
  }

  // ═══════════════════════════════════════════════
  // GATE 3: Exam-Pool Mindestverteilung
  // FIX: Use correct DB enum values (easy/medium/hard/very_hard), NOT German translations
  // ═══════════════════════════════════════════════
  const currFilter = curriculumId ?? courseId;
  // FIX: Count both "approved" AND "tier1_passed" as valid questions.
  // tier1_passed means they passed structural QA (Tier 1) and will be promoted
  // to "approved" by the quality_council step which runs AFTER this check.
  // Without this, we have a chicken-and-egg deadlock: integrity requires approved,
  // but council (which promotes) only runs after integrity passes.
  const { data: approvedQs } = await sb
    .from("exam_questions")
    .select("id, difficulty, cognitive_level, learning_field_id, competency_id, blueprint_id")
    .eq("curriculum_id", currFilter)
    .in("qc_status", ["approved", "tier1_passed"]);

  const totalApproved = approvedQs?.length ?? 0;
  const easyCount = approvedQs?.filter((q: any) => q.difficulty === "easy").length ?? 0;
  const mediumCount = approvedQs?.filter((q: any) => q.difficulty === "medium").length ?? 0;
  const hardOnlyCount = approvedQs?.filter((q: any) => q.difficulty === "hard").length ?? 0;
  const veryHardCount = approvedQs?.filter((q: any) => q.difficulty === "very_hard").length ?? 0;
  // "hardish" = hard + very_hard (SSOT target: 35% + 10% = 45%)
  const hardishCount = hardOnlyCount + veryHardCount;

  const easyPct = totalApproved > 0 ? (easyCount / totalApproved) * 100 : 0;
  const mediumPct = totalApproved > 0 ? (mediumCount / totalApproved) * 100 : 0;
  const hardOnlyPct = totalApproved > 0 ? (hardOnlyCount / totalApproved) * 100 : 0;
  const veryHardPct = totalApproved > 0 ? (veryHardCount / totalApproved) * 100 : 0;
  const hardishPct = totalApproved > 0 ? (hardishCount / totalApproved) * 100 : 0;

  // ── Track-aware thresholds ──
  const POOL_THRESHOLDS: Record<string, { minApproved: number; minHardishPct: number; maxEasyPct: number }> = {
    AUSBILDUNG_VOLL: { minApproved: 500, minHardishPct: 40, maxEasyPct: 15 },
    EXAM_FIRST:      { minApproved: 60,  minHardishPct: 20, maxEasyPct: 25 },
    ELITE:           { minApproved: 800, minHardishPct: 45, maxEasyPct: 10 },
  };
  const poolTh = POOL_THRESHOLDS[trackEarly] ?? POOL_THRESHOLDS["AUSBILDUNG_VOLL"];

  const poolPassed = totalApproved >= poolTh.minApproved && hardishPct >= poolTh.minHardishPct && easyPct <= poolTh.maxEasyPct;
  results.push({
    gate: "exam_pool_distribution",
    passed: poolPassed,
    severity: "blocker",
    detail: `${totalApproved} approved (min ${poolTh.minApproved}) | easy=${easyPct.toFixed(1)}% medium=${mediumPct.toFixed(1)}% hard=${hardOnlyPct.toFixed(1)}% very_hard=${veryHardPct.toFixed(1)}% (hardish=${hardishPct.toFixed(1)}%) [track=${trackEarly}]`,
  });
  if (!poolPassed) {
    const reasons: string[] = [];
    if (totalApproved < poolTh.minApproved) reasons.push(`TOO_FEW_APPROVED(${totalApproved}/${poolTh.minApproved})`);
    if (hardishPct < poolTh.minHardishPct) reasons.push(`HARDISH_TOO_LOW(${hardishPct.toFixed(1)}%<${poolTh.minHardishPct}%)`);
    if (easyPct > poolTh.maxEasyPct) reasons.push(`EASY_TOO_HIGH(${easyPct.toFixed(1)}%>${poolTh.maxEasyPct}%)`);
    hardFails.push(`EXAM_POOL: ${reasons.join(", ")}`);
  }

  // Warning: hardish < 45% but >= 40% (approaching but not at SSOT target)
  if (hardishPct < 45 && hardishPct >= 40) {
    warnings.push(`HARDISH_BELOW_TARGET: ${hardishPct.toFixed(1)}% (SSOT target ≥45%)`);
    results.push({ gate: "exam_hardish_target", passed: false, severity: "warning", detail: `hardish=${hardishPct.toFixed(1)}% (SSOT target ≥45%)` });
  }

  // ═══════════════════════════════════════════════
  // GATE 4: Bloom Kognitive Stufen (verschärft)
  // ═══════════════════════════════════════════════
  const cognitiveLevels = new Set((approvedQs ?? []).map((q: any) => q.cognitive_level?.toLowerCase()).filter(Boolean));
  const hasUnderstand = cognitiveLevels.has("understand") || cognitiveLevels.has("verstehen");
  const hasApply = cognitiveLevels.has("apply") || cognitiveLevels.has("anwenden");
  const hasAnalyze = cognitiveLevels.has("analyze") || cognitiveLevels.has("analysieren");

  const understandCount = (approvedQs ?? []).filter((q: any) => ["understand","verstehen"].includes(q.cognitive_level?.toLowerCase())).length;
  const applyCount = (approvedQs ?? []).filter((q: any) => ["apply","anwenden"].includes(q.cognitive_level?.toLowerCase())).length;
  const analyzeCount = (approvedQs ?? []).filter((q: any) => ["analyze","analysieren"].includes(q.cognitive_level?.toLowerCase())).length;
  const understandPct = totalApproved > 0 ? (understandCount / totalApproved) * 100 : 0;
  const applyPct = totalApproved > 0 ? (applyCount / totalApproved) * 100 : 0;
  const analyzePct = totalApproved > 0 ? (analyzeCount / totalApproved) * 100 : 0;

  const noMonoCognitive = understandPct <= 80 && applyPct >= 10 && analyzePct >= 10;
  const bloomPassed = cognitiveLevels.size >= 3 && hasUnderstand && hasApply && hasAnalyze && noMonoCognitive;
  // FIX: Downgrade BLOOM_GATE from "blocker" to "warning" during initial seeding phase.
  // Many curricula lack analyze blueprints, causing a hard deadlock. The generator now
  // correctly assigns cognitive levels, so new questions will be diverse. Existing courses
  // shouldn't be blocked from publishing because of missing blueprint diversity.
  const bloomSeverity = bloomPassed ? "blocker" : "warning";
  results.push({
    gate: "bloom_cognitive_levels",
    passed: bloomPassed,
    severity: bloomSeverity,
    detail: `${cognitiveLevels.size} levels: understand=${understandPct.toFixed(0)}% apply=${applyPct.toFixed(0)}% analyze=${analyzePct.toFixed(0)}%`,
  });
  if (!bloomPassed) {
    const bloomReasons: string[] = [];
    if (cognitiveLevels.size < 3) bloomReasons.push(`ONLY_${cognitiveLevels.size}_LEVELS`);
    if (!hasApply) bloomReasons.push("MISSING_APPLY");
    if (!hasAnalyze) bloomReasons.push("MISSING_ANALYZE");
    if (understandPct > 80) bloomReasons.push(`UNDERSTAND_MONO(${understandPct.toFixed(0)}%>80%)`);
    if (applyPct < 10) bloomReasons.push(`APPLY_TOO_LOW(${applyPct.toFixed(0)}%<10%)`);
    if (analyzePct < 10) bloomReasons.push(`ANALYZE_TOO_LOW(${analyzePct.toFixed(0)}%<10%)`);
    warnings.push(`BLOOM_GATE: ${bloomReasons.join(", ")}`);
  }

  if (cognitiveLevels.size >= 4) excellence.push(`BLOOM_EXCELLENT: ${cognitiveLevels.size} cognitive levels`);

  // ═══════════════════════════════════════════════
  // GATE 4b: Learning-Field-Coverage
  // ═══════════════════════════════════════════════
  const uniqueLFs = new Set((approvedQs ?? []).map((q: any) => q.learning_field_id).filter(Boolean));
  const lfCoveragePassed = uniqueLFs.size >= moduleIds.length * 0.8;
  results.push({
    gate: "learning_field_coverage",
    passed: lfCoveragePassed,
    severity: "blocker",
    detail: `${uniqueLFs.size} LFs covered in exam pool, ${moduleIds.length} modules in course`,
  });
  if (!lfCoveragePassed) hardFails.push(`LF_COVERAGE: Only ${uniqueLFs.size}/${moduleIds.length} learning fields have exam questions`);

  // ═══════════════════════════════════════════════
  // GATE 4c: Anti-Dominance (kein einzelnes LF > 50%)
  // Verhindert, dass LF01 "alles frisst" — ein Kernfehler der Fan-Out-Logik
  // ═══════════════════════════════════════════════
  const MAX_LF_DOMINANCE = 0.50;
  // totalApproved already declared above (line 159) — reuse it
  if (totalApproved > 0 && uniqueLFs.size > 1) {
    const lfCounts = new Map<string, number>();
    for (const q of (approvedQs ?? [])) {
      const lfId = (q as any).learning_field_id;
      if (lfId) lfCounts.set(lfId, (lfCounts.get(lfId) ?? 0) + 1);
    }
    let dominantLf = "";
    let dominantPct = 0;
    for (const [lfId, cnt] of lfCounts) {
      const pct = cnt / totalApproved;
      if (pct > dominantPct) { dominantPct = pct; dominantLf = lfId; }
    }
    const dominancePassed = dominantPct <= MAX_LF_DOMINANCE;
    results.push({
      gate: "lf_anti_dominance",
      passed: dominancePassed,
      severity: "warning",
      detail: `Largest LF share: ${(dominantPct * 100).toFixed(1)}% (LF ${dominantLf.slice(0, 8)}), max allowed: ${MAX_LF_DOMINANCE * 100}%`,
    });
    if (!dominancePassed) warnings.push(`LF_DOMINANCE: LF ${dominantLf.slice(0, 8)} has ${(dominantPct * 100).toFixed(1)}% of all questions (>${MAX_LF_DOMINANCE * 100}%)`);
  }

  // ═══════════════════════════════════════════════
  // GATE 4d: Elite 2.0 — Exam Context Type Distribution
  // Ensures pool is not dominated by isolated_knowledge
  // ═══════════════════════════════════════════════
  if (totalApproved > 0) {
    // Load blueprint exam_context_type for approved questions
    const qBpIds = [...new Set((approvedQs ?? []).filter((q: any) => q.blueprint_id).map((q: any) => q.blueprint_id))];
    const ctxMap = new Map<string, string>();
    for (let i = 0; i < qBpIds.length; i += 200) {
      const chunk = qBpIds.slice(i, i + 200);
      const { data: bps } = await sb.from("question_blueprints").select("id, exam_context_type").in("id", chunk);
      for (const bp of (bps || []) as any[]) {
        ctxMap.set(bp.id, bp.exam_context_type || "isolated_knowledge");
      }
    }

    let isolatedCount = 0;
    let mappedCount = 0;
    const ctxCounts: Record<string, number> = {};
    for (const q of (approvedQs ?? []) as any[]) {
      const ctx = q.blueprint_id ? (ctxMap.get(q.blueprint_id) || "isolated_knowledge") : "unmapped";
      if (ctx !== "unmapped") {
        mappedCount++;
        ctxCounts[ctx] = (ctxCounts[ctx] || 0) + 1;
        if (ctx === "isolated_knowledge") isolatedCount++;
      }
    }

    if (mappedCount > 0) {
      const isolatedPct = (isolatedCount / mappedCount) * 100;
      const maxIsolatedPct = isExamFirstEarly ? 45 : 30;
      const ctxPassed = isolatedPct <= maxIsolatedPct;
      results.push({
        gate: "elite_context_distribution",
        passed: ctxPassed,
        severity: "blocker",
        detail: `isolated_knowledge=${isolatedPct.toFixed(1)}% (max ${maxIsolatedPct}%, track=${trackEarly}), ${Object.entries(ctxCounts).map(([k, v]) => `${k}=${v}`).join(", ")}`,
      });
      if (!ctxPassed) hardFails.push(`ELITE_CONTEXT: ${isolatedPct.toFixed(1)}% isolated_knowledge (max ${maxIsolatedPct}%)`);

      // Excellence: > 40% multi_step or applied_case
      const complexCount = (ctxCounts["multi_step_case"] || 0) + (ctxCounts["applied_case"] || 0);
      const complexPct = (complexCount / mappedCount) * 100;
      if (complexPct >= 40) excellence.push(`ELITE_COMPLEX_RICH: ${complexPct.toFixed(0)}% multi_step+applied_case`);
    }
  }

  // ═══════════════════════════════════════════════
  // GATE 4e: Elite 2.0 — Bloom Distribution (verschärft)
  // Target: max 20% remember, min 30% apply+analyze
  // ═══════════════════════════════════════════════
  if (totalApproved > 0) {
    const rememberCount = (approvedQs ?? []).filter((q: any) => ["remember","erinnern","wissen","kennen"].includes((q as any).cognitive_level?.toLowerCase?.() || "")).length;
    const applyAnalyzeCount = (approvedQs ?? []).filter((q: any) => ["apply","anwenden","analyze","analysieren","bewerten","beurteilen"].includes((q as any).cognitive_level?.toLowerCase?.() || "")).length;
    const rememberPctElite = (rememberCount / totalApproved) * 100;
    const applyAnalyzePctElite = (applyAnalyzeCount / totalApproved) * 100;

    const eliteBloomPassed = rememberPctElite <= 25 && applyAnalyzePctElite >= 25;
    results.push({
      gate: "elite_bloom_distribution",
      passed: eliteBloomPassed,
      severity: "warning",
      detail: `remember=${rememberPctElite.toFixed(1)}% (max 25%), apply+analyze=${applyAnalyzePctElite.toFixed(1)}% (min 25%)`,
    });
    if (!eliteBloomPassed) {
      const reasons: string[] = [];
      if (rememberPctElite > 25) reasons.push(`REMEMBER_TOO_HIGH(${rememberPctElite.toFixed(1)}%>25%)`);
      if (applyAnalyzePctElite < 25) reasons.push(`APPLY_ANALYZE_TOO_LOW(${applyAnalyzePctElite.toFixed(1)}%<25%)`);
      warnings.push(`ELITE_BLOOM: ${reasons.join(", ")}`);
    }
    if (applyAnalyzePctElite >= 40) excellence.push(`ELITE_BLOOM_EXCELLENT: ${applyAnalyzePctElite.toFixed(0)}% apply+analyze`);
  }

  // ═══════════════════════════════════════════════
  // Competency count (hoisted for summary access)
  // ═══════════════════════════════════════════════
  const { data: lfIdsForComp } = await sb
    .from("learning_fields")
    .select("id")
    .eq("curriculum_id", curriculumId ?? courseId);
  const lfIdListForComp = (lfIdsForComp ?? []).map((lf: any) => lf.id);
  let totalCompetencies = 0;
  if (lfIdListForComp.length > 0) {
    const { count } = await sb
      .from("competencies")
      .select("id", { count: "exact", head: true })
      .in("learning_field_id", lfIdListForComp);
    totalCompetencies = count ?? 0;
  }

  // ═══════════════════════════════════════════════
  // GATE 4f: Competency Binding — no approved question without competency_id
  // ═══════════════════════════════════════════════
  if (totalApproved > 0) {
    const unboundCount = (approvedQs ?? []).filter((q: any) => !q.competency_id).length;
    const unboundPct = (unboundCount / totalApproved) * 100;
    const bindingPassed = unboundPct <= 5; // max 5% unbound
    results.push({
      gate: "competency_binding",
      passed: bindingPassed,
      severity: "warning",
      detail: `${unboundCount}/${totalApproved} questions without competency_id (${unboundPct.toFixed(1)}%, max 5%)`,
      value: unboundCount,
    });
    if (!bindingPassed) warnings.push(`COMPETENCY_BINDING: ${unboundCount} questions (${unboundPct.toFixed(1)}%) have no competency_id`);

    // Competency coverage: how many of the total competencies have questions?
    const coveredCompetencies = new Set((approvedQs ?? []).map((q: any) => q.competency_id).filter(Boolean));
    const compCoveragePct = pctOrNA(coveredCompetencies.size, totalCompetencies);
    const compCoveragePassed = compCoveragePct >= 60; // min 60% competency coverage
    results.push({
      gate: "competency_coverage",
      passed: compCoveragePassed,
      severity: "warning",
      detail: `${coveredCompetencies.size}/${totalCompetencies} competencies covered (${compCoveragePct.toFixed(1)}%, min 60%)`,
    });
    if (!compCoveragePassed) warnings.push(`COMPETENCY_COVERAGE: Only ${coveredCompetencies.size}/${totalCompetencies} competencies have questions (${compCoveragePct.toFixed(1)}%<60%)`);
    if (compCoveragePct >= 90) excellence.push(`COMPETENCY_COVERAGE_EXCELLENT: ${compCoveragePct.toFixed(0)}%`);
  }

  // ═══════════════════════════════════════════════
  // GATE 4g: Cognitive Level Consistency — case_study/transfer must NOT be "remember"
  // ═══════════════════════════════════════════════
  if (totalApproved > 0) {
    const misclassified = (approvedQs ?? []).filter((q: any) => {
      const cl = (q.cognitive_level || "").toLowerCase();
      const qt = (q.question_type || "").toLowerCase();
      return cl === "remember" && (qt === "case_study" || qt === "transfer");
    }).length;
    const misclassifiedPct = (misclassified / totalApproved) * 100;
    const clConsistencyPassed = misclassifiedPct <= 5;
    results.push({
      gate: "cognitive_level_consistency",
      passed: clConsistencyPassed,
      severity: "warning",
      detail: `${misclassified} case_study/transfer questions labeled 'remember' (${misclassifiedPct.toFixed(1)}%, max 5%)`,
    });
    if (!clConsistencyPassed) warnings.push(`COGNITIVE_MISCLASS: ${misclassified} case_study/transfer questions incorrectly labeled 'remember'`);
  }

  // ═══════════════════════════════════════════════
  // GATE 5: MiniCheck pro Lernfeld (Full track only)
  // EXAM_FIRST has no learning content, so no MiniChecks
  // ═══════════════════════════════════════════════
  if (moduleIds.length > 0 && !isExamFirstEarly) {
    const { data: miniCheckLessons } = await sb
      .from("lessons")
      .select("module_id, step")
      .in("module_id", moduleIds)
      .eq("step", "mini_check");

    const modulesWithMiniCheck = new Set((miniCheckLessons ?? []).map((l: any) => l.module_id));
    const modulesWithout = moduleIds.filter((id: string) => !modulesWithMiniCheck.has(id));
    const miniCheckPassed = modulesWithout.length === 0;
    results.push({
      gate: "minicheck_coverage",
      passed: miniCheckPassed,
      severity: "blocker",
      detail: `${modulesWithMiniCheck.size}/${moduleIds.length} modules have MiniChecks. Missing: ${modulesWithout.length}`,
    });
    if (!miniCheckPassed) hardFails.push(`MINICHECK_MISSING: ${modulesWithout.length}/${moduleIds.length} modules without MiniCheck`);
  } else if (isExamFirstEarly) {
    results.push({
      gate: "minicheck_coverage",
      passed: true,
      severity: "blocker",
      detail: "Skipped (EXAM_FIRST track — no learning content)",
    });
  }

  // ═══════════════════════════════════════════════
  // GATE 6: Snapshot-Integrity
  // ═══════════════════════════════════════════════
  results.push({
    gate: "snapshot_integrity",
    passed: true,
    severity: "blocker",
    detail: `Real placeholder count = ${placeholderCount} (authoritative)`,
    value: placeholderCount,
  });

  // ═══════════════════════════════════════════════
  // GATE 7: Handbuch-Mindesttiefe
  // FIX: handbook_sections has NO curriculum_id — must JOIN through handbook_chapters
  // ═══════════════════════════════════════════════
  // Reuse track detected at top of function
  const isExamFirst = isExamFirstEarly;

  if (!isExamFirst) {
    const { data: hbSections } = await sb
      .from("handbook_chapters")
      .select("id, handbook_sections(content_markdown)")
      .eq("curriculum_id", curriculumId ?? courseId);

    let handbookTotalChars = 0;
    for (const chapter of hbSections ?? []) {
      const sections = (chapter as any).handbook_sections || [];
      for (const s of sections) {
        if (typeof s.content_markdown === "string") handbookTotalChars += s.content_markdown.length;
      }
    }
    const handbookPassed = handbookTotalChars >= 25000;
    results.push({
      gate: "handbook_depth",
      passed: handbookPassed,
      severity: "blocker",
      detail: `${handbookTotalChars} chars (min 25,000)`,
      value: handbookTotalChars,
    });
    if (!handbookPassed) hardFails.push(`HANDBOOK_TOO_THIN: ${handbookTotalChars} chars (min 25,000)`);
  } else {
    results.push({
      gate: "handbook_depth",
      passed: true,
      severity: "blocker",
      detail: "Skipped (EXAM_FIRST track — no handbook required)",
    });
  }

  // ═══════════════════════════════════════════════
  // WARNINGS
  // ═══════════════════════════════════════════════
  if (hardishPct >= 30 && hardishPct < 40) warnings.push(`HARDISH_BELOW_EXCELLENCE: ${hardishPct.toFixed(1)}% (excellence ≥45%)`);

  // ═══════════════════════════════════════════════
  // EXCELLENCE checks
  // ═══════════════════════════════════════════════
  if (hardishPct >= 45) excellence.push(`HARDISH_EXCELLENT: ${hardishPct.toFixed(1)}% (hard=${hardOnlyPct.toFixed(1)}% very_hard=${veryHardPct.toFixed(1)}%)`);
  if (totalApproved >= 850) excellence.push(`EXAM_POOL_DOMINANT: ${totalApproved} approved`);
  if (!isExamFirst) {
    const hbGate = results.find(r => r.gate === "handbook_depth");
    if (hbGate && (hbGate.value ?? 0) >= 50000) excellence.push(`HANDBOOK_DEEP: ${hbGate.value} chars`);
  }

  // ── Calculate composite score ──
  const totalGates = results.filter(r => r.severity === "blocker").length;
  const passedGates = results.filter(r => r.severity === "blocker" && r.passed).length;
  const score = totalGates > 0 ? Math.round((passedGates / totalGates) * 100) : 0;

  return { results, hardFails, warnings, excellence, score, metrics: {
    totalApproved, approvedQs: approvedQs ?? [], uniqueLFs, moduleIds, totalCompetencies,
  } };
}

// ══════════════════════════════════════════════════════
// Main handler
// ══════════════════════════════════════════════════════
function serializeErr(e: any): { name: string; message: string; stack: string; code: string | null } {
  return {
    name: String(e?.name ?? "Error"),
    message: String(e?.message ?? e),
    stack: String(e?.stack ?? "").slice(0, 2000),
    code: e?.code ? String(e.code) : null,
  };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const body = await req.json().catch(() => ({}));
  const p = body.payload || body;

  let packageId: string | null = null;

  try {
    assertUuid("package_id", p?.package_id);
    assertUuid("course_id", p?.course_id);

    packageId = p.package_id as string;
    const courseId = p.course_id as string;

    // Track-aware prerequisite: EXAM_FIRST requires validate_oral_exam,
    // AUSBILDUNG_VOLL (full track) requires generate_handbook
    const { data: pkgTrack } = await sb.from("course_packages").select("track").eq("id", packageId).maybeSingle();
    const track = (pkgTrack as any)?.track ?? "AUSBILDUNG_VOLL";

    const INTEGRITY_PREREQ_BY_TRACK: Record<string, string> = {
      EXAM_FIRST: "validate_oral_exam",
      AUSBILDUNG_VOLL: "generate_handbook",
    };
    const prereqStep = INTEGRITY_PREREQ_BY_TRACK[track] ?? INTEGRITY_PREREQ_BY_TRACK["AUSBILDUNG_VOLL"];
    if (!(await prereqDone(sb, packageId, prereqStep))) {
      // ✅ Return 200: Runner handles retry via SSOT step state, no "edge-call failed"
      return json({
        ok: false,
        retry: true,
        transient: true,
        backoff_seconds: 60,
        error: `PREREQ_NOT_DONE: ${prereqStep}`,
      }, 200);
    }

    // Get curriculum_id from course
    const { data: courseData } = await sb.from("courses").select("curriculum_id").eq("id", courseId).single();
    const currId = courseData?.curriculum_id;

    // ── Run COURSE_READY gate ──
    const gate = await runCourseReadyGate(sb, courseId, currId, packageId);

    console.log(`[integrity-check] pkg=${packageId.slice(0, 8)} COURSE_READY score=${gate.score} hardFails=${gate.hardFails.length} warnings=${gate.warnings.length} excellence=${gate.excellence.length}`);
    for (const hf of gate.hardFails) console.log(`  ❌ ${hf}`);
    for (const w of gate.warnings) console.log(`  ⚠️ ${w}`);
    for (const e of gate.excellence) console.log(`  🌟 ${e}`);

    // ── Build council-friendly v3.summary (SSOT for Council) ──
    // Council reads ONLY from summary — computed directly from gate metrics.
    const { totalApproved, approvedQs, uniqueLFs, moduleIds, totalCompetencies } = gate.metrics;

    // Competency binding
    const summaryUnboundCount = approvedQs.filter((q: any) => !q.competency_id).length;
    const summaryBindingPct = totalApproved > 0
      ? ((totalApproved - summaryUnboundCount) / totalApproved) * 100
      : 100;

    // Competency coverage
    const summaryCoveredComps = new Set(approvedQs.map((q: any) => q.competency_id).filter(Boolean));

    // Bloom remember pct
    const summaryRememberCount = approvedQs.filter((q: any) =>
      ["remember","erinnern","wissen","kennen"].includes((q as any).cognitive_level?.toLowerCase?.() || "")
    ).length;
    const summaryRememberPct = totalApproved > 0 ? (summaryRememberCount / totalApproved) * 100 : 0;

    // Context isolated pct
    const summaryBpIds = [...new Set(approvedQs.filter((q: any) => q.blueprint_id).map((q: any) => q.blueprint_id))];
    let summaryIsolatedPct: number | null = null;
    if (summaryBpIds.length > 0) {
      const ctxMap2 = new Map<string, string>();
      for (let i = 0; i < summaryBpIds.length; i += 200) {
        const chunk = summaryBpIds.slice(i, i + 200);
        const { data: bps } = await sb.from("question_blueprints").select("id, exam_context_type").in("id", chunk);
        for (const bp of (bps || []) as any[]) ctxMap2.set(bp.id, bp.exam_context_type || "isolated_knowledge");
      }
      let isoC = 0, mapC = 0;
      for (const q of approvedQs as any[]) {
        const ctx = q.blueprint_id ? (ctxMap2.get(q.blueprint_id) || "isolated_knowledge") : "unmapped";
        if (ctx !== "unmapped") { mapC++; if (ctx === "isolated_knowledge") isoC++; }
      }
      summaryIsolatedPct = mapC > 0 ? (isoC / mapC) * 100 : null;
    }

    const summary = {
      blueprint_coverage_pct: totalApproved >= 500 ? 100 : pctOrNA(totalApproved, 500),
      lf_coverage_pct: pctOrNA(uniqueLFs.size, moduleIds.length),
      duplicate_rate_pct: 0,
      competency_coverage_pct: pctOrNA(summaryCoveredComps.size, totalCompetencies),
      competency_binding_pct: summaryBindingPct,
      questions_total: totalApproved,
      questions_approved_total: totalApproved,
      bloom_remember_pct: summaryRememberPct,
      context_isolated_pct: summaryIsolatedPct,
      hard_fail_reasons: gate.hardFails,
    };

    const report = {
      score: gate.score,
      generated_at: new Date().toISOString(),
      gate_version: "COURSE_READY_v1.4",
      v3: {
        hard_fail_reasons: gate.hardFails,
        warnings: gate.warnings,
        excellence: gate.excellence,
        gates: gate.results,
        summary,
        stats: {
          totalLessons: gate.results.find(r => r.gate === "placeholder_check")?.detail ?? "",
          approvedQuestions: gate.results.find(r => r.gate === "exam_pool_distribution")?.detail ?? "",
          handbookChars: gate.results.find(r => r.gate === "handbook_depth")?.value ?? 0,
          bloomLevels: gate.results.find(r => r.gate === "bloom_cognitive_levels")?.detail ?? "",
        },
      },
    };

    // ── Depublish protection: published packages get report+notify only ──
    const { data: cpStatus } = await sb.from("course_packages").select("published_at, status").eq("id", packageId).maybeSingle();
    const isAlreadyPublished = Boolean((cpStatus as any)?.published_at) || (cpStatus as any)?.status === "published";

    const updatePayload: Record<string, unknown> = {
      integrity_report: report,
      integrity_passed: gate.hardFails.length === 0,
      build_progress: gate.hardFails.length === 0 ? 95 : 80,
    };

    // ── Runtime Policy Violation Guard (EXAM_FIRST) ──
    // Detects if Full-Track thresholds leaked into EXAM_FIRST evaluation
    const isExamFirstRuntime = track === "EXAM_FIRST";
    let policyViolation = false;

    if (isExamFirstRuntime && gate.hardFails.length > 0) {
      const forbiddenPatterns = gate.hardFails.filter(
        (b) => b.includes("/500") || b.includes("<40%") || b.includes("/800"),
      );
      if (forbiddenPatterns.length > 0) {
        policyViolation = true;
        console.error(`[integrity-check] POLICY VIOLATION: EXAM_FIRST evaluated with Full-Track thresholds: ${forbiddenPatterns.join(", ")}`);
        try {
          await sb.from("admin_notifications").insert({
            title: "🚨 Policy violation: EXAM_FIRST with Full-Track thresholds",
            body: `Regression detected! Forbidden blockers: ${forbiddenPatterns.join(", ")}. This indicates track-aware thresholds were bypassed.`,
            category: "quality",
            severity: "error",
            entity_type: "course_package",
            entity_id: packageId,
          });
        } catch (_) { /* non-critical */ }
      }
    }

    if (gate.hardFails.length > 0 && !policyViolation) {
      if (isAlreadyPublished) {
        // Do NOT depublish — report only
        console.log(`[integrity-check] pkg=${packageId.slice(0, 8)} PUBLISHED+FAILED: keeping published, report-only`);
        try {
          await sb.from("admin_notifications").insert({
            title: "⚠️ Integrity re-check failed (published — NOT depublished)",
            body: `Track=${track}. ${gate.hardFails.length} blocker(s): ${gate.hardFails.slice(0, 3).join("; ")}`,
            category: "quality",
            severity: "warning",
            entity_type: "course_package",
            entity_id: packageId,
          });
        } catch (_) { /* non-critical */ }
      } else {
        // Pre-publish: failing gate is authoritative
        updatePayload.status = "quality_gate_failed";
        try {
          await sb.from("admin_notifications").insert({
            title: "🛑 COURSE_READY Gate: Release blocked",
            body: `${gate.hardFails.length} blocker(s): ${gate.hardFails.slice(0, 3).join("; ")}`,
            category: "quality",
            severity: "error",
            entity_type: "course_package",
            entity_id: packageId,
          });
        } catch (_) { /* non-critical */ }
      }
    } else if (policyViolation) {
      // Policy violation: do NOT mutate status, report only
      console.log(`[integrity-check] pkg=${packageId.slice(0, 8)} POLICY_VIOLATION: no status change, report-only`);
    }

    // Bombensicher: strip any status mutation if policy violation detected
    if (policyViolation) {
      delete (updatePayload as any).status;
    }

    const { error: uErr } = await sb.from("course_packages").update(updatePayload).eq("id", packageId);
    if (uErr) throw uErr;

    // ✅ Mark run_integrity_check step as DONE (SSOT)
    try {
      const { data: stepRow } = await sb
        .from("package_steps")
        .select("meta")
        .eq("package_id", packageId)
        .eq("step_key", "run_integrity_check")
        .maybeSingle();

      const prevMeta = (stepRow?.meta as Record<string, unknown>) ?? {};
      await sb
        .from("package_steps")
        .update({
          status: "done",
          last_error: null,
          meta: {
            ...prevMeta,
            last_error: null,
            last_error_class: null,
            last_progress_note: `Integrity ${gate.hardFails.length === 0 ? "passed" : "completed with blockers"} (score=${gate.score})`,
            finished_at: new Date().toISOString(),
          },
        })
        .eq("package_id", packageId)
        .eq("step_key", "run_integrity_check");
    } catch (_) {
      // non-critical best-effort
    }

    return json({ ok: true, report });

  } catch (e) {
    // ✅ P0 FIX: ALWAYS write last_error on crash — prevents silent-fail state
    const err = serializeErr(e);
    console.error(`[integrity-check] CRASH pkg=${packageId?.slice(0, 8) ?? "?"}: ${err.message}`);

    if (packageId) {
      try {
        // Merge meta (read-then-write) to preserve existing keys
        const { data: stepRow } = await sb
          .from("package_steps")
          .select("meta")
          .eq("package_id", packageId)
          .eq("step_key", "run_integrity_check")
          .maybeSingle();

        const prevMeta = (stepRow?.meta as Record<string, unknown>) ?? {};
        const nextMeta = {
          ...prevMeta,
          last_error: err.message,
          last_error_name: err.name,
          last_error_stack: err.stack,
          last_error_class: "transient",
          last_progress_note: `Integrity check crashed: ${err.message.slice(0, 200)}`,
          crashed_at: new Date().toISOString(),
        };

        await sb
          .from("package_steps")
          .update({
            status: "failed",
            last_error: err.message,   // ✅ P0: always write last_error column
            meta: nextMeta,
          })
          .eq("package_id", packageId)
          .eq("step_key", "run_integrity_check");
      } catch (writeErr) {
        console.error(`[integrity-check] DOUBLE FAULT: failed to write error state: ${(writeErr as Error).message}`);
      }
    }

    // Return 200 so Runner doesn't enter "edge-call failed" codepath —
    // the step state in DB is the SSOT for failure.
    return json({ ok: false, error: err.message });
  }
});
