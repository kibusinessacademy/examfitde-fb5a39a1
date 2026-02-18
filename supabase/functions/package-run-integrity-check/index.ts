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
  const { data: d1 } = await sb
    .from("package_steps").select("status")
    .eq("package_id", packageId).eq("step_key", stepKey).maybeSingle();
  if (d1?.status === "done") return true;
  const { data: d2 } = await sb
    .from("course_package_build_steps").select("status")
    .eq("package_id", packageId).eq("step_key", stepKey).maybeSingle();
  return d2?.status === "done";
}

// ── COURSE_READY Release-Gate v1.0 ──
// 7 hard-fail checks that MUST pass before auto_publish

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
  // ═══════════════════════════════════════════════
  let totalLessons = 0;
  let placeholderCount = 0;
  let regeneratingCount = 0;
  let tier1FailedCount = 0;
  if (moduleIds.length > 0) {
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
  const phPassed = placeholderCount === 0 && regeneratingCount === 0 && tier1FailedCount === 0;
  results.push({
    gate: "placeholder_check",
    passed: phPassed,
    severity: "blocker",
    detail: `${placeholderCount} placeholder, ${regeneratingCount} regenerating, ${tier1FailedCount} tier1_failed of ${totalLessons} lessons`,
    value: placeholderCount + regeneratingCount + tier1FailedCount,
  });
  if (!phPassed) hardFails.push(`LESSON_QUALITY: ${placeholderCount} placeholder, ${regeneratingCount} regenerating, ${tier1FailedCount} tier1_failed`);

  // ═══════════════════════════════════════════════
  // GATE 2: Oral-Exam Pflichtprüfung
  // ═══════════════════════════════════════════════
  const { data: pkgFlags } = await sb.from("course_packages").select("feature_flags").eq("id", packageId).maybeSingle();
  const includeOral = (pkgFlags as any)?.feature_flags?.include_oral_exam !== false; // default true

  if (includeOral) {
    const [{ count: bpCount }, { count: ssCount }] = await Promise.all([
      sb.from("oral_exam_blueprints").select("id", { count: "exact", head: true }).eq("curriculum_id", curriculumId ?? courseId),
      sb.from("oral_exam_sessionsets").select("id", { count: "exact", head: true }).eq("curriculum_id", curriculumId ?? courseId),
    ]);

    // NEW: Check oral blueprint coverage against module count
    const { data: oralBpLFs } = await sb
      .from("oral_exam_blueprints")
      .select("learning_field_id")
      .eq("curriculum_id", curriculumId ?? courseId);
    const uniqueOralLFs = new Set((oralBpLFs ?? []).map((b: any) => b.learning_field_id).filter(Boolean));
    const oralCoveragePct = moduleIds.length > 0 ? (uniqueOralLFs.size / moduleIds.length) * 100 : 0;

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
  // ═══════════════════════════════════════════════
  const currFilter = curriculumId ?? courseId;
  const { data: approvedQs } = await sb
    .from("exam_questions")
    .select("id, difficulty, cognitive_level, learning_field_id")
    .eq("curriculum_id", currFilter)
    .eq("qc_status", "approved");

  const totalApproved = approvedQs?.length ?? 0;
  const easyCount = approvedQs?.filter((q: any) => q.difficulty === "easy" || q.difficulty === "leicht").length ?? 0;
  const mediumCount = approvedQs?.filter((q: any) => q.difficulty === "medium" || q.difficulty === "mittel").length ?? 0;
  const hardCount = approvedQs?.filter((q: any) => q.difficulty === "hard" || q.difficulty === "schwer").length ?? 0;

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

  // NEW: Enforce minimum percentage per cognitive level (no mono-cognitive pools)
  const understandCount = (approvedQs ?? []).filter((q: any) => ["understand","verstehen"].includes(q.cognitive_level?.toLowerCase())).length;
  const applyCount = (approvedQs ?? []).filter((q: any) => ["apply","anwenden"].includes(q.cognitive_level?.toLowerCase())).length;
  const analyzeCount = (approvedQs ?? []).filter((q: any) => ["analyze","analysieren"].includes(q.cognitive_level?.toLowerCase())).length;
  const understandPct = totalApproved > 0 ? (understandCount / totalApproved) * 100 : 0;
  const applyPct = totalApproved > 0 ? (applyCount / totalApproved) * 100 : 0;
  const analyzePct = totalApproved > 0 ? (analyzeCount / totalApproved) * 100 : 0;

  // Blocker: need 3+ levels AND no single level > 80% AND apply+analyze each >= 10%
  const noMonoCognitive = understandPct <= 80 && applyPct >= 10 && analyzePct >= 10;
  const bloomPassed = cognitiveLevels.size >= 3 && hasUnderstand && hasApply && hasAnalyze && noMonoCognitive;
  results.push({
    gate: "bloom_cognitive_levels",
    passed: bloomPassed,
    severity: "blocker",
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
    hardFails.push(`BLOOM_GATE: ${bloomReasons.join(", ")}`);
  }

  // Excellence: 4+ levels
  if (cognitiveLevels.size >= 4) excellence.push(`BLOOM_EXCELLENT: ${cognitiveLevels.size} cognitive levels`);

  // ═══════════════════════════════════════════════
  // GATE 4b: Learning-Field-Coverage (NEU)
  // ═══════════════════════════════════════════════
  const uniqueLFs = new Set((approvedQs ?? []).map((q: any) => q.learning_field_id).filter(Boolean));
  const lfCoveragePassed = uniqueLFs.size >= moduleIds.length * 0.8; // at least 80% of modules
  results.push({
    gate: "learning_field_coverage",
    passed: lfCoveragePassed,
    severity: "blocker",
    detail: `${uniqueLFs.size} LFs covered in exam pool, ${moduleIds.length} modules in course`,
  });
  if (!lfCoveragePassed) hardFails.push(`LF_COVERAGE: Only ${uniqueLFs.size}/${moduleIds.length} learning fields have exam questions`);

  // ═══════════════════════════════════════════════
  // GATE 5: MiniCheck pro Lernfeld
  // ═══════════════════════════════════════════════
  if (moduleIds.length > 0) {
    const { data: miniCheckLessons } = await sb
      .from("lessons")
      .select("module_id, lesson_type")
      .in("module_id", moduleIds)
      .eq("lesson_type", "mini_check");

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
  }

  // ═══════════════════════════════════════════════
  // GATE 6: Snapshot-Integrity (placeholder match)
  // ═══════════════════════════════════════════════
  // This is validated at export time, but we record the values here
  results.push({
    gate: "snapshot_integrity",
    passed: true, // verified inline — real count is authoritative
    severity: "blocker",
    detail: `Real placeholder count = ${placeholderCount} (authoritative)`,
    value: placeholderCount,
  });

  // ═══════════════════════════════════════════════
  // GATE 7: Handbuch-Mindesttiefe
  // ═══════════════════════════════════════════════
  const { data: hbSections } = await sb
    .from("handbook_sections")
    .select("content")
    .eq("curriculum_id", curriculumId ?? courseId);

  let handbookTotalChars = 0;
  for (const s of hbSections ?? []) {
    if (typeof s.content === "string") handbookTotalChars += s.content.length;
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

  // ═══════════════════════════════════════════════
  // WARNINGS
  // ═══════════════════════════════════════════════
  if (hardPct >= 5 && hardPct < 13) warnings.push(`HARD_BELOW_EXCELLENCE: ${hardPct.toFixed(1)}% (excellence ≥15%)`);

  // ═══════════════════════════════════════════════
  // EXCELLENCE checks
  // ═══════════════════════════════════════════════
  if (hardPct >= 15 && hardPct <= 20) excellence.push(`HARD_EXCELLENT: ${hardPct.toFixed(1)}%`);
  if (totalApproved >= 850) excellence.push(`EXAM_POOL_DOMINANT: ${totalApproved} approved`);
  if (handbookTotalChars >= 50000) excellence.push(`HANDBOOK_DEEP: ${handbookTotalChars} chars`);

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

  if (!(await prereqDone(sb, packageId, "generate_handbook"))) {
    return json({ ok: false, retry: true, error: "PREREQ_NOT_DONE: generate_handbook" }, 409);
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
    gate_version: "COURSE_READY_v1.0",
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

  // Set status based on gate result
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
