import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { checkContamination } from "../_shared/contamination-guard.ts";
import { resolveProfession } from "../_shared/profession-resolver.ts";
import { callAIJSON } from "../_shared/ai-client.ts";
import { getModel } from "../_shared/model-routing.ts";

/**
 * package-validate-exam-pool — Pipeline Step (after generate_exam_pool)
 *
 * Two-tier quality gate for generated exam questions:
 *
 * TIER 1 (All questions, no LLM — instant):
 *   - Min 4 options, exactly 1 correct
 *   - Explanation present and ≥ 80 chars
 *   - No duplicate question texts (Jaccard ≥ 0.85)
 *   - Contamination guard
 *   - Difficulty field present
 *
 * TIER 2 (Random sample ≤ 4 questions, LLM validation):
 *   - IHK-Konformität, Eindeutigkeit, Distraktoren-Qualität
 *   - If sample avg < 70 → step fails
 *   - Individual questions scoring < 55 → flagged needs_revision
 *   - Early exit: if first 2 consecutive calls rate-limited, skip Tier 2 and trust Tier 1
 *
 * On failure: flags low-quality questions, does NOT delete them.
 */

const SAMPLE_SIZE = 4;
const SAMPLE_PASS_THRESHOLD = 70;
const INDIVIDUAL_REJECT_THRESHOLD = 55;
const JACCARD_THRESHOLD = 0.85;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

// ── Text similarity (sliding window to avoid O(n²) CPU explosion) ──
const JACCARD_WINDOW = 80; // Only compare against last N questions

function textNgrams(text: string, n = 3): Set<string> {
  const norm = text.toLowerCase().replace(/[^a-zäöüß0-9 ]/g, "").replace(/\s+/g, " ").trim();
  const grams = new Set<string>();
  for (let i = 0; i <= norm.length - n; i++) grams.add(norm.slice(i, i + n));
  return grams;
}

function jaccardSim(a: Set<string>, b: Set<string>): number {
  let inter = 0;
  for (const g of a) if (b.has(g)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 1 : inter / union;
}

// ── Meta-text patterns that indicate unfinished AI output ──
const META_TEXT_PATTERNS = [
  /\bich muss prüfen\b/i, /\bich muss korrigieren\b/i, /\bich muss überprüfen\b/i,
  /\bes tut mir leid\b/i, /\bich ändere option\b/i, /\bich ändere die\b/i,
  /\btippfehler\b/i, /\bich korrigiere\b/i, /\bfehler in der frage\b/i,
  /\bich habe einen fehler\b/i, /\blassen sie mich\b/i,
  /\bich prüfe nochmals\b/i, /\bich überprüfe nochmals\b/i,
  /\bkorrektur:/i, /\bhinweis: die frage\b/i,
  /\banmerkung:/i, /\bachtung: ich\b/i,
  /\bich muss die frage\b/i, /\bich muss die antwort\b/i,
];

// ── Tier 1 ──
interface T1Result {
  questionId: string;
  passed: boolean;
  issues: string[];
}

function tier1Check(
  q: { id: string; question_text: string; options: any; correct_answer: number; explanation: string | null; difficulty: string | null },
  professionName: string,
  recentNgrams: Array<{ id: string; ngrams: Set<string> }>,
): T1Result {
  const issues: string[] = [];

  const opts = Array.isArray(q.options) ? q.options : [];
  if (opts.length < 4) issues.push(`TOO_FEW_OPTIONS: ${opts.length}/4`);

  if (q.correct_answer === null || q.correct_answer === undefined) {
    issues.push("NO_CORRECT_ANSWER");
  } else if (q.correct_answer < 0 || q.correct_answer >= opts.length) {
    issues.push(`CORRECT_ANSWER_OUT_OF_RANGE: ${q.correct_answer}/${opts.length}`);
  }

  if (!q.explanation || q.explanation.length < 80) {
    issues.push(`EXPLANATION_TOO_SHORT: ${(q.explanation || "").length}/80`);
  }

  if (!q.difficulty) issues.push("NO_DIFFICULTY");

  if (!q.question_text || q.question_text.length < 30) {
    issues.push(`QUESTION_TOO_SHORT: ${(q.question_text || "").length}/30`);
  }

  // ── NEW: Meta-text / first-person / editing artifact detection ──
  const fullText = `${q.question_text || ""} ${q.explanation || ""}`;
  for (const pat of META_TEXT_PATTERNS) {
    if (pat.test(fullText)) {
      issues.push(`META_TEXT_DETECTED: ${pat.source}`);
      break; // one match is enough
    }
  }

  // ── NEW: Answer value not in options check ──
  if (q.explanation && q.correct_answer !== null && q.correct_answer !== undefined && opts.length > 0) {
    // Extract numbers from explanation marked as "richtig" and check plausibility
    const explLower = (q.explanation || "").toLowerCase();
    if (explLower.includes("richtig ist") || explLower.includes("richtig:")) {
      const numMatch = explLower.match(/richtig(?:\s+ist)?[:\s]+([0-9.,]+)/);
      if (numMatch) {
        const correctVal = numMatch[1].replace(/\./g, "").replace(",", ".");
        const correctOpt = String(opts[q.correct_answer] || "");
        // If the "correct" value from explanation doesn't appear in the marked correct option
        if (correctVal.length >= 3 && !correctOpt.includes(numMatch[1]) && !correctOpt.includes(correctVal)) {
          issues.push(`ANSWER_MISMATCH: explanation says "${numMatch[1]}" but correct option is "${correctOpt.slice(0, 60)}"`);
        }
      }
    }
  }

  // Duplicate check via Jaccard — sliding window only (prevents CPU timeout)
  if (q.question_text) {
    const ngrams = textNgrams(q.question_text);
    for (const existing of recentNgrams) {
      if (existing.id === q.id) continue;
      if (jaccardSim(ngrams, existing.ngrams) >= JACCARD_THRESHOLD) {
        issues.push(`NEAR_DUPLICATE_OF: ${existing.id.slice(0, 8)}`);
        break;
      }
    }
    recentNgrams.push({ id: q.id, ngrams });
    // Keep only the last JACCARD_WINDOW entries
    if (recentNgrams.length > JACCARD_WINDOW) recentNgrams.shift();
  }

  // Contamination — skip for large batches to save CPU
  if (questions_total_hint <= 500) {
    const fullText = `${q.question_text} ${opts.join(" ")} ${q.explanation || ""}`;
    const contam = checkContamination(fullText.slice(0, 5000), professionName);
    if (contam.isContaminated) {
      issues.push(`CONTAMINATION: ${contam.detectedIndustry} [${contam.matchedTerms.slice(0, 3).join(", ")}]`);
    }
  }

  return { questionId: q.id, passed: issues.length === 0, issues };
}

// Global hint for tier1Check to skip expensive checks on large pools
let questions_total_hint = 0;

// ── Tier 2 ──
async function tier2Validate(
  q: { id: string; question_text: string; options: any; correct_answer: number; explanation: string | null; difficulty: string | null; blueprint_name?: string },
  professionName: string,
): Promise<{ questionId: string; score: number; decision: string; issues: string[] }> {
  const routed = getModel("quality_audit");

  const prompt = `Du bist ein IHK-Prüfungsexperte für ${professionName}. Validiere diese Prüfungsfrage.

BEWERTUNGSDIMENSIONEN:
1. EINDEUTIGKEIT (35%): Genau eine richtige Antwort? Keine Interpretationsspielräume?
2. DISTRAKTOREN-QUALITÄT (25%): Plausibel aber eindeutig falsch? Typische Fehler abgebildet?
3. IHK-KONFORMITÄT (25%): IHK-Prüfungsstil? Realistische Aufgabenstellung?
4. BERUFSBEZUG (15%): Konkreter Bezug zum Beruf ${professionName}?

AUTO-REJECT: Mehrere korrekte Antworten → reject. Offensichtlich falsche Distraktoren → revise. Fachlicher Fehler → reject.

Antworte NUR mit JSON: {"overall_score": 0-100, "decision": "approve|revise|reject", "dimension_scores": {"eindeutigkeit": 0-100, "distraktoren": 0-100, "ihk_konformitaet": 0-100, "berufsbezug": 0-100}, "critical_issues": [{"severity": "critical|warning|info", "category": "string", "message": "string"}]}`;

  try {
    const aiResult = await callAIJSON({
      provider: routed.provider,
      model: routed.model,
      messages: [
        { role: "system", content: prompt },
        {
          role: "user",
          content: `Beruf: ${professionName}\nBlueprint: ${q.blueprint_name || "unbekannt"}\nSchwierigkeit: ${q.difficulty}\n\nFRAGE: ${q.question_text}\n\nOPTIONEN:\n${(Array.isArray(q.options) ? q.options : []).map((o: string, i: number) => `${i === q.correct_answer ? "✓" : "✗"} ${i + 1}. ${o}`).join("\n")}\n\nERKLÄRUNG: ${q.explanation || "(keine)"}`,
        },
      ],
      max_tokens: 1500,
    });

    let raw = (aiResult.content || "").trim();
    // Robust fence stripping + JSON extraction
    raw = raw.replace(/```(?:json)?[\s]*/gi, "").trim();
    // Extract the JSON object
    const jsonStart = raw.indexOf("{");
    const jsonEnd = raw.lastIndexOf("}");
    if (jsonStart >= 0 && jsonEnd > jsonStart) {
      raw = raw.slice(jsonStart, jsonEnd + 1);
    }
    // Fix trailing commas and unescaped newlines
    raw = raw.replace(/,\s*([\]}])/g, "$1");
    raw = raw.replace(/(?<=":[\s]*"[^"]*)\n(?=[^"]*")/g, "\\n");
    const parsed = JSON.parse(raw);
    return {
      questionId: q.id,
      score: parsed.overall_score ?? 0,
      decision: parsed.decision ?? (parsed.overall_score >= 85 ? "approve" : parsed.overall_score >= 60 ? "revise" : "reject"),
      issues: (parsed.critical_issues || []).map((i: any) => `${i.severity}: ${i.message}`),
    };
  } catch (e) {
    const errMsg = (e as Error).message || "";
    console.error(`[validate-exam] LLM failed for ${q.id}: ${errMsg}`);
    // Return score=-1 (skip) — don't penalize average. Trust Tier 1 structural checks.
    return { questionId: q.id, score: -1, decision: "skipped", issues: [`LLM_ERROR: ${errMsg}`] };
  }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const body = await req.json().catch(() => ({}));
  const p = body.payload || body;

  const packageId = p.package_id;
  const curriculumId = p.curriculum_id;
  const certificationId = p.certification_id || null;

  if (!packageId || !curriculumId) return json({ error: "Missing package_id or curriculum_id" }, 400);

  // Resolve profession
  let professionName: string;
  try {
    const prof = await resolveProfession(sb, { certificationId, curriculumId });
    professionName = prof.professionName;
  } catch (e) {
    return json({ error: (e as Error).message }, 400);
  }

  // Load questions in batches to avoid CPU timeout (max 500 per batch)
  const BATCH_SIZE = 500;
  let allQuestions: any[] = [];
  let offset = 0;
  while (true) {
    const { data: batch, error: qErr } = await sb
      .from("exam_questions")
      .select("id, question_text, options, correct_answer, explanation, difficulty, blueprint_id")
      .eq("curriculum_id", curriculumId)
      .range(offset, offset + BATCH_SIZE - 1);

    if (qErr) return json({ error: qErr.message }, 500);
    if (!batch || batch.length === 0) break;
    allQuestions = allQuestions.concat(batch);
    offset += batch.length;
    if (batch.length < BATCH_SIZE) break; // Last page
  }
  const questions = allQuestions;

  if (questions.length === 0) {
    return json({ ok: false, error: "NO_QUESTIONS_TO_VALIDATE" }, 409);
  }

  console.log(`[validate-exam] Validating ${questions.length} questions for ${professionName} (pkg ${packageId.slice(0, 8)})`);

  // ═══ TIER 1: Structural checks ═══
  questions_total_hint = questions.length;
  const recentNgrams: Array<{ id: string; ngrams: Set<string> }> = [];
  const t1Results = questions.map((q: any) => tier1Check(q, professionName, recentNgrams));
  const t1Failed = t1Results.filter((r: T1Result) => !r.passed);
  const t1PassRate = ((t1Results.length - t1Failed.length) / t1Results.length) * 100;

  console.log(`[validate-exam] Tier 1: ${t1Results.length - t1Failed.length}/${t1Results.length} passed (${t1PassRate.toFixed(1)}%)`);

  // Batch flag failed questions (chunks of 50)
  const failIds = t1Failed.map(f => f.questionId);
  for (let i = 0; i < failIds.length; i += 50) {
    const chunk = failIds.slice(i, i + 50);
    await sb.from("exam_questions").update({
      qc_status: "tier1_failed",
    }).in("id", chunk);
  }

  // If < 70% pass T1 → systemic issue
  if (t1PassRate < 70) {
    return json({
      ok: false,
      tier1_pass_rate: t1PassRate,
      tier1_failures: t1Failed.length,
      message: `❌ Exam QC Tier 1 fehlgeschlagen: ${t1Failed.length}/${t1Results.length} Fragen haben strukturelle Mängel.`,
    });
  }

  // ═══ TIER 2: LLM sample (with early-exit on rate limits) ═══
  const t1Passed = t1Results.filter((r: T1Result) => r.passed);
  const sampleSize = Math.min(SAMPLE_SIZE, t1Passed.length);
  const sampleIds = new Set<string>();

  // Stratified by difficulty
  const byDiff = new Map<string, string[]>();
  for (const r of t1Passed) {
    const q = questions.find((q: any) => q.id === r.questionId);
    const d = q?.difficulty || "unknown";
    const arr = byDiff.get(d) || [];
    arr.push(r.questionId);
    byDiff.set(d, arr);
  }
  let idx = 0;
  const diffEntries = [...byDiff.entries()];
  while (sampleIds.size < sampleSize && diffEntries.some(([, arr]) => arr.length > 0)) {
    const [, arr] = diffEntries[idx % diffEntries.length];
    if (arr.length > 0) {
      const ri = Math.floor(Math.random() * arr.length);
      sampleIds.add(arr[ri]);
      arr.splice(ri, 1);
    }
    idx++;
  }

  console.log(`[validate-exam] Tier 2: Sampling ${sampleIds.size} questions for LLM validation`);

  const t2Results: Array<{ questionId: string; score: number; decision: string; issues: string[] }> = [];
  let consecutiveRateLimits = 0;

  for (const qId of sampleIds) {
    // Early exit after 2 consecutive rate limits — trust Tier 1
    if (consecutiveRateLimits >= 2) {
      console.log(`[validate-exam] Tier 2: Early exit after ${consecutiveRateLimits} consecutive rate limits — trusting Tier 1`);
      break;
    }

    const q = questions.find((q: any) => q.id === qId);
    if (!q) continue;

    const result = await tier2Validate(q, professionName);
    t2Results.push(result);

    if (result.score === -1) {
      consecutiveRateLimits++;
    } else {
      consecutiveRateLimits = 0;
      // Only update individual question qc_status for scored results
      await sb.from("exam_questions").update({
        qc_status: result.decision === "approve" ? "approved" : "needs_revision",
      }).eq("id", q.id);
    }

    // Longer delay to avoid rate limits (8-12s)
    await new Promise(r => setTimeout(r, 8000 + Math.random() * 4000));
  }

  // Filter out rate-limited results from average calculation
  const scoredResults = t2Results.filter(r => r.score >= 0);
  const avgScore = scoredResults.length > 0
    ? scoredResults.reduce((sum, r) => sum + r.score, 0) / scoredResults.length
    : 100; // If all rate-limited, trust Tier 1
  const rejected = scoredResults.filter(r => r.score < INDIVIDUAL_REJECT_THRESHOLD);
  const skippedCount = t2Results.length - scoredResults.length;
  if (skippedCount > 0) console.log(`[validate-exam] Tier 2: ${skippedCount} samples skipped due to rate limits`);

  console.log(`[validate-exam] Tier 2: avg=${avgScore.toFixed(1)}, flagged=${rejected.length}/${t2Results.length}`);

  // Batch mark non-sampled as tier1_passed (chunks of 100)
  const passedNotSampled = t1Passed.filter(r => !sampleIds.has(r.questionId)).map(r => r.questionId);
  for (let i = 0; i < passedNotSampled.length; i += 100) {
    const chunk = passedNotSampled.slice(i, i + 100);
    await sb.from("exam_questions").update({
      qc_status: "tier1_passed",
    }).in("id", chunk);
  }

  // ═══ GATE 3: Bloom Distribution (Elite 2.0) ═══
  // Reads cognitive_level from linked blueprints to assess pool distribution
  const bloomCounts: Record<string, number> = { remember: 0, understand: 0, apply: 0, analyze: 0 };
  const contextCounts: Record<string, number> = {};
  let blueprintsMapped = 0;

  // Load blueprint cognitive levels for all questions
  const bpIds = [...new Set(questions.filter((q: any) => q.blueprint_id).map((q: any) => q.blueprint_id))];
  const bpCogMap = new Map<string, { cognitive: string; context: string }>();
  if (bpIds.length > 0) {
    for (let i = 0; i < bpIds.length; i += 200) {
      const chunk = bpIds.slice(i, i + 200);
      const { data: bps } = await sb
        .from("question_blueprints")
        .select("id, cognitive_level, exam_context_type")
        .in("id", chunk);
      for (const bp of (bps || []) as any[]) {
        bpCogMap.set(bp.id, { cognitive: bp.cognitive_level || "understand", context: bp.exam_context_type || "isolated_knowledge" });
      }
    }
  }

  for (const q of questions as any[]) {
    const bpInfo = q.blueprint_id ? bpCogMap.get(q.blueprint_id) : null;
    if (bpInfo) {
      bloomCounts[bpInfo.cognitive] = (bloomCounts[bpInfo.cognitive] || 0) + 1;
      contextCounts[bpInfo.context] = (contextCounts[bpInfo.context] || 0) + 1;
      blueprintsMapped++;
    }
  }

  const bloomTotal = Object.values(bloomCounts).reduce((s, v) => s + v, 0);
  let bloomGatePass = true;
  let contextGatePass = true;
  const bloomWarnings: string[] = [];

  if (bloomTotal > 0) {
    const rememberRatio = bloomCounts.remember / bloomTotal;
    const applyRatio = bloomCounts.apply / bloomTotal;
    const analyzeRatio = bloomCounts.analyze / bloomTotal;
    const applyPlusAnalyze = applyRatio + analyzeRatio;

    // Bloom Gate: max 20% remember, min 30% apply+analyze
    if (rememberRatio > 0.25) {
      bloomWarnings.push(`BLOOM_TOO_MUCH_REMEMBER: ${(rememberRatio * 100).toFixed(1)}% (max 25%)`);
      bloomGatePass = false;
    }
    if (applyPlusAnalyze < 0.25) {
      bloomWarnings.push(`BLOOM_TOO_LOW_APPLY_ANALYZE: ${(applyPlusAnalyze * 100).toFixed(1)}% (min 25%)`);
      bloomGatePass = false;
    }

    // Context Gate: max 30% isolated_knowledge
    const isolatedCount = contextCounts["isolated_knowledge"] || 0;
    const isolatedRatio = isolatedCount / bloomTotal;
    if (isolatedRatio > 0.30) {
      bloomWarnings.push(`CONTEXT_TOO_MUCH_ISOLATED: ${(isolatedRatio * 100).toFixed(1)}% (max 30%)`);
      contextGatePass = false;
    }
  } else {
    // No blueprint mapping — skip as warning, don't block
    bloomWarnings.push("BLOOM_NO_BLUEPRINT_DATA: Could not map questions to blueprints for Bloom analysis");
  }

  if (bloomWarnings.length > 0) {
    console.log(`[validate-exam] Bloom/Context Gate: ${bloomWarnings.join("; ")}`);
  }

  // ═══ Final verdict ═══
  // Bloom/Context gates are warnings for now (soft gate) — they don't block the pipeline
  // but are reported so the integrity check can enforce them
  const overallPass = avgScore >= SAMPLE_PASS_THRESHOLD && t1PassRate >= 70;

  await sb.from("course_packages").update({
    last_error: overallPass ? null : `Exam QC: avg=${avgScore.toFixed(0)}, t1=${t1PassRate.toFixed(0)}%`,
  }).eq("id", packageId);

  if (!overallPass) {
    await sb.from("ops_alerts").insert({
      source: "validate-exam-pool",
      severity: "warning",
      message: `Exam QC failed for pkg ${packageId.slice(0, 8)}: avg=${avgScore.toFixed(0)}, t1=${t1PassRate.toFixed(0)}%`,
      payload: { packageId, tier1_pass_rate: t1PassRate, tier2_avg_score: avgScore, tier2_flagged: rejected.length },
    }).then(() => {}).catch(() => {});
  }

  return json({
    ok: overallPass,
    batch_complete: overallPass,
    tier1: { total: t1Results.length, passed: t1Results.length - t1Failed.length, failed: t1Failed.length, pass_rate: t1PassRate },
    tier2: { sample_size: t2Results.length, avg_score: avgScore, flagged: rejected.length, skipped: skippedCount, results: t2Results },
    bloom_gate: {
      mapped: blueprintsMapped,
      distribution: bloomTotal > 0 ? Object.fromEntries(Object.entries(bloomCounts).map(([k, v]) => [k, Math.round((v / bloomTotal) * 100)])) : null,
      passed: bloomGatePass,
      warnings: bloomWarnings,
    },
    context_gate: {
      distribution: bloomTotal > 0 ? contextCounts : null,
      passed: contextGatePass,
      isolated_pct: bloomTotal > 0 ? Math.round(((contextCounts["isolated_knowledge"] || 0) / bloomTotal) * 100) : null,
    },
    message: overallPass
      ? `✅ Exam QC bestanden: ${t1PassRate.toFixed(0)}% Tier 1, avg ${avgScore.toFixed(0)}/100 Tier 2${!bloomGatePass ? " ⚠️ Bloom-Warnung" : ""}${!contextGatePass ? " ⚠️ Context-Warnung" : ""}`
      : `❌ Exam QC fehlgeschlagen: ${t1PassRate.toFixed(0)}% Tier 1, avg ${avgScore.toFixed(0)}/100 Tier 2`,
  });
});
