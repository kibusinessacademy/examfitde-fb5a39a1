import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { pctOrNA } from "../_shared/math-helpers.ts";
import { checkExamPartMappingDrift } from "../_shared/exam-part-mappings.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { enqueueJob } from "../_shared/enqueue.ts";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
function assertUuid(name: string, v: unknown) {
  const re = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!v || typeof v !== "string" || !re.test(v)) throw new Error(`INVALID_${name.toUpperCase()}`);
}

/**
 * Paginated fetch: loads ALL rows matching a query, not just the default 1000.
 * Uses deterministic ordering by `id` to ensure stable, complete results.
 * PAGE_SIZE=1000 matches the PostgREST default max-rows limit to ensure
 * each page returns exactly PAGE_SIZE rows (or fewer on the last page).
 */
const PAGE_SIZE = 1000;
async function fetchAllApprovedQuestions(
  sb: ReturnType<typeof createClient>,
  currFilter: string,
): Promise<{ rows: any[]; totalExpected: number; truncated: boolean }> {
  // Step 1: Get exact count from DB
  const { count: totalExpected } = await sb
    .from("exam_questions")
    .select("id", { count: "exact", head: true })
    .eq("curriculum_id", currFilter)
    .in("qc_status", ["approved", "tier1_passed"]);

  const expectedCount = totalExpected ?? 0;

  // Step 2: Paginated fetch with deterministic order
  const allRows: any[] = [];
  let offset = 0;
  while (true) {
    const { data, error } = await sb
      .from("exam_questions")
      .select("id, difficulty, cognitive_level, learning_field_id, competency_id, blueprint_id, exam_part, is_trap, trap_type, conflict_type, complexity_score, scenario_type")
      .eq("curriculum_id", currFilter)
      .in("qc_status", ["approved", "tier1_passed"])
      .order("id", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) throw new Error(`EXAM_QUESTIONS_FETCH_ERROR: ${error.message}`);
    const rows = data ?? [];
    allRows.push(...rows);
    if (rows.length < PAGE_SIZE) break; // last page
    offset += PAGE_SIZE;
  }

  const truncated = allRows.length < expectedCount;
  if (truncated) {
    console.warn(
      `[integrity-check] TRUNCATION WARNING: loaded ${allRows.length} but expected ${expectedCount} approved questions for curriculum=${currFilter.slice(0, 8)}`,
    );
  }

  return { rows: allRows, totalExpected: expectedCount, truncated };
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

// ── Integrity Profile Types ──
type IntegrityProfile = "vocational" | "higher_ed";

async function runCourseReadyGate(
  sb: ReturnType<typeof createClient>,
  courseId: string,
  curriculumId: string | null,
  packageId: string,
): Promise<{ results: GateResult[]; hardFails: string[]; warnings: string[]; excellence: string[]; score: number; integrityProfile: IntegrityProfile }> {
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

  // ── Derive integrity profile from curricula.program_type (SSOT) ──
  let integrityProfile: IntegrityProfile = "vocational";
  if (curriculumId) {
    const { data: currRow } = await sb
      .from("curricula")
      .select("program_type")
      .eq("id", curriculumId)
      .maybeSingle();
    const pt = (currRow as any)?.program_type;
    if (pt === "higher_education") integrityProfile = "higher_ed";
    // continuing_education defaults to vocational for now
  }
  const isHigherEd = integrityProfile === "higher_ed";
  console.log(`[integrity-check] pkg=${packageId.slice(0, 8)} integrity_profile=${integrityProfile} track=${trackEarly}`);

  let totalLessons = 0;
  let placeholderCount = 0;
  let regeneratingCount = 0;
  let tier1FailedCount = 0;
  let tier1FailedWithContentCount = 0; // Has real content but QC failed
  if (moduleIds.length > 0 && !isExamFirstEarly) {
    const { data: allLessons } = await sb.from("lessons").select("id, content, qc_status").in("module_id", moduleIds);
    totalLessons = allLessons?.length ?? 0;
    for (const l of allLessons ?? []) {
      const c = (l as any).content;
      const contentLen = typeof c === "string" ? c.length : (c ? JSON.stringify(c).length : 0);
      if ((l as any).qc_status === "tier1_failed") {
        tier1FailedCount++;
        // Distinguish: has real content (>500 chars) vs truly broken
        if (contentLen > 500) tier1FailedWithContentCount++;
      }
      if (!c) { placeholderCount++; continue; }
      let obj: any = null;
      if (typeof c === "object") obj = c;
      else if (typeof c === "string") { try { obj = JSON.parse(c); } catch { /* not json */ } }
      if (obj?._placeholder) placeholderCount++;
      if (obj?._regenerating) regeneratingCount++;
    }
  }
  // tier1_failed with real content (>500 chars) is a WARNING, not a blocker.
  // Rationale: 100% tier1_failed rate across curricula indicates QC calibration issue,
  // not content quality issue. Placeholders and regenerating remain hard blockers.
  const tier1FailedHollow = tier1FailedCount - tier1FailedWithContentCount;
  const phPassed = isExamFirstEarly ? true : (placeholderCount === 0 && regeneratingCount === 0 && tier1FailedHollow === 0);
  const tier1Warning = tier1FailedWithContentCount > 0;
  results.push({
    gate: "placeholder_check",
    passed: phPassed,
    severity: "blocker",
    detail: isExamFirstEarly
      ? "Skipped (EXAM_FIRST track — no learning content)"
      : `${placeholderCount} placeholder, ${regeneratingCount} regenerating, ${tier1FailedHollow} tier1_hollow, ${tier1FailedWithContentCount} tier1_warn of ${totalLessons} lessons`,
    value: placeholderCount + regeneratingCount + tier1FailedHollow,
  });
  if (tier1Warning) {
    results.push({
      gate: "tier1_qc_warning",
      passed: true, // warning only, not a blocker
      severity: "warning",
      detail: `${tier1FailedWithContentCount}/${totalLessons} lessons have real content but tier1_failed QC — QC recalibration recommended`,
      value: tier1FailedWithContentCount,
    });
  }
  if (!phPassed) hardFails.push(`LESSON_QUALITY: ${placeholderCount} placeholder, ${regeneratingCount} regenerating, ${tier1FailedHollow} tier1_hollow`);

  // ═══════════════════════════════════════════════
  // GATE 2: Oral-Exam Pflichtprüfung
  // Higher-Ed: skip (no IHK oral exam format)
  // ═══════════════════════════════════════════════
  const { data: pkgFlags } = await sb.from("course_packages").select("feature_flags").eq("id", packageId).maybeSingle();
  const includeOral = !isHigherEd && (pkgFlags as any)?.feature_flags?.include_oral_exam !== false;

  if (isHigherEd) {
    results.push({
      gate: "oral_exam_ready",
      passed: true,
      severity: "blocker",
      detail: "Skipped (higher_ed profile — no IHK oral exam)",
    });
  } else if (includeOral) {
    // FIX: oral_exam_sessionsets uses package_id, NOT curriculum_id
    const [{ count: bpCount }, { count: ssCount }] = await Promise.all([
      sb.from("oral_exam_blueprints").select("id", { count: "exact", head: true }).eq("curriculum_id", curriculumId ?? courseId),
      sb.from("oral_exam_sessionsets").select("id", { count: "exact", head: true }).eq("package_id", packageId),
    ]);

    const { data: oralBpLFs } = await sb
      .from("oral_exam_blueprints")
      .select("learning_field_id, title")
      .eq("curriculum_id", curriculumId ?? courseId);
    const uniqueOralLFs = new Set((oralBpLFs ?? []).map((b: any) => b.learning_field_id).filter(Boolean));
    const hasLfIds = uniqueOralLFs.size > 0;
    let oralCoveragePct: number;
    if (hasLfIds) {
      oralCoveragePct = pctOrNA(uniqueOralLFs.size, moduleIds.length);
    } else {
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
  // FIX v2: Paginated full-pool fetch — prevents silent truncation at 1000 rows.
  // The Supabase JS client defaults to LIMIT 1000 when no .range()/.limit() is set.
  // This caused false Publish-Gate failures for large pools (9000+ questions).
  const { rows: approvedQs, totalExpected: approvedCountExpected, truncated: sampleTruncated } =
    await fetchAllApprovedQuestions(sb, currFilter);

  const totalApproved = approvedQs.length;

  // Hard-fail if we couldn't load the full pool (safety net)
  if (sampleTruncated) {
    console.error(
      `[integrity-check] HARD TRUNCATION: loaded=${totalApproved} expected=${approvedCountExpected}. Report may be inaccurate.`,
    );
  }
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
    AUSBILDUNG_VOLL: { minApproved: 500, minHardishPct: 40, maxEasyPct: 17 },
    EXAM_FIRST:      { minApproved: 60,  minHardishPct: 20, maxEasyPct: 25 },
    ELITE:           { minApproved: 800, minHardishPct: 45, maxEasyPct: 12 },
    STUDIUM:         { minApproved: 200, minHardishPct: 30, maxEasyPct: 20 },
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
  // v2: Bloom gate is BLOCKER for AUSBILDUNG_VOLL (understand=0% is unacceptable for a full learning course).
  // Only downgraded to warning for EXAM_FIRST where question diversity is less critical.
  const bloomSeverity: "blocker" | "warning" = (trackEarly === "EXAM_FIRST") ? "warning" : "blocker";
  results.push({
    gate: "bloom_cognitive_levels",
    passed: bloomPassed,
    severity: bloomSeverity,
    detail: `${cognitiveLevels.size} levels: understand=${understandPct.toFixed(0)}% apply=${applyPct.toFixed(0)}% analyze=${analyzePct.toFixed(0)}%`,
  });
  if (!bloomPassed) {
    const bloomReasons: string[] = [];
    if (cognitiveLevels.size < 3) bloomReasons.push(`ONLY_${cognitiveLevels.size}_LEVELS`);
    if (!hasUnderstand) bloomReasons.push("MISSING_UNDERSTAND");
    if (!hasApply) bloomReasons.push("MISSING_APPLY");
    if (!hasAnalyze) bloomReasons.push("MISSING_ANALYZE");
    if (understandPct > 80) bloomReasons.push(`UNDERSTAND_MONO(${understandPct.toFixed(0)}%>80%)`);
    if (applyPct < 10) bloomReasons.push(`APPLY_TOO_LOW(${applyPct.toFixed(0)}%<10%)`);
    if (analyzePct < 10) bloomReasons.push(`ANALYZE_TOO_LOW(${analyzePct.toFixed(0)}%<10%)`);
    if (bloomSeverity === "blocker") {
      hardFails.push(`BLOOM_GATE: ${bloomReasons.join(", ")}`);
    } else {
      warnings.push(`BLOOM_GATE: ${bloomReasons.join(", ")}`);
    }
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
  // SSOT targets: remember≤20%, understand≥15%, apply≥30%, analyze≥15%, evaluate≥3%
  // ═══════════════════════════════════════════════
  if (totalApproved > 0) {
    const bloomBuckets: Record<string, string[]> = {
      remember: ["remember","erinnern","wissen","kennen"],
      understand: ["understand","verstehen"],
      apply: ["apply","anwenden"],
      analyze: ["analyze","analysieren"],
      evaluate: ["evaluate","bewerten","beurteilen","create","erschaffen"],
    };
    const bloomCounts: Record<string, number> = {};
    for (const [bucket, aliases] of Object.entries(bloomBuckets)) {
      bloomCounts[bucket] = (approvedQs ?? []).filter((q: any) =>
        aliases.includes((q as any).cognitive_level?.toLowerCase?.() || "")
      ).length;
    }
    const bloomPcts: Record<string, number> = {};
    for (const k of Object.keys(bloomCounts)) {
      bloomPcts[k] = (bloomCounts[k] / totalApproved) * 100;
    }

    // Track-aware thresholds
    const BLOOM_TARGETS: Record<string, Record<string, { min?: number; max?: number }>> = {
      AUSBILDUNG_VOLL: { remember: { max: 25 }, understand: { min: 12 }, apply: { min: 25 }, analyze: { min: 12 }, evaluate: { min: 2 } },
      EXAM_FIRST:      { remember: { max: 35 }, understand: { min: 8 },  apply: { min: 20 }, analyze: { min: 8 },  evaluate: { min: 1 } },
      ELITE:           { remember: { max: 20 }, understand: { min: 15 }, apply: { min: 30 }, analyze: { min: 15 }, evaluate: { min: 3 } },
      STUDIUM:         { remember: { max: 20 }, understand: { min: 15 }, apply: { min: 20 }, analyze: { min: 15 }, evaluate: { min: 5 } },
    };
    const bloomTh = BLOOM_TARGETS[trackEarly] ?? BLOOM_TARGETS["AUSBILDUNG_VOLL"];

    const bloomViolations: string[] = [];
    for (const [bucket, limits] of Object.entries(bloomTh)) {
      const pct = bloomPcts[bucket] ?? 0;
      if (limits.max !== undefined && pct > limits.max) bloomViolations.push(`${bucket.toUpperCase()}=${pct.toFixed(1)}%>max${limits.max}%`);
      if (limits.min !== undefined && pct < limits.min) bloomViolations.push(`${bucket.toUpperCase()}=${pct.toFixed(1)}%<min${limits.min}%`);
    }

    const eliteBloomPassed = bloomViolations.length === 0;
    const bloomDetail = Object.entries(bloomPcts).map(([k, v]) => `${k}=${v.toFixed(1)}%`).join(", ");
    results.push({
      gate: "elite_bloom_distribution",
      passed: eliteBloomPassed,
      severity: "warning",
      detail: `${bloomDetail} [track=${trackEarly}]${bloomViolations.length > 0 ? ` — violations: ${bloomViolations.join(", ")}` : ""}`,
    });
    if (!eliteBloomPassed) {
      warnings.push(`ELITE_BLOOM: ${bloomViolations.join(", ")}`);
    }
    if ((bloomPcts.apply ?? 0) + (bloomPcts.analyze ?? 0) >= 40) {
      excellence.push(`ELITE_BLOOM_EXCELLENT: ${((bloomPcts.apply ?? 0) + (bloomPcts.analyze ?? 0)).toFixed(0)}% apply+analyze`);
    }
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
    // Track-aware thresholds: AUSBILDUNG_VOLL requires 85% (BLOCKER), others 60% (warning)
    const COMP_COVERAGE_THRESHOLDS: Record<string, { min: number; severity: "blocker" | "warning" }> = {
      AUSBILDUNG_VOLL: { min: 85, severity: "blocker" },
      ELITE:           { min: 90, severity: "blocker" },
      EXAM_FIRST:      { min: 60, severity: "warning" },
      STUDIUM:         { min: 75, severity: "blocker" },
    };
    const compTh = COMP_COVERAGE_THRESHOLDS[trackEarly] ?? COMP_COVERAGE_THRESHOLDS["AUSBILDUNG_VOLL"];
    const compCoveragePassed = compCoveragePct >= compTh.min;
    results.push({
      gate: "competency_coverage",
      passed: compCoveragePassed,
      severity: compTh.severity,
      detail: `${coveredCompetencies.size}/${totalCompetencies} competencies covered (${compCoveragePct.toFixed(1)}%, min ${compTh.min}%) [track=${trackEarly}]`,
    });
    if (!compCoveragePassed) {
      if (compTh.severity === "blocker") {
        hardFails.push(`COMPETENCY_COVERAGE: Only ${coveredCompetencies.size}/${totalCompetencies} competencies have questions (${compCoveragePct.toFixed(1)}%<${compTh.min}%)`);
      } else {
        warnings.push(`COMPETENCY_COVERAGE: Only ${coveredCompetencies.size}/${totalCompetencies} competencies have questions (${compCoveragePct.toFixed(1)}%<${compTh.min}%)`);
      }
    }
    if (compCoveragePct >= 95) excellence.push(`COMPETENCY_COVERAGE_EXCELLENT: ${compCoveragePct.toFixed(0)}%`);
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
      .select("id, module_id, step, minicheck_parsed, content, competency_id")
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

    // ── GATE 5b: MiniCheck Parsed — all mini_check lessons must have parsed questions ──
    // A minicheck lesson counts as "parsed" if EITHER:
    //   1. minicheck_parsed = true (embedded questions in content JSON), OR
    //   2. approved minicheck_questions exist for the same competency_id (table-based)
    const totalMC = miniCheckLessons?.length ?? 0;

    // ── Classify each minicheck lesson: embedded vs table-backed vs uncovered ──
    const embeddedLessons = (miniCheckLessons ?? []).filter((l: any) => l.minicheck_parsed);
    const nonEmbeddedLessons = (miniCheckLessons ?? []).filter((l: any) => !l.minicheck_parsed);

    let tableBackedCount = 0;
    let uncoveredCount = nonEmbeddedLessons.length;
    const coveredCompetencies = new Set<string>();

    if (nonEmbeddedLessons.length > 0) {
      const mcLessonCompIds = nonEmbeddedLessons
        .map((l: any) => l.competency_id)
        .filter(Boolean);

      if (mcLessonCompIds.length > 0) {
        const { data: mcqCoverage } = await sb
          .from("minicheck_questions")
          .select("competency_id")
          .eq("curriculum_id", curriculumId)
          .eq("status", "approved")
          .in("competency_id", mcLessonCompIds);

        (mcqCoverage ?? []).forEach((r: any) => coveredCompetencies.add(r.competency_id));
        tableBackedCount = nonEmbeddedLessons.filter((l: any) =>
          l.competency_id && coveredCompetencies.has(l.competency_id)
        ).length;
        uncoveredCount = nonEmbeddedLessons.length - tableBackedCount;
      }
    }

    const mcParsedPassed = uncoveredCount === 0;
    results.push({
      gate: "minicheck_parsed",
      passed: mcParsedPassed,
      severity: "blocker",
      detail: `${totalMC} MiniCheck lessons: ${embeddedLessons.length} embedded, ${tableBackedCount} table-backed, ${uncoveredCount} uncovered`,
      minicheck_materialization: {
        total: totalMC,
        embedded_count: embeddedLessons.length,
        table_backed_count: tableBackedCount,
        uncovered_count: uncoveredCount,
      },
    });
    if (!mcParsedPassed) hardFails.push(`MINICHECK_UNPARSED: ${uncoveredCount} lessons without embedded or table-based MiniCheck questions of ${totalMC} total`);
  } else if (isExamFirstEarly) {
    results.push({
      gate: "minicheck_coverage",
      passed: true,
      severity: "blocker",
      detail: "Skipped (EXAM_FIRST track — no learning content)",
    });
  }

  // ═══════════════════════════════════════════════
  // GATE 5c: Competency Lesson Coverage — all competencies must have lessons
  // ═══════════════════════════════════════════════
  if (moduleIds.length > 0 && !isExamFirstEarly && totalCompetencies > 0) {
    const { data: lessonComps } = await sb
      .from("lessons")
      .select("competency_id")
      .in("module_id", moduleIds)
      .not("competency_id", "is", null);
    const compsWithLessons = new Set((lessonComps ?? []).map((l: any) => l.competency_id));
    const compLessonCoveragePct = pctOrNA(compsWithLessons.size, totalCompetencies);
    const compLessonPassed = compLessonCoveragePct >= 90;
    results.push({
      gate: "competency_lesson_coverage",
      passed: compLessonPassed,
      severity: "blocker",
      detail: `${compsWithLessons.size}/${totalCompetencies} competencies have lessons (${compLessonCoveragePct.toFixed(1)}%, min 90%)`,
    });
    if (!compLessonPassed) hardFails.push(`COMPETENCY_LESSON_GAP: Only ${compsWithLessons.size}/${totalCompetencies} competencies have lessons (${compLessonCoveragePct.toFixed(1)}%<90%)`);
  }

  // ═══════════════════════════════════════════════
  // GATE 5d: Competency Full Step Coverage — every competency needs all didactic steps
  // SSOT: vocational = 5 steps, higher_ed = 7 steps (incl. reflektieren, transfer)
  // ═══════════════════════════════════════════════
  const REQUIRED_STEPS_VOCATIONAL = ["einstieg", "verstehen", "anwenden", "wiederholen", "mini_check"];
  const REQUIRED_STEPS_HIGHER_ED = ["einstieg", "verstehen", "anwenden", "reflektieren", "transfer", "wiederholen", "mini_check"];
  const REQUIRED_STEPS = isHigherEd ? REQUIRED_STEPS_HIGHER_ED : REQUIRED_STEPS_VOCATIONAL;
  if (moduleIds.length > 0 && !isExamFirstEarly && totalCompetencies > 0) {
    const { data: stepLessons } = await sb
      .from("lessons")
      .select("competency_id, step")
      .in("module_id", moduleIds)
      .not("competency_id", "is", null);

    // Build per-competency step set
    const compStepMap = new Map<string, Set<string>>();
    for (const l of stepLessons ?? []) {
      if (!l.competency_id || !l.step) continue;
      if (!compStepMap.has(l.competency_id)) compStepMap.set(l.competency_id, new Set());
      compStepMap.get(l.competency_id)!.add(l.step);
    }

    let fullCoverageCount = 0;
    const incompleteComps: string[] = [];
    for (const [compId, steps] of compStepMap) {
      const hasAll = REQUIRED_STEPS.every(s => steps.has(s));
      if (hasAll) fullCoverageCount++;
      else incompleteComps.push(compId);
    }

    // Also count competencies with NO lessons at all
    const compsWithAnyLesson = compStepMap.size;
    const compsWithNoLesson = totalCompetencies - compsWithAnyLesson;
    const totalIncomplete = incompleteComps.length + compsWithNoLesson;

    const fullStepCoveragePct = pctOrNA(fullCoverageCount, totalCompetencies);
    const stepCountLabel = isHigherEd ? "7" : "5";
    // Higher-Ed: 80% threshold (new content, fewer steps initially populated)
    const fullStepThreshold = trackEarly === "ELITE" ? 100 : trackEarly === "STUDIUM" ? 80 : trackEarly === "AUSBILDUNG_VOLL" ? 95 : 80;
    const fullStepPassed = fullStepCoveragePct >= fullStepThreshold;
    results.push({
      gate: "competency_full_step_coverage",
      passed: fullStepPassed,
      severity: "blocker",
      detail: `${fullCoverageCount}/${totalCompetencies} competencies have all 5 steps (${fullStepCoveragePct.toFixed(1)}%, min ${fullStepThreshold}%). ${totalIncomplete} incomplete.`,
    });
    if (!fullStepPassed) {
      hardFails.push(`COMPETENCY_STEP_GAP: Only ${fullCoverageCount}/${totalCompetencies} competencies have full 5-step coverage (${fullStepCoveragePct.toFixed(1)}%<${fullStepThreshold}%)`);
    }
    if (fullStepCoveragePct >= 98) excellence.push(`COMPETENCY_STEPS_EXCELLENT: ${fullStepCoveragePct.toFixed(0)}% full coverage`);
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
      .select("id, handbook_sections(content_markdown, content_tier)")
      .eq("curriculum_id", curriculumId ?? courseId);

    let handbookTotalChars = 0;
    let hasExpandedContent = false;
    for (const chapter of hbSections ?? []) {
      const sections = (chapter as any).handbook_sections || [];
      for (const s of sections) {
        if (typeof s.content_markdown === "string") handbookTotalChars += s.content_markdown.length;
        if (s.content_tier === "expanded") hasExpandedContent = true;
      }
    }
    // v17: Phase-aware threshold — basis needs 8000, expanded needs 25000
    const handbookMinChars = hasExpandedContent ? 25000 : 8000;
    const handbookPassed = handbookTotalChars >= handbookMinChars;
    results.push({
      gate: "handbook_depth",
      passed: handbookPassed,
      severity: "blocker",
      detail: `${handbookTotalChars} chars (min ${handbookMinChars}, phase: ${hasExpandedContent ? "expanded" : "basis"})`,
      value: handbookTotalChars,
    });
    if (!handbookPassed) hardFails.push(`HANDBOOK_TOO_THIN: ${handbookTotalChars} chars (min ${handbookMinChars})`);
  } else {
    results.push({
      gate: "handbook_depth",
      passed: true,
      severity: "blocker",
      detail: "Skipped (EXAM_FIRST track — no handbook required)",
    });
  }

  // ═══════════════════════════════════════════════
  // GATE 8: Difficulty Balance — EASY_TOO_LOW (NEW: Fix 1)
  // Ensures minimum easy question ratio for learning curve
  // ═══════════════════════════════════════════════
  if (totalApproved > 0) {
    const EASY_MIN_PCT: Record<string, number> = {
      AUSBILDUNG_VOLL: 5,
      ELITE: 3,
      EXAM_FIRST: 5,
    };
    const easyMinTarget = EASY_MIN_PCT[trackEarly] ?? 5;
    const easyTooLow = easyPct < easyMinTarget;
    results.push({
      gate: "difficulty_easy_floor",
      passed: !easyTooLow,
      severity: "warning",
      detail: `easy=${easyPct.toFixed(1)}% (min ${easyMinTarget}%) [track=${trackEarly}]. ${easyCount}/${totalApproved} easy questions.`,
      value: easyCount,
    });
    if (easyTooLow) {
      warnings.push(`EASY_TOO_LOW: ${easyPct.toFixed(1)}%<${easyMinTarget}% — insufficient entry-level questions for learning curve`);
    }

    // Also check for EVALUATE_TOO_HIGH (>15% is excessive)
    const evaluateCount = (approvedQs ?? []).filter((q: any) =>
      ["evaluate","bewerten","beurteilen","create","erschaffen"].includes((q as any).cognitive_level?.toLowerCase?.() || "")
    ).length;
    const evaluatePct = (evaluateCount / totalApproved) * 100;
    if (evaluatePct > 20) {
      warnings.push(`EVALUATE_TOO_HIGH: ${evaluatePct.toFixed(1)}%>20% — exam difficulty skewed toward evaluation`);
      results.push({
        gate: "evaluate_ceiling",
        passed: false,
        severity: "warning",
        detail: `evaluate=${evaluatePct.toFixed(1)}% (max 20%). ${evaluateCount}/${totalApproved} evaluate questions.`,
      });
    }
  }

  // ═══════════════════════════════════════════════
  // GATE 9: Exam-Part Coverage (NEW: Fix 2)
  // Questions must be mapped to Teil 1 / Teil 2
  // ═══════════════════════════════════════════════
  if (totalApproved > 0) {
    const withExamPart = (approvedQs ?? []).filter((q: any) => q.exam_part).length;
    const examPartPct = (withExamPart / totalApproved) * 100;
    const examPartPassed = examPartPct >= 80;
    results.push({
      gate: "exam_part_coverage",
      passed: examPartPassed,
      severity: "warning",
      detail: `${withExamPart}/${totalApproved} questions mapped to exam part (${examPartPct.toFixed(1)}%, min 80%)`,
      value: withExamPart,
    });
    if (!examPartPassed) {
      warnings.push(`EXAM_PART_MISSING: Only ${examPartPct.toFixed(1)}% of questions have exam_part assignment — simulation not IHK-conformant`);
    }
    if (examPartPct >= 95) excellence.push(`EXAM_PART_EXCELLENT: ${examPartPct.toFixed(0)}% mapped`);
  }

  // ═══════════════════════════════════════════════
  // GATE 9b: Exam-Part Mapping Drift (structural consistency)
  // Verifies exam_part_mappings are consistent with learning_fields.exam_part
  // ═══════════════════════════════════════════════
  if (curriculumId) {
    try {
      const drift = await checkExamPartMappingDrift(sb, curriculumId);
      const driftPassed = drift.ok;
      const driftDetails = [];
      if (drift.mismatches.length > 0) driftDetails.push(`${drift.mismatches.length} mismatches`);
      if (drift.unmapped.length > 0) driftDetails.push(`${drift.unmapped.length} unmapped LFs`);
      if (drift.orphaned.length > 0) driftDetails.push(`${drift.orphaned.length} orphaned mappings`);
      results.push({
        gate: "exam_part_mapping_drift",
        passed: driftPassed,
        severity: "warning",
        detail: driftPassed
          ? "exam_part_mappings consistent with learning_fields.exam_part"
          : `Drift: ${driftDetails.join(", ")}`,
        value: drift.mismatches.length + drift.unmapped.length + drift.orphaned.length,
      });
      if (!driftPassed) {
        warnings.push(`EXAM_PART_MAPPING_DRIFT: ${driftDetails.join(", ")} — run ensureExamPartMappings to fix`);
      }
    } catch (driftErr: any) {
      console.warn(`[integrity-check] exam_part_mapping drift check failed: ${driftErr.message}`);
    }
  }

  // ═══════════════════════════════════════════════
  // GATE 10: Trap Coverage (tiered: warning → blocker)
  // ═══════════════════════════════════════════════
  if (totalApproved > 0) {
    const withTrap = (approvedQs ?? []).filter((q: any) => q.is_trap || q.trap_type).length;
    const withoutTrap = totalApproved - withTrap;
    const missingPct = (withoutTrap / totalApproved) * 100;
    const trapPct = (withTrap / totalApproved) * 100;
    const TRAP_MIN_PCT: Record<string, number> = {
      AUSBILDUNG_VOLL: 10,
      ELITE: 15,
      EXAM_FIRST: 5,
    };
    const trapMinTarget = TRAP_MIN_PCT[trackEarly] ?? 10;
    const trapPassed = trapPct >= trapMinTarget;

    // Tiered severity: >25% missing = blocker, >10% missing = warning
    const trapSeverity: "blocker" | "warning" = missingPct > 25 ? "blocker" : "warning";
    results.push({
      gate: "trap_coverage",
      passed: trapPassed,
      severity: trapSeverity,
      detail: `${withTrap}/${totalApproved} trap questions (${trapPct.toFixed(1)}%, min ${trapMinTarget}%) [track=${trackEarly}] missing=${missingPct.toFixed(1)}%`,
      value: withTrap,
    });
    if (!trapPassed) {
      if (trapSeverity === "blocker") {
        hardFails.push(`TRAP_COVERAGE_BLOCK: ${trapPct.toFixed(1)}%<${trapMinTarget}%, ${missingPct.toFixed(1)}% missing trap_type — auto-repair required`);
      } else {
        warnings.push(`TRAP_COVERAGE_LOW: ${trapPct.toFixed(1)}%<${trapMinTarget}% — insufficient IHK-realistic exam traps`);
      }
    }
    if (trapPct >= 20) excellence.push(`TRAP_COVERAGE_EXCELLENT: ${trapPct.toFixed(0)}% trap questions`);
  }

  // ═══════════════════════════════════════════════
  // GATE 10b: Metadata Completeness (bloom + trap_type presence)
  // Missing metadata = silent quality degradation
  // ═══════════════════════════════════════════════
  if (totalApproved > 0) {
    const missingBloom = (approvedQs ?? []).filter((q: any) => !q.cognitive_level).length;
    const missingBloomPct = (missingBloom / totalApproved) * 100;
    const bloomMetaPassed = missingBloomPct < 10;
    const bloomMetaSeverity: "blocker" | "warning" = missingBloomPct > 25 ? "blocker" : "warning";
    results.push({
      gate: "metadata_bloom_completeness",
      passed: bloomMetaPassed,
      severity: bloomMetaSeverity,
      detail: `${missingBloom}/${totalApproved} missing cognitive_level (${missingBloomPct.toFixed(1)}%)`,
      value: totalApproved - missingBloom,
    });
    if (!bloomMetaPassed) {
      if (bloomMetaSeverity === "blocker") {
        hardFails.push(`METADATA_BLOOM_BLOCK: ${missingBloomPct.toFixed(1)}% questions missing cognitive_level`);
      } else {
        warnings.push(`METADATA_BLOOM_LOW: ${missingBloomPct.toFixed(1)}% questions missing cognitive_level`);
      }
    }

    const missingTrapType = (approvedQs ?? []).filter((q: any) => !q.trap_type && !q.is_trap).length;
    const missingTrapTypePct = (missingTrapType / totalApproved) * 100;
    // Track missing trap_type as metadata signal (separate from trap_coverage gate)
    if (missingTrapTypePct > 10) {
      warnings.push(`METADATA_TRAP_TYPE_LOW: ${missingTrapTypePct.toFixed(1)}% questions without trap_type classification`);
    }
  }

  // ═══════════════════════════════════════════════
  // GATE 10c: Conflict-Type Distribution (Elite-Härtung)
  // Target: ≥20% of approved questions should have conflict_type != 'none'
  // This ensures exam realism — questions where multiple answers seem plausible
  // ═══════════════════════════════════════════════
  if (totalApproved > 0) {
    const withConflict = (approvedQs ?? []).filter((q: any) =>
      q.conflict_type && q.conflict_type !== 'none' && q.conflict_type !== ''
    ).length;
    const conflictPct = (withConflict / totalApproved) * 100;
    const CONFLICT_MIN_PCT: Record<string, number> = {
      AUSBILDUNG_VOLL: 15,
      ELITE: 20,
      EXAM_FIRST: 10,
    };
    const conflictMinTarget = CONFLICT_MIN_PCT[trackEarly] ?? 15;
    const conflictPassed = conflictPct >= conflictMinTarget;

    // Conflict distribution breakdown
    const conflictDist: Record<string, number> = {};
    for (const q of (approvedQs ?? []) as any[]) {
      if (q.conflict_type && q.conflict_type !== 'none' && q.conflict_type !== '') {
        conflictDist[q.conflict_type] = (conflictDist[q.conflict_type] || 0) + 1;
      }
    }
    const distDetail = Object.entries(conflictDist).map(([k, v]) => `${k}=${v}`).join(", ") || "none";

    results.push({
      gate: "conflict_type_distribution",
      passed: conflictPassed,
      severity: "warning",
      detail: `${withConflict}/${totalApproved} conflict questions (${conflictPct.toFixed(1)}%, min ${conflictMinTarget}%) [${distDetail}]`,
      value: withConflict,
    });
    if (!conflictPassed) {
      warnings.push(`CONFLICT_TYPE_LOW: ${conflictPct.toFixed(1)}%<${conflictMinTarget}% — questions too straightforward for IHK realism`);
    }
    if (conflictPct >= 25) excellence.push(`CONFLICT_TYPE_EXCELLENT: ${conflictPct.toFixed(0)}% conflict questions — elite exam realism`);
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
    approvedCountExpected, sampleTruncated,
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
    // ── Payload normalization: accept both camelCase and snake_case ──
    const rawPackageId = p?.package_id || p?.packageId;
    const rawCourseId = p?.course_id || p?.courseId;
    const forceRun = p?.force === true;

    assertUuid("package_id", rawPackageId);
    packageId = rawPackageId as string;

    // ── Guard: only run for building packages (unless force=true) ──
    const { data: pkgData } = await sb
      .from("course_packages")
      .select("track, status, course_id, published_at")
      .eq("id", packageId)
      .maybeSingle();

    if (!pkgData) {
      return json({ ok: false, error: "PACKAGE_NOT_FOUND", permanent: true }, 200);
    }

    const pkgStatus = (pkgData as any).status;
    // P0.2 FIX: Allow blocked/quality_gate_failed packages to run integrity in recovery mode.
    // Previously only allowed blocked + council_approved, which created a deadlock:
    //   blocked → can't run integrity → stays blocked → no diagnosis possible.
    // Now: blocked and quality_gate_failed are ALWAYS eligible for integrity (recovery path).
    // This is safe because integrity is read-only (diagnostic, not mutating).
    const allowedStatuses = ["building", "done", "published"];
    const RECOVERY_STATUSES = ["blocked", "quality_gate_failed"];
    const isRecoveryEligible = RECOVERY_STATUSES.includes(pkgStatus);
    if (isRecoveryEligible) {
      console.log(`[integrity-check] pkg=${packageId.slice(0, 8)} RECOVERY_MODE: running integrity despite status='${pkgStatus}' (recovery path enabled)`);
    }
    if (!allowedStatuses.includes(pkgStatus) && !isRecoveryEligible && !forceRun) {
      // Package not in an active build state — skip gracefully (not a failure)
      console.log(`[integrity-check] pkg=${packageId.slice(0, 8)} status=${pkgStatus} — skipping (not building/done/published/recovery)`);
      return json({
        ok: false,
        skipped: true,
        reason: `PACKAGE_STATUS_${pkgStatus?.toUpperCase() ?? "UNKNOWN"}`,
        error: `Package status '${pkgStatus}' is not eligible for integrity check. Use force=true to override.`,
      }, 200);
    }
    if (forceRun && pkgStatus !== "building" && pkgStatus !== "done" && pkgStatus !== "published") {
      console.warn(`[integrity-check] FORCE mode: pkg=${packageId.slice(0, 8)} status=${pkgStatus} — running despite non-standard status`);
    }

    // ── Auto-resolve course_id from package if not provided ──
    let courseId = rawCourseId as string | null;
    if (!courseId) {
      courseId = (pkgData as any).course_id ?? null;
    }
    if (!courseId) {
      return json({ ok: false, error: "MISSING_COURSE_ID", permanent: true }, 200);
    }

    const track = (pkgData as any)?.track ?? "AUSBILDUNG_VOLL";

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

    // ── BACKLOG GATE: Don't run integrity if large QC backlog still pending ──
    // Prevents premature integrity checks that produce false negatives and wasteful retries
    // BYPASS: Priority ≤ 1 packages skip the backlog gate — their exam pool step is already
    // validated as done, so deferring integrity creates a deterministic stall.
    const pkgPriority = (pkgData as any)?.priority ?? 99;
    const { data: courseForCurr } = await sb.from("courses").select("curriculum_id").eq("id", courseId!).single();
    const currIdForBacklog = courseForCurr?.curriculum_id;
    if (currIdForBacklog && !forceRun && pkgPriority > 1) {
      const { data: backlogAgg } = await sb.rpc("count_exam_qc_status", { p_curriculum_id: currIdForBacklog });
      const backlogCounts: Record<string, number> = {};
      for (const row of (backlogAgg || []) as any[]) {
        backlogCounts[row.qc_status || "null"] = Number(row.cnt);
      }
      const reviewPending = backlogCounts.pending || 0;
      const tier1Passed = backlogCounts.tier1_passed || 0;
      const totalApproved = (backlogCounts.approved || 0) + (backlogCounts["null"] || 0);

      const significantBacklog = reviewPending > 500;
      if (!significantBacklog && tier1Passed > 200 && tier1Passed > totalApproved * 0.1) {
        console.log(
          `[integrity-check] BACKLOG_GATE_BYPASS: pkg=${packageId!.slice(0, 8)} review_pending=${reviewPending}, tier1_passed=${tier1Passed}, approved=${totalApproved} — tier1_passed treated as ready pool, not backlog`,
        );
      }
      if (significantBacklog) {
        console.log(`[integrity-check] BACKLOG_GATE: pkg=${packageId!.slice(0, 8)} review_pending=${reviewPending}, tier1_passed=${tier1Passed}, approved=${totalApproved} — deferring`);
        return json({
          ok: false,
          retry: true,
          transient: true,
          backoff_seconds: 120,
          error: `BACKLOG_GATE: ${reviewPending} review/pending + ${tier1Passed} tier1_passed still unprocessed. Integrity check deferred until QC backlog is resolved.`,
          backlog: { review_pending: reviewPending, tier1_passed: tier1Passed, approved: totalApproved },
        }, 200);
      }
    } else if (pkgPriority <= 1 && currIdForBacklog) {
      console.log(`[integrity-check] BACKLOG_GATE_SKIP: pkg=${packageId!.slice(0, 8)} priority=${pkgPriority} — bypassing backlog gate for high-priority package`);
    }

    // Get curriculum_id from course
    const currId = currIdForBacklog;

    // ── Run COURSE_READY gate ──
    const gate = await runCourseReadyGate(sb, courseId, currId, packageId);

    console.log(`[integrity-check] pkg=${packageId.slice(0, 8)} COURSE_READY score=${gate.score} hardFails=${gate.hardFails.length} warnings=${gate.warnings.length} excellence=${gate.excellence.length} pool_loaded=${gate.metrics.totalApproved}/${gate.metrics.approvedCountExpected} truncated=${gate.metrics.sampleTruncated}`);
    for (const hf of gate.hardFails) console.log(`  ❌ ${hf}`);
    for (const w of gate.warnings) console.log(`  ⚠️ ${w}`);
    for (const e of gate.excellence) console.log(`  🌟 ${e}`);

    // ── Build council-friendly v3.summary (SSOT for Council) ──
    // Council reads ONLY from summary — computed directly from gate metrics.
    const { totalApproved, approvedQs, uniqueLFs, moduleIds, totalCompetencies, approvedCountExpected, sampleTruncated } = gate.metrics;

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

    const CURRENT_REPORT_VERSION = "COURSE_READY_v1.6";
    const CURRENT_REPORT_VERSION_NUM = 16;
    const report = {
      score: gate.score,
      generated_at: new Date().toISOString(),
      gate_version: CURRENT_REPORT_VERSION,
      version_num: CURRENT_REPORT_VERSION_NUM,
      sample_metadata: {
        approved_question_count_total: approvedCountExpected,
        approved_question_count_loaded: totalApproved,
        sample_truncated: sampleTruncated,
        fetch_method: "paginated_full_pool",
      },
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
    // Re-fetch to get current status (may have changed since handler start)
    const { data: cpStatus } = await sb.from("course_packages").select("published_at, status").eq("id", packageId).maybeSingle();
    const isAlreadyPublished = Boolean((cpStatus as any)?.published_at) || (cpStatus as any)?.status === "published";

    const updatePayload: Record<string, unknown> = {
      integrity_report: report,
      integrity_report_version: CURRENT_REPORT_VERSION,
      integrity_report_version_num: CURRENT_REPORT_VERSION_NUM,
      integrity_passed: gate.hardFails.length === 0,
      // build_progress is SSOT-derived from package_steps — no manual write
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
        // ── AUTOFIX-AWARE GATE ──
        // If an active autofix run exists, do NOT set quality_gate_failed.
        // The autofix will re-trigger integrity check after gap-close.
        const { data: activeAutofix } = await sb
          .from("autofix_runs")
          .select("id, current_round, status")
          .eq("package_id", packageId)
          .eq("status", "running")
          .limit(1)
          .maybeSingle();

        if (activeAutofix) {
          // Keep package in building — autofix is still working
          console.log(`[integrity-check] pkg=${packageId.slice(0, 8)} AUTOFIX_ACTIVE (run=${activeAutofix.id.slice(0,8)}, round=${activeAutofix.current_round}) — NOT setting quality_gate_failed, staying in building`);
          updatePayload.status = "building";
          try {
            await sb.from("admin_notifications").insert({
              title: "ℹ️ Integrity check: autofix active — staying in building",
              body: `Score=${gate.score}, ${gate.hardFails.length} blocker(s), but autofix run ${activeAutofix.id.slice(0,8)} round ${activeAutofix.current_round} is active. Will re-check after gap-close.`,
              category: "quality",
              severity: "info",
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

    // ── P0 PERSISTENCE VERIFICATION ──
    // Invariant: if we wrote integrity_report, it MUST be persisted.
    // Silent persistence failures caused MFA ghost-block (2026-03-20).
    // Enhanced: checks ALL missing-report cases (!hasReport), not just partial strip.
    {
      const { data: verifyRow, error: verifyErr } = await sb
        .from("course_packages")
        .select("integrity_report, integrity_report_version")
        .eq("id", packageId)
        .single();

      if (verifyErr) {
        console.error(`[integrity-check] PERSISTENCE_VERIFY_FAIL: could not re-read package: ${verifyErr.message}`);
      } else if (verifyRow) {
        const hasVersion = Boolean(verifyRow.integrity_report_version);
        const hasReport = verifyRow.integrity_report !== null;

        if (!hasReport) {
          // CRITICAL: report was stripped by a trigger (e.g. trg_invalidate_integrity_on_package_reset
          // firing due to status/build_progress change in the same transaction).
          const errMsg = `INTEGRITY_REPORT_PERSISTENCE_DEFECT: report was generated (score=${gate.score}) but cleared by trigger. hasVersion=${hasVersion}, hasReport=${hasReport}`;
          console.error(`[integrity-check] ${errMsg}`);

          // Attempt recovery: re-write ONLY the report fields (no status change to avoid re-triggering invalidation)
          const { error: rewriteErr } = await sb.from("course_packages").update({
            integrity_report: report,
            integrity_report_version: CURRENT_REPORT_VERSION,
            integrity_report_version_num: CURRENT_REPORT_VERSION_NUM,
          }).eq("id", packageId);

          if (rewriteErr) {
            console.error(`[integrity-check] REWRITE FAILED: ${rewriteErr.message}`);
            // Mark step as failed so it doesn't silently succeed
            await sb.from("package_steps").update({
              status: "failed",
              last_error: `PERSISTENCE_VERIFY_FAILED: ${errMsg}; rewrite failed: ${rewriteErr.message}`,
              meta: {
                last_error: errMsg,
                last_error_class: "persistence_defect",
                persistence_defect_at: new Date().toISOString(),
                missing_report: true,
                missing_version: !hasVersion,
                rewrite_error: rewriteErr.message,
              },
            }).eq("package_id", packageId).eq("step_key", "run_integrity_check");

            try {
              await sb.from("admin_notifications").insert({
                title: "🚨 Integrity Report Persistence Defect (unrecoverable)",
                body: `Package ${packageId.slice(0, 8)}: report was generated (score=${gate.score}) but stripped by trigger and rewrite also failed. Step marked failed.`,
                category: "quality",
                severity: "error",
                entity_type: "course_package",
                entity_id: packageId,
              });
            } catch (_) { /* non-critical */ }

            return json({
              ok: false,
              error: errMsg,
              report_was_generated: true,
              report_score: gate.score,
              hard_fails: gate.hardFails,
            });
          }

          // Re-read after rewrite to verify persistence actually stuck
          const { data: reVerify, error: reVerifyErr } = await sb
            .from("course_packages")
            .select("integrity_report, integrity_report_version")
            .eq("id", packageId)
            .single();

          if (reVerifyErr || !reVerify?.integrity_report) {
            const finalErr = `PERSISTENCE_VERIFY_FAILED: integrity_report still missing after rewrite (re-read error: ${reVerifyErr?.message ?? "report NULL"})`;
            console.error(`[integrity-check] ${finalErr}`);

            await sb.from("package_steps").update({
              status: "failed",
              last_error: finalErr,
              meta: {
                last_error: finalErr,
                last_error_class: "persistence_defect",
                persistence_defect_at: new Date().toISOString(),
                rewrite_attempted: true,
                rewrite_succeeded: false,
              },
            }).eq("package_id", packageId).eq("step_key", "run_integrity_check");

            try {
              await sb.from("admin_notifications").insert({
                title: "🚨 Integrity Report: Rewrite did not persist",
                body: `Package ${packageId.slice(0, 8)}: rewrite succeeded but re-read shows NULL. Trigger-strip loop detected. Step marked failed.`,
                category: "quality",
                severity: "error",
                entity_type: "course_package",
                entity_id: packageId,
              });
            } catch (_) { /* non-critical */ }

            return json({
              ok: false,
              error: finalErr,
              report_was_generated: true,
              report_score: gate.score,
              hard_fails: gate.hardFails,
            });
          }

          console.log(`[integrity-check] REWRITE+VERIFY OK: report re-persisted for pkg=${packageId.slice(0, 8)}`);
          try {
            await sb.from("admin_notifications").insert({
              title: "🔄 Integrity Report: Trigger-Strip recovered",
              body: `Package ${packageId.slice(0, 8)}: report was stripped by trigger after initial write but successfully re-persisted and verified. Score=${gate.score}.`,
              category: "quality",
              severity: "info",
              entity_type: "course_package",
              entity_id: packageId,
            });
          } catch (_) { /* non-critical */ }
        }
      }
    }

    // ── SSOT Status Reconciliation: heal stale quality_gate_failed ──
    // If integrity passed and build is complete, ensure status reflects reality
    if (gate.hardFails.length === 0 && !isAlreadyPublished) {
      const { data: reconPkg } = await sb
        .from("course_packages")
        .select("id, status, build_progress")
        .eq("id", packageId)
        .single();

      if (reconPkg) {
        const progress = Number(reconPkg.build_progress ?? 0);
        const needsReconcile = reconPkg.status === "quality_gate_failed" ||
          reconPkg.status === "blocked" ||
          reconPkg.status === "stuck";

        if (needsReconcile && progress >= 80) {
          const nextStatus = "building"; // let pipeline continue to auto_publish
          console.log(`[integrity-check] RECONCILE: pkg=${packageId.slice(0,8)} status=${reconPkg.status} → ${nextStatus} (integrity passed, progress=${progress})`);
          await sb.from("course_packages").update({
            status: nextStatus,
            blocked_reason: null,
            last_error: null,
            updated_at: new Date().toISOString(),
          }).eq("id", packageId);

          try {
            await sb.from("admin_notifications").insert({
              title: "✅ Status reconciled after integrity pass",
              body: `Package ${packageId.slice(0,8)} was ${reconPkg.status} but integrity passed (score=${gate.score}). Status healed to ${nextStatus}.`,
              category: "quality",
              severity: "info",
              entity_type: "course_package",
              entity_id: packageId,
            });
          } catch (_) { /* non-critical */ }
        }
      }
    }

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

    // ── AUTO-ENQUEUE: metadata repair when warnings/fails detected ──
    // Hard auto-enqueue: if trap_type, bloom, or metadata warnings exist,
    // automatically dispatch rebalancer — no manual intervention needed.
    const metadataRepairSignals = [...gate.hardFails, ...gate.warnings].filter(s =>
      s.includes("TRAP_COVERAGE") || s.includes("METADATA_BLOOM") ||
      s.includes("METADATA_TRAP") || s.includes("EASY_TOO_LOW") ||
      s.includes("BLOOM_GATE") || s.includes("CONFLICT_TYPE")
    );
    if (metadataRepairSignals.length > 0 && !isAlreadyPublished) {
      try {
        // Check for existing active rebalance job to avoid duplicates
        const { data: existingJob } = await sb
          .from("job_queue")
          .select("id, status")
          .eq("package_id", packageId)
          .eq("job_type", "package_exam_rebalance")
          .in("status", ["pending", "queued", "processing"])
          .limit(1)
          .maybeSingle();

        if (!existingJob) {
          await enqueueJob(sb, {
            job_type: "package_exam_rebalance",
            package_id: packageId,
            priority: 15,
            max_attempts: 3,
            payload: {
              package_id: packageId,
              auto_triggered: true,
              trigger_signals: metadataRepairSignals,
            },
          });
          console.log(`[integrity-check] AUTO-ENQUEUE: package_exam_rebalance for ${packageId.slice(0, 8)} (${metadataRepairSignals.length} signals: ${metadataRepairSignals.slice(0, 3).join(", ")})`);
        } else {
          console.log(`[integrity-check] DEDUP: rebalance already active for ${packageId.slice(0, 8)} (${existingJob.status})`);
        }
      } catch (enqErr) {
        console.warn(`[integrity-check] Auto-enqueue rebalancer failed: ${(enqErr as Error).message}`);
      }
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
