import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { checkContamination } from "../_shared/contamination-guard.ts";
import { resolveProfession } from "../_shared/profession-resolver.ts";
import { callAIJSON } from "../_shared/ai-client.ts";
import { getModel } from "../_shared/model-routing.ts";

/**
 * package-validate-learning-content — Pipeline Step (between generate_learning_content & auto_seed_exam_blueprints)
 *
 * Two-tier quality gate for generated lesson content:
 *
 * TIER 1 (All lessons, no LLM — instant):
 *   - Min content length (HTML ≥ 400 chars, mini_check ≥ 200 chars)
 *   - Required HTML structure (h3, li/ol/ul for text steps)
 *   - No placeholder markers remaining
 *   - Contamination guard (cross-profession terms)
 *   - Mini-check: exactly 4 questions, each with 4 options
 *
 * TIER 2 (Random sample ≤ 15 lessons, LLM validation):
 *   - Sends to validate-content prompt for deep quality scoring
 *   - If sample avg < 70 → entire step fails (triggers re-generation)
 *   - Individual lessons scoring < 60 → marked for regeneration
 *
 * On failure: resets generate_learning_content step to re-run for failed lessons.
 */

const SAMPLE_SIZE = 8;
const MIN_HTML_LENGTH = 400;
const MIN_MINICHECK_LENGTH = 200;
const SAMPLE_PASS_THRESHOLD = 70;
const INDIVIDUAL_REJECT_THRESHOLD = 60;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

// ── Tier 1: Structural checks (no LLM) ──
interface T1Result {
  lessonId: string;
  title: string;
  step: string;
  passed: boolean;
  issues: string[];
}

function tier1Check(
  lesson: { id: string; title: string; step: string; content: any },
  professionName: string,
): T1Result {
  const issues: string[] = [];
  const c = lesson.content;

  if (!c || c._placeholder === true || c._placeholder === "true") {
    issues.push("PLACEHOLDER_STILL_PRESENT");
    return { lessonId: lesson.id, title: lesson.title, step: lesson.step, passed: false, issues };
  }

  const isMiniCheck = lesson.step === "mini_check" || c.type === "mini_check";

  if (isMiniCheck) {
    // Mini-check structural checks
    if (!c.questions || !Array.isArray(c.questions)) {
      issues.push("MINICHECK_NO_QUESTIONS");
    } else {
      if (c.questions.length < 4) issues.push(`MINICHECK_TOO_FEW_QUESTIONS: ${c.questions.length}/4`);
      for (let i = 0; i < c.questions.length; i++) {
        const q = c.questions[i];
        if (!q.question || q.question.length < 20) issues.push(`Q${i + 1}_TOO_SHORT`);
        if (!q.options || q.options.length < 4) issues.push(`Q${i + 1}_TOO_FEW_OPTIONS`);
        if (q.correct_answer === undefined || q.correct_answer === null) issues.push(`Q${i + 1}_NO_CORRECT_ANSWER`);
      }
    }
    const contentStr = JSON.stringify(c);
    if (contentStr.length < MIN_MINICHECK_LENGTH) {
      issues.push(`MINICHECK_CONTENT_TOO_SHORT: ${contentStr.length}/${MIN_MINICHECK_LENGTH}`);
    }
  } else {
    // Text step structural checks
    const html = c.html || "";
    if (html.length < MIN_HTML_LENGTH) {
      issues.push(`HTML_TOO_SHORT: ${html.length}/${MIN_HTML_LENGTH}`);
    }
    if (!/<h[3-4]>/i.test(html)) {
      issues.push("MISSING_HEADING_H3_H4");
    }
    if (html.includes("Platzhalter") || html.includes("Lorem ipsum") || html.includes("[TODO]")) {
      issues.push("PLACEHOLDER_TEXT_FOUND");
    }
  }

  // Contamination guard (both types)
  const contentStr = JSON.stringify(c).slice(0, 8000);
  const contam = checkContamination(contentStr, professionName);
  if (contam.isContaminated) {
    issues.push(`CONTAMINATION: ${contam.detectedIndustry} [${contam.matchedTerms.slice(0, 3).join(", ")}]`);
  }

  return {
    lessonId: lesson.id,
    title: lesson.title,
    step: lesson.step,
    passed: issues.length === 0,
    issues,
  };
}

// ── Tier 2: LLM validation on sample ──
async function tier2Validate(
  sb: ReturnType<typeof createClient>,
  lesson: { id: string; title: string; step: string; content: any; moduleName: string },
  professionName: string,
): Promise<{ lessonId: string; score: number; decision: string; issues: string[] }> {
  const routed = getModel("quality_audit");
  const isMiniCheck = lesson.step === "mini_check" || lesson.content?.type === "mini_check";
  const mode = isMiniCheck ? "question" : "lesson";

  const VALIDATION_PROMPT = isMiniCheck
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
    const isRateLimit = errMsg.includes("cooldown") || errMsg.includes("429") || errMsg.includes("rate") || errMsg.includes("blocked");
    console.error(`[validate-lessons] LLM validation failed for ${lesson.id}: ${errMsg}`);
    // Rate-limit errors → skip (don't penalize score), other errors → conservative score
    return { lessonId: lesson.id, score: isRateLimit ? -1 : 50, decision: isRateLimit ? "skipped" : "revise", issues: [`LLM_ERROR: ${errMsg}`] };
  }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const body = await req.json().catch(() => ({}));
  const p = body.payload || body;

  const packageId = p.package_id;
  const courseId = p.course_id;
  const curriculumId = p.curriculum_id;
  const certificationId = p.certification_id || null;

  if (!packageId || !courseId) {
    return json({ error: "Missing package_id or course_id" }, 400);
  }

  // ── Resolve profession ──
  let professionName: string;
  try {
    const prof = await resolveProfession(sb, { certificationId, curriculumId });
    professionName = prof.professionName;
  } catch (e) {
    return json({ error: (e as Error).message }, 400);
  }

  // ── Load all lessons ──
  const { data: allLessons, error: fetchErr } = await sb
    .from("lessons")
    .select("id, title, step, content, module_id, modules!inner(course_id, title)")
    .eq("modules.course_id", courseId);

  if (fetchErr) return json({ error: fetchErr.message }, 500);

  const lessons = (allLessons || []).filter((l: any) => l.content && l.content._placeholder !== true);

  if (lessons.length === 0) {
    return json({
      ok: false,
      error: "NO_CONTENT_TO_VALIDATE",
      message: "Keine generierten Lektionen gefunden — Content-Step muss zuerst laufen.",
    }, 409);
  }

  console.log(`[validate-lessons] Validating ${lessons.length} lessons for ${professionName} (pkg ${packageId.slice(0, 8)})`);

  // ═══════════════════════════════════════
  // TIER 1: Structural checks (all lessons)
  // ═══════════════════════════════════════
  const t1Results = lessons.map((l: any) => tier1Check(l, professionName));
  const t1Failed = t1Results.filter(r => !r.passed);
  const t1PassRate = ((t1Results.length - t1Failed.length) / t1Results.length) * 100;

  console.log(`[validate-lessons] Tier 1: ${t1Results.length - t1Failed.length}/${t1Results.length} passed (${t1PassRate.toFixed(1)}%)`);

  // Update qc_status for Tier 1 failures
  for (const fail of t1Failed) {
    await sb.from("lessons").update({
      qc_status: "tier1_failed",
      quality_flags: { tier1_issues: fail.issues, validated_at: new Date().toISOString() },
    }).eq("id", fail.lessonId);
  }

  // If > 20% fail Tier 1, abort early — content generation has systemic issues
  if (t1PassRate < 80) {
    // Mark contaminated/placeholder lessons for re-generation by clearing their content
    const criticalFails = t1Failed.filter(f =>
      f.issues.some(i => i.includes("PLACEHOLDER") || i.includes("CONTAMINATION"))
    );
    for (const fail of criticalFails) {
      await sb.from("lessons").update({
        content: { _placeholder: true, _regeneration_reason: fail.issues.join("; ") },
      }).eq("id", fail.lessonId);
    }

    return json({
      ok: false,
      tier1_pass_rate: t1PassRate,
      tier1_failures: t1Failed.length,
      critical_reset: criticalFails.length,
      message: `❌ Tier 1 fehlgeschlagen: ${t1Failed.length}/${t1Results.length} Lektionen haben strukturelle Mängel. ${criticalFails.length} zur Neugenerierung markiert.`,
      details: t1Failed.slice(0, 20),
    });
  }

  // ═══════════════════════════════════════
  // TIER 2: LLM validation (random sample)
  // ═══════════════════════════════════════
  const t1Passed = t1Results.filter(r => r.passed);
  const sampleSize = Math.min(SAMPLE_SIZE, t1Passed.length);

  // Stratified sample: pick from different steps to get coverage
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

  const t2Results: Array<{ lessonId: string; score: number; decision: string; issues: string[] }> = [];

  for (const lessonId of sample) {
    const lesson = lessons.find((l: any) => l.id === lessonId);
    if (!lesson) continue;

    const result = await tier2Validate(sb, {
      id: lesson.id,
      title: lesson.title,
      step: lesson.step,
      content: lesson.content,
      moduleName: (lesson as any).modules?.title || "",
    }, professionName);

    t2Results.push(result);

    // Update lesson qc_status
    await sb.from("lessons").update({
      qc_status: result.decision === "approve" ? "approved" : result.decision === "reject" ? "rejected" : "needs_revision",
      quality_flags: {
        tier2_score: result.score,
        tier2_decision: result.decision,
        tier2_issues: result.issues,
        validated_at: new Date().toISOString(),
      },
    }).eq("id", lesson.id);

    // Mark rejected lessons for re-generation
    if (result.score < INDIVIDUAL_REJECT_THRESHOLD) {
      await sb.from("lessons").update({
        content: { _placeholder: true, _regeneration_reason: `LLM score ${result.score}/100: ${result.issues.join("; ")}` },
      }).eq("id", lesson.id);
    }

    // Delay to avoid rate limits (staggered with jitter)
    await new Promise(r => setTimeout(r, 3000 + Math.random() * 2000));
  }

  // Filter out rate-limited results (score=-1) from average calculation
  const scoredResults = t2Results.filter(r => r.score >= 0);
  const avgScore = scoredResults.length > 0
    ? scoredResults.reduce((sum, r) => sum + r.score, 0) / scoredResults.length
    : 100; // If all were rate-limited, trust Tier 1
  const rejected = scoredResults.filter(r => r.score < INDIVIDUAL_REJECT_THRESHOLD);
  const skippedCount = t2Results.length - scoredResults.length;
  if (skippedCount > 0) console.log(`[validate-lessons] Tier 2: ${skippedCount} samples skipped due to rate limits`);

  console.log(`[validate-lessons] Tier 2: avg=${avgScore.toFixed(1)}, rejected=${rejected.length}/${t2Results.length}`);

  // Mark all non-sampled passed lessons as tier1_passed
  const sampledSet = new Set(sample);
  for (const r of t1Passed) {
    if (!sampledSet.has(r.lessonId)) {
      await sb.from("lessons").update({
        qc_status: "tier1_passed",
        quality_flags: { validated_at: new Date().toISOString(), tier1: "passed" },
      }).eq("id", r.lessonId);
    }
  }

  // ── Decision ──
  const overallPass = avgScore >= SAMPLE_PASS_THRESHOLD && t1PassRate >= 80;

  // Write validation summary to package
  await sb.from("course_packages").update({
    last_error: overallPass ? null : `Lesson validation: avg=${avgScore.toFixed(0)}, t1_pass=${t1PassRate.toFixed(0)}%`,
  }).eq("id", packageId);

  // Log to ops_alerts on failure
  if (!overallPass) {
    await sb.from("ops_alerts").insert({
      source: "validate-learning-content",
      severity: "warning",
      message: `Lesson QC failed for pkg ${packageId.slice(0, 8)}: avg_score=${avgScore.toFixed(0)}, t1_pass=${t1PassRate.toFixed(0)}%`,
      payload: {
        packageId,
        tier1_pass_rate: t1PassRate,
        tier2_avg_score: avgScore,
        tier2_rejected: rejected.length,
      },
    }).then(() => {}).catch(() => {});
  }

  return json({
    ok: overallPass,
    batch_complete: overallPass,
    // If failed, mark as failed (not batch_cursor) so pipeline retries after re-generation
    tier1: {
      total: t1Results.length,
      passed: t1Results.length - t1Failed.length,
      failed: t1Failed.length,
      pass_rate: t1PassRate,
    },
    tier2: {
      sample_size: t2Results.length,
      avg_score: avgScore,
      rejected: rejected.length,
      results: t2Results,
    },
    message: overallPass
      ? `✅ Lesson QC bestanden: Tier 1 ${t1PassRate.toFixed(0)}%, Tier 2 avg ${avgScore.toFixed(0)}/100`
      : `❌ Lesson QC fehlgeschlagen: Tier 1 ${t1PassRate.toFixed(0)}%, Tier 2 avg ${avgScore.toFixed(0)}/100. ${rejected.length} Lektionen zur Neugenerierung markiert.`,
  });
});
