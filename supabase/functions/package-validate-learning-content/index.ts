import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { checkContamination } from "../_shared/contamination-guard.ts";
import { resolveProfession } from "../_shared/profession-resolver.ts";
import { callAIJSON } from "../_shared/ai-client.ts";
import { getModel } from "../_shared/model-routing.ts";
import { mergePackageStepMeta } from "../_shared/merge-step-meta.ts";
import { enqueueJob } from "../_shared/enqueue.ts";
import {
  classifyLearningContent,
  shouldRetryValidation,
  buildContentFingerprint,
  type GateClassification,
  type ValidationSnapshot,
} from "../_shared/learning-content-gate.ts";
import {
  type ValidationIssue,
  type T1Result,
  aggregateFailureModes,
  detectCatastrophicFailures,
} from "../_shared/validation-issue.ts";
import {
  deriveLearningContentCapabilities,
  hasAnyDownstreamCapability,
  type LearningContentCapabilities,
} from "../_shared/learning-content-capabilities.ts";
import { finalizeStepDone, finalizeStepFailed } from "../_shared/step-finalize.ts";
import {
  resolveIntegrityProfile,
  getValidationPolicy,
  buildTier2Prompt,
  buildProfileMeta,
  type ValidationPolicy,
} from "../_shared/validation/learning-content-policy.ts";

/**
 * package-validate-learning-content — Gate-Classified Pipeline Validator (v2.1)
 *
 * P0 hardening:
 *  - Retry guard returns structured reason, forces repair if stuck without mechanism
 *  - Repair enqueue uses SSOT enqueueJob helper with idempotency
 *  - Meta persistence via mergePackageStepMeta (contract-safe)
 *  - Runner-compatible returns: routing states are ok:true, only hard_fail is ok:false
 *  - Fingerprint includes materialized/failed/placeholder counts
 *  - No placeholder reset on hard_fail (mark only, don't destroy data)
 */

const SAMPLE_SIZE = 4;
const MIN_HTML_LENGTH = 400;
const MIN_HTML_WORD_COUNT = 80;
const TARGET_HTML_WORD_COUNT = 200;
const MIN_MINICHECK_LENGTH = 200;
const SAMPLE_PASS_THRESHOLD = 70;
const INDIVIDUAL_REJECT_THRESHOLD = 60;

const META_TEXT_PATTERNS = [
  /\bich muss\b/i, /\bich ändere\b/i, /\btippfehler\b/i,
  /\bes tut mir leid\b/i, /\bich habe einen fehler\b/i,
  /\bich korrigiere\b/i, /\bich prüfe\b/i, /\blass mich\b/i,
  /\bich entschuldige\b/i, /\bfehler in der frage\b/i,
  /\bich habe .{0,20}geändert\b/i,
];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

// ── Tier 1: Structural checks (no LLM) — structured ValidationIssue[] ──

function tier1Check(
  lesson: { id: string; title: string; step: string; content: any },
  professionName: string,
): T1Result {
  const issues: ValidationIssue[] = [];
  const c = lesson.content;

  if (!c || c._placeholder === true || c._placeholder === "true") {
    issues.push({ code: "PLACEHOLDER_STILL_PRESENT", severity: "critical" });
    return { lessonId: lesson.id, title: lesson.title, step: lesson.step, passed: false, issues };
  }

  const isMiniCheck = lesson.step === "mini_check" || c.type === "mini_check";

  if (isMiniCheck) {
    if (!c.questions || !Array.isArray(c.questions)) {
      issues.push({ code: "MINICHECK_NO_QUESTIONS", severity: "error" });
    } else {
      if (c.questions.length < 4) {
        issues.push({ code: "MINICHECK_TOO_FEW_QUESTIONS", severity: "error", metric: c.questions.length, threshold: 4 });
      }
      for (let i = 0; i < c.questions.length; i++) {
        const q = c.questions[i];
        if (!q.question || q.question.length < 20) issues.push({ code: "QUESTION_TOO_SHORT", severity: "warning", detail: `Q${i + 1}` });
        if (!q.options || q.options.length < 4) issues.push({ code: "QUESTION_TOO_FEW_OPTIONS", severity: "warning", detail: `Q${i + 1}` });
        if (q.correct_answer === undefined || q.correct_answer === null) issues.push({ code: "QUESTION_NO_CORRECT_ANSWER", severity: "error", detail: `Q${i + 1}` });
      }
    }
    const contentStr = JSON.stringify(c);
    if (contentStr.length < MIN_MINICHECK_LENGTH) {
      issues.push({ code: "MINICHECK_CONTENT_TOO_SHORT", severity: "error", metric: contentStr.length, threshold: MIN_MINICHECK_LENGTH });
    }
  } else {
    const html = c.html || "";
    if (html.length < MIN_HTML_LENGTH) {
      issues.push({ code: "HTML_TOO_SHORT", severity: "error", metric: html.length, threshold: MIN_HTML_LENGTH });
    }
    const wordCount = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().split(' ').filter((w: string) => w.length > 0).length;
    if (wordCount < MIN_HTML_WORD_COUNT) {
      issues.push({ code: "WORD_COUNT_TOO_LOW", severity: "error", metric: wordCount, threshold: MIN_HTML_WORD_COUNT, detail: `target: ${TARGET_HTML_WORD_COUNT}` });
    }
    if (!/<h[3-4]>/i.test(html)) {
      issues.push({ code: "MISSING_HEADING_H3_H4", severity: "warning" });
    }
    if (html.includes("Platzhalter") || html.includes("Lorem ipsum") || html.includes("[TODO]")) {
      issues.push({ code: "PLACEHOLDER_TEXT_FOUND", severity: "critical" });
    }
    const htmlLower = html.toLowerCase();
    for (const pattern of META_TEXT_PATTERNS) {
      if (pattern.test(htmlLower)) {
        issues.push({ code: "META_TEXT_DETECTED", severity: "error", detail: "AI editing artifact in lesson content" });
        break;
      }
    }
  }

  const contentStr = JSON.stringify(c).slice(0, 8000);
  const contam = checkContamination(contentStr, professionName);
  if (contam.isContaminated) {
    issues.push({ code: "CONTAMINATION", severity: "critical", detail: `${contam.detectedIndustry} [${contam.matchedTerms.slice(0, 3).join(", ")}]` });
  }

  return { lessonId: lesson.id, title: lesson.title, step: lesson.step, passed: issues.length === 0, issues };
}

// ── Tier 2: LLM validation on sample ──
async function tier2Validate(
  sb: ReturnType<typeof createClient>,
  lesson: { id: string; title: string; step: string; content: any; moduleName: string },
  professionName: string,
  policy?: ValidationPolicy,
): Promise<{ lessonId: string; score: number; decision: string; issues: string[] }> {
  const routed = getModel("quality_audit");
  const isMiniCheck = lesson.step === "mini_check" || lesson.content?.type === "mini_check";

  // Use profile-aware prompt if policy is provided
  const VALIDATION_PROMPT = policy
    ? buildTier2Prompt(policy, professionName, isMiniCheck)
    : isMiniCheck
      ? `Du bist ein IHK-Prüfungsexperte. Validiere diese Mini-Check-Fragen für ${professionName}. Prüfe: Eindeutigkeit, Distraktoren-Qualität, IHK-Konformität, Berufsbezug. Antworte NUR mit JSON: {"overall_score": 0-100, "decision": "approve|revise|reject", "dimension_scores": {...}, "critical_issues": [...]}`
      : `Du bist ein IHK-Prüfer und Didaktik-Experte für ${professionName}. Bewerte den Lerninhalt nach: Fachliche Korrektheit (25%), Didaktische Qualität (20%), Prüfungsrelevanz (15%), Sprachliche Klarheit (10%), Vollständigkeit (10%), Berufsbezug (20%). Antworte NUR mit JSON: {"overall_score": 0-100, "decision": "approve|revise|reject", "dimension_scores": {...}, "critical_issues": [...]}`;

  try {
    const aiResult = await callAIJSON({
      provider: routed.provider,
      model: routed.model,
      messages: [
        { role: "system", content: VALIDATION_PROMPT },
        {
          role: "user",
          content: `Beruf: ${professionName}\nModul: ${lesson.moduleName}\nLektion: ${lesson.title}\nSchritt: ${lesson.step}\n\nINHALT:\n${JSON.stringify(lesson.content, null, 2).slice(0, 6000)}`,
        },
      ],
      max_tokens: 2048,
    });

    const cleanText = aiResult.content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const parsed = JSON.parse(cleanText);
    return {
      lessonId: lesson.id,
      score: parsed.overall_score ?? 0,
      decision: parsed.decision ?? (parsed.overall_score >= 85 ? "approve" : parsed.overall_score >= 60 ? "revise" : "reject"),
      issues: (parsed.critical_issues || []).map((i: any) => `${i.severity}: ${i.message}`),
    };
  } catch (e) {
    const errMsg = (e as Error).message || "";
    console.error(`[validate-lessons] LLM validation failed for ${lesson.id}: ${errMsg}`);
    return { lessonId: lesson.id, score: -1, decision: "skipped", issues: [`LLM_ERROR: ${errMsg}`] };
  }
}

// aggregateFailureModes and detectCatastrophicFailures imported from _shared/validation-issue.ts

async function handleRequest(req: Request): Promise<Response> {
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const body = await req.json().catch(() => ({}));
  const p = body.payload || body;

  const packageId = p.package_id;
  let courseId = p.course_id;
  const curriculumId = p.curriculum_id;
  const certificationId = p.certification_id || null;
  const featureFlags = p.feature_flags || {};

  // Resolve course_id from package if not provided directly
  let pkgRow: any = null;
  if (packageId) {
    const { data } = await sb.from("course_packages").select("course_id, feature_flags, integrity_profile, track").eq("id", packageId).maybeSingle();
    pkgRow = data;
    if (!courseId && pkgRow?.course_id) courseId = pkgRow.course_id;
  }

  if (!packageId || !courseId) {
    return json({ error: "Missing package_id or course_id" }, 400);
  }

  const effectiveFlags = { ...(pkgRow?.feature_flags || {}), ...featureFlags };
  const skipMiniCheckLessons = effectiveFlags.has_minichecks === true || effectiveFlags.has_learning_course === true;

  // ── Resolve profession ──
  let professionName: string;
  try {
    const prof = await resolveProfession(sb, { certificationId, curriculumId });
    professionName = prof.professionName;
  } catch (e) {
    return json({ error: (e as Error).message }, 400);
  }

  // ── Resolve integrity profile + validation policy ──
  const integrityProfile = resolveIntegrityProfile({
    integrity_profile: pkgRow?.integrity_profile,
    track: pkgRow?.track,
  });
  const validationPolicy = getValidationPolicy(integrityProfile);
  console.log(`[validate-lessons] Profile: ${integrityProfile}, policy: ${validationPolicy.policyVersion}`);

  // ── Load step meta for fingerprint-based retry guard ──
  const { data: stepRow } = await sb
    .from("package_steps")
    .select("meta")
    .eq("package_id", packageId)
    .eq("step_key", "validate_learning_content")
    .maybeSingle();

  const stepMeta = (stepRow?.meta as Record<string, any>) || {};

  // ── HARDENED v3 (2026-04-19): Pre-Check pending lessons before loading content ──
  // Prevents validator crash on unmaterialized lessons (Ghost-Completion symptom).
  const { count: pendingLessonsCount } = await sb
    .from("lessons")
    .select("id, modules!inner(course_id)", { head: true, count: "exact" })
    .eq("modules.course_id", courseId)
    .neq("step", "mini_check")
    .or("generation_status.eq.pending,generation_status.is.null,content.is.null");

  if ((pendingLessonsCount ?? 0) > 0) {
    console.warn(`[validate-lessons] WAITING_FOR_MATERIALIZATION: pkg=${packageId.slice(0, 8)} pending=${pendingLessonsCount}`);
    await mergePackageStepMeta(sb, packageId, "validate_learning_content", {
      waiting_for_materialization_at: new Date().toISOString(),
      pending_lessons_count: pendingLessonsCount,
    });
    return json({
      ok: true,
      completed: false,
      skipped: true,
      gate_class: "waiting_for_materialization",
      reason_code: "WAITING_FOR_MATERIALIZATION",
      advance_pipeline: false,
      repair_enqueued: false,
      transient: true,
      retry: true,
      message: `⏳ ${pendingLessonsCount} lessons still pending materialization — validator deferred.`,
    });
  }

  // ── Load all lessons ──
  const { data: allLessons, error: fetchErr } = await sb
    .from("lessons")
    .select("id, title, step, content, module_id, created_at, modules!inner(course_id, title)")
    .eq("modules.course_id", courseId);

  if (fetchErr) return json({ error: fetchErr.message }, 500);

  const allNonPlaceholder = (allLessons || []).filter((l: any) => l.content && l.content._placeholder !== true);
  const lessons = skipMiniCheckLessons
    ? allNonPlaceholder.filter((l: any) => l.step !== "mini_check" && l.content?.type !== "mini_check")
    : allNonPlaceholder;
  const skippedMiniChecks = allNonPlaceholder.length - lessons.length;
  if (skippedMiniChecks > 0) {
    console.log(`[validate-lessons] Skipping ${skippedMiniChecks} mini_check lessons (validated by validate_lesson_minichecks)`);
  }

  const totalContentLessons = skipMiniCheckLessons
    ? (allLessons || []).filter((l: any) => l.step !== "mini_check" && l.content?.type !== "mini_check").length
    : (allLessons || []).length;
  const totalLessons = totalContentLessons;

  // Count placeholder lessons for fingerprint
  const placeholderCount = (allLessons || []).filter(
    (l: any) => !l.content || l.content._placeholder === true
  ).length;

  if (lessons.length === 0) {
    if (totalLessons === 0) {
      console.error(`[validate-lessons] PERMANENT: 0 total lessons for course ${courseId}`);
      return json({
        ok: false,
        completed: false,
        error: "PREDECESSOR_FAILURE_NO_LESSONS",
        permanent: true,
        gate_class: "hard_fail",
        reason_code: "NO_MATERIALIZED_CONTENT",
        advance_pipeline: false,
        repair_enqueued: false,
        message: `❌ PERMANENT: Kein einziges Lesson existiert für diesen Kurs.`,
      }, 422);
    }
    return json({
      ok: true,
      completed: true,
      error: "ALL_LESSONS_ARE_PLACEHOLDERS",
      permanent: false,
      gate_class: "major_regeneration_required",
      reason_code: "NO_MATERIALIZED_CONTENT",
      advance_pipeline: false,
      repair_enqueued: false,
      message: `⚠️ Alle ${totalLessons} Lektionen sind Platzhalter — Major Regeneration erforderlich.`,
    });
  }

  // ── Fingerprint-based retry guard (v2 — hardened) ──
  const maxUpdatedAt = lessons.reduce((max: string | null, l: any) => {
    const u = l.created_at;
    return u && (!max || u > max) ? u : max;
  }, null as string | null);

  const currentFingerprint = buildContentFingerprint({
    packageId,
    lessonCount: lessons.length,
    maxUpdatedAt,
    materializedCount: lessons.length,
    placeholderCount,
  });

  // ── Check repair state for retry guard ──
  const repairJobTypes = ["repair_learning_content", "regenerate_learning_content_cluster"];
  const { data: activeRepairJobs } = await sb
    .from("job_queue")
    .select("id, status, job_type")
    .eq("package_id", packageId)
    .in("job_type", repairJobTypes)
    .in("status", ["pending", "queued", "processing"])
    .limit(1);

  const repairInFlight = (activeRepairJobs?.length ?? 0) > 0;

  // Derive repair state from BOTH step meta AND job_queue for robustness
  const lastValidateAt = stepMeta.last_validate_completed_at || null;
  let repairEnqueuedSinceLastValidation = !!(
    stepMeta.repair_enqueued_at && lastValidateAt &&
    stepMeta.repair_enqueued_at > lastValidateAt
  );
  let repairCompletedSinceLastValidation = !!(
    stepMeta.last_repair_completed_at && lastValidateAt &&
    stepMeta.last_repair_completed_at > lastValidateAt
  );

  // Cross-check against job_queue if meta says no repair but DB might disagree
  if (!repairEnqueuedSinceLastValidation && !repairCompletedSinceLastValidation && lastValidateAt) {
    const { data: recentRepairJobs } = await sb
      .from("job_queue")
      .select("id, status, created_at, completed_at")
      .eq("package_id", packageId)
      .in("job_type", repairJobTypes)
      .gt("created_at", lastValidateAt)
      .limit(1);

    if (recentRepairJobs && recentRepairJobs.length > 0) {
      const rj = recentRepairJobs[0];
      if (["pending", "queued", "processing"].includes(rj.status)) {
        repairEnqueuedSinceLastValidation = true;
      } else if (rj.status === "completed" && rj.completed_at) {
        repairCompletedSinceLastValidation = true;
      }
    }
  }

  const retryDecision = shouldRetryValidation({
    previousFingerprint: stepMeta.last_validation_fingerprint || null,
    currentFingerprint,
    previousGateClass: stepMeta.gate_class || null,
    repairCompletedSinceLastValidation,
    repairEnqueuedSinceLastValidation,
    repairInFlight,
  });

  if (!retryDecision.retry) {
    const prevClass = stepMeta.gate_class || "unknown";

    if (retryDecision.reason === "no_repair_mechanism") {
      // CRITICAL: Package is stuck without any repair mechanism.
      // Force-enqueue repair based on previous classification instead of silently skipping.
      console.warn(`[validate-lessons] NO_REPAIR_MECHANISM: gate_class=${prevClass}, forcing repair enqueue for ${packageId.slice(0, 8)}`);
      // Fall through to run validation — this will re-classify and enqueue repair
    } else {
      // Repair is in-flight or enqueued — safe to skip
      console.log(`[validate-lessons] SKIP_RETRY: ${retryDecision.reason}, gate_class=${prevClass}`);
      return json({
        ok: true,
        completed: true,
        skipped: true,
        reason: retryDecision.reason,
        gate_class: prevClass,
        reason_code: stepMeta.reason_code || "REPAIR_ALREADY_ENQUEUED",
        advance_pipeline: false,
        repair_enqueued: repairInFlight || repairEnqueuedSinceLastValidation,
        message: `⏭ Validator übersprungen: ${retryDecision.reason} (gate_class=${prevClass}).`,
      });
    }
  }

  console.log(`[validate-lessons] Validating ${lessons.length} lessons for ${professionName} (pkg ${packageId.slice(0, 8)})`);

  // ═══════════════════════════════════════
  // TIER 1: Structural checks (all lessons)
  // ═══════════════════════════════════════
  const t1Results = lessons.map((l: any) => tier1Check(l, professionName));
  const t1Failed = t1Results.filter(r => !r.passed);
  const t1PassRate = ((t1Results.length - t1Failed.length) / t1Results.length);
  const t1PassPct = t1PassRate * 100;

  console.log(`[validate-lessons] Tier 1: ${t1Results.length - t1Failed.length}/${t1Results.length} passed (${t1PassPct.toFixed(1)}%)`);

  // Batch update qc_status for Tier 1 failures
  const failIds = t1Failed.map(f => f.lessonId);
  if (failIds.length > 0) {
    for (let i = 0; i < failIds.length; i += 50) {
      const chunk = failIds.slice(i, i + 50);
      await sb.from("lessons").update({
        qc_status: "tier1_failed",
        quality_flags: { tier1: "failed", validated_at: new Date().toISOString() },
      }).in("id", chunk);
    }
  }

  // ── Gate Classification (replaces binary pass/fail) ──
  const snapshot: ValidationSnapshot = {
    tier1PassRate: t1PassRate,
    catastrophicFailures: 0,
    materializedLessons: lessons.length,
    totalLessons,
    ssotBroken: false,
    invalidStructure: false,
  };

  // Detect catastrophic failures using structured issue codes + severity
  snapshot.catastrophicFailures = detectCatastrophicFailures(t1Failed, totalLessons);

  const classification = classifyLearningContent(snapshot, {
    thresholdHealthy: validationPolicy.thresholdHealthy,
    thresholdSoftPass: validationPolicy.thresholdSoftPass,
    thresholdRepairable: validationPolicy.thresholdRepairable,
  });

  // ── Derive capability-based downstream routing ──
  const capabilities = deriveLearningContentCapabilities({
    gateClass: classification.gateClass,
    tier1PassRate: t1PassRate,
    materializedLessons: lessons.length,
    totalLessons,
  });

  console.log(`[validate-lessons] Gate Classification: ${classification.gateClass} (reason: ${classification.reasonCode}, capabilities: ${JSON.stringify(capabilities)})`);

  // ── Failure mode map for repair jobs ──
  const failureModes = aggregateFailureModes(t1Failed);
  const affectedLessons = t1Failed.map(f => f.lessonId);

  // ── For hard_fail with critical issues: MARK (don't reset) lessons ──
  if (classification.gateClass === "hard_fail") {
    const criticalLessons = t1Failed.filter(f =>
      f.issues.some(i => i.severity === "critical")
    );
    if (criticalLessons.length > 0) {
      const criticalIds = criticalLessons.map(f => f.lessonId);
      for (let i = 0; i < criticalIds.length; i += 50) {
        const chunk = criticalIds.slice(i, i + 50);
        await sb.from("lessons").update({
          quality_flags: {
            needs_regeneration: true,
            regeneration_reason: "tier1_critical_fail",
            flagged_at: new Date().toISOString(),
          },
        }).in("id", chunk);
      }
    }
  }

  // ═══════════════════════════════════════
  // TIER 2: LLM validation (only when downstream is allowed)
  // ═══════════════════════════════════════
  let t2Results: Array<{ lessonId: string; score: number; decision: string; issues: string[] }> = [];
  let avgScore = 100;

  if (hasAnyDownstreamCapability(capabilities)) {
    const t1Passed = t1Results.filter(r => r.passed);
    const sampleSize = Math.min(SAMPLE_SIZE, t1Passed.length);

    const byStep = new Map<string, typeof t1Passed>();
    for (const r of t1Passed) {
      const arr = byStep.get(r.step) || [];
      arr.push(r);
      byStep.set(r.step, arr);
    }

    const sample: string[] = [];
    const stepsArray = [...byStep.entries()];
    let idx = 0;
    while (sample.length < sampleSize && stepsArray.some(([, arr]) => arr.length > 0)) {
      const [, arr] = stepsArray[idx % stepsArray.length];
      if (arr.length > 0) {
        const randomIdx = Math.floor(Math.random() * arr.length);
        sample.push(arr[randomIdx].lessonId);
        arr.splice(randomIdx, 1);
      }
      idx++;
    }

    console.log(`[validate-lessons] Tier 2: Sampling ${sample.length} lessons for LLM validation`);

    const t2Promises = sample.map(async (lessonId) => {
      const lesson = lessons.find((l: any) => l.id === lessonId);
      if (!lesson) return null;
      const result = await tier2Validate(sb, {
        id: lesson.id,
        title: lesson.title,
        step: lesson.step,
        content: lesson.content,
        moduleName: (lesson as any).modules?.title || "",
      }, professionName, validationPolicy);
      if (result.score >= 0) {
        await sb.from("lessons").update({
          qc_status: result.decision === "approve" ? "approved" : result.decision === "reject" ? "rejected" : "needs_revision",
          quality_flags: {
            tier2_score: result.score,
            tier2_decision: result.decision,
            validated_at: new Date().toISOString(),
          },
        }).eq("id", lesson.id);
        if (result.score < INDIVIDUAL_REJECT_THRESHOLD) {
          await sb.from("lessons").update({
            quality_flags: {
              needs_regeneration: true,
              regeneration_reason: `LLM score ${result.score}/100`,
              flagged_at: new Date().toISOString(),
            },
          }).eq("id", lesson.id);
        }
      }
      return result;
    });

    const t2ResultsRaw = await Promise.all(t2Promises);
    t2Results = t2ResultsRaw.filter(Boolean) as typeof t2Results;

    const scoredResults = t2Results.filter(r => r.score >= 0);
    avgScore = scoredResults.length > 0
      ? scoredResults.reduce((sum, r) => sum + r.score, 0) / scoredResults.length
      : 100;

    // Mark non-sampled passed lessons as tier1_passed
    const sampledSet = new Set(sample);
    const passedNotSampled = t1Results.filter(r => r.passed && !sampledSet.has(r.lessonId)).map(r => r.lessonId);
    for (let i = 0; i < passedNotSampled.length; i += 100) {
      const chunk = passedNotSampled.slice(i, i + 100);
      await sb.from("lessons").update({
        qc_status: "tier1_passed",
        quality_flags: { validated_at: new Date().toISOString(), tier1: "passed" },
      }).in("id", chunk);
    }
  }

  // ── Determine final step outcome based on classification + capabilities ──
  const overallPass = hasAnyDownstreamCapability(capabilities) && avgScore >= SAMPLE_PASS_THRESHOLD;

  // ── Persist gate classification + capabilities in step meta (contract-safe merge) ──
  const now = new Date().toISOString();
  const profileMeta = buildProfileMeta(integrityProfile, validationPolicy, {
    integrity_profile: pkgRow?.integrity_profile,
    track: pkgRow?.track,
  });
  const metaPatch: Record<string, any> = {
    ...profileMeta,
    gate_class: classification.gateClass,
    repair_action: classification.repairAction,
    reason_code: classification.reasonCode,
    quality_debt: classification.qualityDebt,
    allows_downstream: overallPass,
    capabilities,
    tier1_pass_rate: t1PassRate,
    tier1_total: t1Results.length,
    tier1_passed: t1Results.length - t1Failed.length,
    tier2_avg_score: avgScore,
    affected_lessons_count: affectedLessons.length,
    top_failure_modes: failureModes.slice(0, 10),
    last_validation_fingerprint: currentFingerprint,
    last_validate_completed_at: now,
  };
  if (overallPass) {
    metaPatch.validation_passed = true;
  }

  await mergePackageStepMeta(sb, packageId, "validate_learning_content", metaPatch);

  // If passing, finalize via SSOT path
  if (overallPass) {
    await finalizeStepDone(sb, packageId, "validate_learning_content", {
      gate_class: classification.gateClass,
      tier1_pass_rate: t1PassRate,
      tier2_avg_score: avgScore,
    });
  }

  // ── Enqueue repair jobs for non-passing classifications (via SSOT helper) ──
  let repairEnqueued = false;
  if (
    classification.repairAction === "enqueue_targeted_repair" ||
    classification.repairAction === "enqueue_major_regeneration"
  ) {
    // Both targeted and major repairs use the same job type — repair_mode in
    // the payload distinguishes them. The legacy "regenerate_learning_content_cluster"
    // job type was never deployed as an edge function (404 drift).
    const repairJobType = "repair_learning_content";

    try {
      const result = await enqueueJob(sb, {
        job_type: repairJobType,
        package_id: packageId,
        payload: {
          package_id: packageId,
          course_id: courseId,
          curriculum_id: curriculumId,
          lessons: affectedLessons.slice(0, 100),
          failure_modes: failureModes.slice(0, 10),
          repair_mode: classification.repairAction === "enqueue_targeted_repair" ? "targeted" : "major",
          requested_by: "validate_learning_content",
          gate_class: classification.gateClass,
        },
        priority: classification.repairAction === "enqueue_major_regeneration" ? 85 : 70,
        max_attempts: 3,
      });

      repairEnqueued = true;
      console.log(`[validate-lessons] Enqueued ${repairJobType} (${result.revived ? "revived" : "new"}) for pkg ${packageId.slice(0, 8)} — ${affectedLessons.length} affected lessons`);

      // Persist repair enqueue timestamp
      await mergePackageStepMeta(sb, packageId, "validate_learning_content", {
        repair_enqueued_at: now,
        repair_job_type: repairJobType,
        repair_job_id: result.id,
      });
    } catch (enqErr: any) {
      console.error(`[validate-lessons] Failed to enqueue ${repairJobType}: ${enqErr.message}`);
      // Still mark that we attempted
      await mergePackageStepMeta(sb, packageId, "validate_learning_content", {
        repair_enqueue_error: enqErr.message,
        repair_enqueue_attempted_at: now,
      });
    }
  }

  // ── Write summary to package ──
  await sb.from("course_packages").update({
    last_error: overallPass ? null : `Lesson validation: gate=${classification.gateClass}, t1=${t1PassPct.toFixed(0)}%, t2_avg=${avgScore.toFixed(0)}`,
  }).eq("id", packageId);

  // ── Ops alert on non-healthy ──
  if (!overallPass) {
    try {
      await sb.from("ops_alerts").insert({
        source: "validate-learning-content",
        severity: classification.gateClass === "hard_fail" ? "error" : "warning",
        message: `Lesson QC: gate=${classification.gateClass} for pkg ${packageId.slice(0, 8)}: t1=${t1PassPct.toFixed(0)}%, repair=${classification.repairAction}`,
        payload: {
          package_id: packageId,
          gate_class: classification.gateClass,
          reason_code: classification.reasonCode,
          tier1_pass_rate: t1PassRate,
          tier2_avg_score: avgScore,
          repair_action: classification.repairAction,
          repair_enqueued: repairEnqueued,
          affected_lessons_count: affectedLessons.length,
          capabilities,
        },
      });
    } catch (_e) { /* best-effort */ }
  }

  // ── Runner-compatible response ──
  // Routing states (repair_required, major_regen) are ok:true completed:true
  // Only hard_fail is ok:false
  const isHardFail = classification.gateClass === "hard_fail";

  return json({
    ok: !isHardFail,
    completed: true,
    permanent: isHardFail,
    gate_class: classification.gateClass,
    reason_code: classification.reasonCode,
    repair_action: classification.repairAction,
    quality_debt: classification.qualityDebt,
    advance_pipeline: overallPass,
    repair_enqueued: repairEnqueued,
    capabilities,
    tier1: {
      total: t1Results.length,
      passed: t1Results.length - t1Failed.length,
      failed: t1Failed.length,
      pass_rate: t1PassPct,
    },
    tier2: {
      sample_size: t2Results.length,
      avg_score: avgScore,
      rejected: t2Results.filter(r => r.score >= 0 && r.score < INDIVIDUAL_REJECT_THRESHOLD).length,
      results: t2Results,
    },
    top_failure_modes: failureModes.slice(0, 5),
    affected_lessons_count: affectedLessons.length,
    message: overallPass
      ? `✅ Lesson QC bestanden (${classification.gateClass}): Tier 1 ${t1PassPct.toFixed(0)}%, Tier 2 avg ${avgScore.toFixed(0)}/100`
      : isHardFail
        ? `❌ Hard Fail: ${classification.reasonCode} — Tier 1 ${t1PassPct.toFixed(0)}%`
        : `⚠️ ${classification.gateClass}: Tier 1 ${t1PassPct.toFixed(0)}%, Repair: ${repairEnqueued ? "enqueued" : "pending"}`,
  });
}

// ── HARDENED v3 (2026-04-19): Top-level try/catch prevents HTTP 500 crashes ──
Deno.serve(async (req) => {
  try {
    return await handleRequest(req);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    console.error(`[validate-lessons] UNHANDLED EXCEPTION: ${msg}`);
    if (stack) console.error(stack);

    const isTransient =
      msg.includes("timeout") || msg.includes("TIMEOUT") ||
      msg.includes("AbortError") || msg.includes("connection") ||
      msg.includes("fetch failed") || msg.includes("ECONNRESET");

    return json({
      ok: false,
      completed: false,
      retry: isTransient,
      transient: isTransient,
      gate_class: "validator_exception",
      reason_code: "VALIDATE_LEARNING_CONTENT_EXCEPTION",
      error: `UNHANDLED: ${msg.slice(0, 300)}`,
      hint: "Validator threw — see edge function logs for stack trace",
    }, isTransient ? 503 : 500);
  }
});
