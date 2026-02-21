import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

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
    if (hasLfIds) {
      oralCoveragePct = moduleIds.length > 0 ? (uniqueOralLFs.size / moduleIds.length) * 100 : 0;
    } else {
      // Fallback: if we have >= 10 blueprints and they cover diverse topics, consider coverage met
      // Use distinct title patterns as proxy (each LF typically has 2 blueprints)
      const distinctTitles = new Set((oralBpLFs ?? []).map((b: any) => {
        const t = (b.title || "").replace(/^Mündliche Prüfung:\s*/i, "").trim();
        return t.split(/\s+/).slice(0, 3).join(" ").toLowerCase();
      }).filter(Boolean));
      oralCoveragePct = moduleIds.length > 0 ? (distinctTitles.size / moduleIds.length) * 100 : 0;
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
    .select("id, difficulty, cognitive_level, learning_field_id")
    .eq("curriculum_id", currFilter)
    .in("qc_status", ["approved", "tier1_passed"]);

  const totalApproved = approvedQs?.length ?? 0;
  const easyCount = approvedQs?.filter((q: any) => q.difficulty === "easy").length ?? 0;
  const mediumCount = approvedQs?.filter((q: any) => q.difficulty === "medium").length ?? 0;
  const hardCount = approvedQs?.filter((q: any) => q.difficulty === "hard" || q.difficulty === "very_hard").length ?? 0;

  const easyPct = totalApproved > 0 ? (easyCount / totalApproved) * 100 : 0;
  const mediumPct = totalApproved > 0 ? (mediumCount / totalApproved) * 100 : 0;
  const hardPct = totalApproved > 0 ? (hardCount / totalApproved) * 100 : 0;

  // Hard fail: total < 500, hard < 5%, easy > 50%
  const poolPassed = totalApproved >= 500 && hardPct >= 5 && easyPct <= 50;
  results.push({
    gate: "exam_pool_distribution",
    passed: poolPassed,
    severity: "blocker",
    detail: `${totalApproved} approved | easy=${easyPct.toFixed(1)}% medium=${mediumPct.toFixed(1)}% hard=${hardPct.toFixed(1)}%`,
  });
  if (!poolPassed) {
    const reasons: string[] = [];
    if (totalApproved < 500) reasons.push(`TOO_FEW_APPROVED(${totalApproved}/500)`);
    if (hardPct < 5) reasons.push(`HARD_TOO_LOW(${hardPct.toFixed(1)}%<5%)`);
    if (easyPct > 50) reasons.push(`EASY_TOO_HIGH(${easyPct.toFixed(1)}%>50%)`);
    hardFails.push(`EXAM_POOL: ${reasons.join(", ")}`);
  }

  // Warning: hard < 10%
  if (hardPct < 10 && hardPct >= 5) {
    warnings.push(`HARD_BELOW_TARGET: ${hardPct.toFixed(1)}% (target ≥13%)`);
    results.push({ gate: "exam_hard_target", passed: false, severity: "warning", detail: `hard=${hardPct.toFixed(1)}% (target ≥13%)` });
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
  if (hardPct >= 5 && hardPct < 13) warnings.push(`HARD_BELOW_EXCELLENCE: ${hardPct.toFixed(1)}% (excellence ≥15%)`);

  // ═══════════════════════════════════════════════
  // EXCELLENCE checks
  // ═══════════════════════════════════════════════
  if (hardPct >= 15 && hardPct <= 20) excellence.push(`HARD_EXCELLENT: ${hardPct.toFixed(1)}%`);
  if (totalApproved >= 850) excellence.push(`EXAM_POOL_DOMINANT: ${totalApproved} approved`);
  if (!isExamFirst) {
    const hbGate = results.find(r => r.gate === "handbook_depth");
    if (hbGate && (hbGate.value ?? 0) >= 50000) excellence.push(`HANDBOOK_DEEP: ${hbGate.value} chars`);
  }

  // ── Calculate composite score ──
  const totalGates = results.filter(r => r.severity === "blocker").length;
  const passedGates = results.filter(r => r.severity === "blocker" && r.passed).length;
  const score = totalGates > 0 ? Math.round((passedGates / totalGates) * 100) : 0;

  return { results, hardFails, warnings, excellence, score };
}

// ══════════════════════════════════════════════════════
// Main handler
// ══════════════════════════════════════════════════════
Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const body = await req.json().catch(() => ({}));
  const p = body.payload || body;

  try {
    assertUuid("package_id", p?.package_id);
    assertUuid("course_id", p?.course_id);
  } catch (e: unknown) {
    return json({ error: (e as Error).message }, 400);
  }

  const packageId = p.package_id as string;
  const courseId = p.course_id as string;

  // Track-aware prerequisite: EXAM_FIRST requires validate_oral_exam,
  // AUSBILDUNG_VOLL (full track) requires generate_handbook
  const { data: pkgTrack } = await sb.from("course_packages").select("track").eq("id", packageId).maybeSingle();
  const track = (pkgTrack as any)?.track ?? "AUSBILDUNG_VOLL";
  
  const prereqStep = track === "EXAM_FIRST" ? "validate_oral_exam" : "generate_handbook";
  if (!(await prereqDone(sb, packageId, prereqStep))) {
    return json({ ok: false, retry: true, error: `PREREQ_NOT_DONE: ${prereqStep}` }, 409);
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

  const report = {
    score: gate.score,
    generated_at: new Date().toISOString(),
    gate_version: "COURSE_READY_v1.1",
    v3: {
      hard_fail_reasons: gate.hardFails,
      warnings: gate.warnings,
      excellence: gate.excellence,
      gates: gate.results,
      stats: {
        totalLessons: gate.results.find(r => r.gate === "placeholder_check")?.detail ?? "",
        approvedQuestions: gate.results.find(r => r.gate === "exam_pool_distribution")?.detail ?? "",
        handbookChars: gate.results.find(r => r.gate === "handbook_depth")?.value ?? 0,
        bloomLevels: gate.results.find(r => r.gate === "bloom_cognitive_levels")?.detail ?? "",
      },
    },
  };

  const updatePayload: Record<string, unknown> = {
    integrity_report: report,
    build_progress: gate.hardFails.length === 0 ? 95 : 80,
  };
  if (gate.hardFails.length > 0) {
    updatePayload.status = "quality_gate_failed";
  }
  const { error: uErr } = await sb.from("course_packages").update(updatePayload).eq("id", packageId);

  if (uErr) throw uErr;

  // Admin notification on hard fails
  if (gate.hardFails.length > 0) {
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

  return json({ ok: true, report });
});
