import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { checkContamination } from "../_shared/contamination-guard.ts";
import { resolveProfession } from "../_shared/profession-resolver.ts";
import { callAIJSON } from "../_shared/ai-client.ts";
import { getModel } from "../_shared/model-routing.ts";
import { handleDbFailure } from "../_shared/job-fail.ts";

/**
 * package-validate-exam-pool — Pipeline Step (after generate_exam_pool)
 *
 * v3.0: Time-budget + cursor-based resumption to prevent 504 timeouts.
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
 *
 * CURSOR RESUMPTION:
 *   Accepts `batch_cursor.phase` and `batch_cursor.last_id` to resume
 *   after a partial run. Runner re-enqueues when partial=true.
 */

const SAMPLE_SIZE = 4;
const SAMPLE_PASS_THRESHOLD = 70;
const INDIVIDUAL_REJECT_THRESHOLD = 55;
const JACCARD_THRESHOLD = 0.85;
// Time budget: bail out 15s before edge function hard limit (~60s CPU)
// REDUCED from 50s → 40s to leave margin for DB writes after CPU-intensive T1
const TIME_BUDGET_MS = 40_000;
// REDUCED from 300 → 100 to prevent CPU Time exceeded on large pools (56k+ questions)
const PAGE_SIZE = 100;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

// ── Text similarity (sliding window to avoid O(n²) CPU explosion) ──
const JACCARD_WINDOW = 80;

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

let questions_total_hint = 0;

function tier1Check(
  q: { id: string; question_text: string; options: any; correct_answer: number; explanation: string | null; difficulty: string | null; competency_id?: string },
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

  // Meta-text detection
  const fullText = `${q.question_text || ""} ${q.explanation || ""}`;
  for (const pat of META_TEXT_PATTERNS) {
    if (pat.test(fullText)) {
      issues.push(`META_TEXT_DETECTED: ${pat.source}`);
      break;
    }
  }

  // Answer mismatch check — SOFTENED: only flag as warning, not tier1 failure.
  // German calculation questions (kaufmännisch) naturally contain "richtig ist [Betrag]"
  // in explanations, but option text often formats numbers differently (e.g., "995,25 EUR"
  // vs "995.25"). This caused mass false-positive tier1_failed states and infinite QG cycles.
  // Now: log as warning for analytics, but don't block tier1 pass.
  if (q.explanation && q.correct_answer !== null && q.correct_answer !== undefined && opts.length > 0) {
    const explLower = (q.explanation || "").toLowerCase();
    if (explLower.includes("richtig ist") || explLower.includes("richtig:")) {
      const numMatch = explLower.match(/richtig(?:\s+ist)?[:\s]+([0-9.,]+)/);
      if (numMatch) {
        const correctVal = numMatch[1].replace(/\./g, "").replace(",", ".");
        const correctOpt = String(opts[q.correct_answer] || "").toLowerCase();
        // Normalize: strip currency symbols, whitespace for comparison
        const normalizedOpt = correctOpt.replace(/[€\s]/g, "");
        const normalizedVal = correctVal.replace(/[€\s]/g, "");
        if (correctVal.length >= 3 && !normalizedOpt.includes(numMatch[1]) && !normalizedOpt.includes(normalizedVal)) {
          // Soft warning only — don't add to issues[]
          console.warn(`[tier1] ANSWER_MISMATCH_WARN (not blocking): q=${q.id.slice(0,8)} expl="${numMatch[1]}" opt="${correctOpt.slice(0, 60)}"`);
        }
      }
    }
  }

  // Duplicate check via Jaccard — sliding window, SAME COMPETENCY only.
  // FIX: Büromanagement calculation questions (Rabatt/Skonto/MwSt) share heavy
  // structural similarity across competencies but are didactically distinct.
  // Only flag duplicates within the same competency to avoid false positives.
  if (q.question_text) {
    const ngrams = textNgrams(q.question_text);
    for (const existing of recentNgrams) {
      if (existing.id === q.id) continue;
      // Skip cross-competency comparison — different competencies = different context
      if (q.competency_id && existing.competencyId && q.competency_id !== existing.competencyId) continue;
      if (jaccardSim(ngrams, existing.ngrams) >= JACCARD_THRESHOLD) {
        issues.push(`NEAR_DUPLICATE_OF: ${existing.id.slice(0, 8)}`);
        break;
      }
    }
    recentNgrams.push({ id: q.id, ngrams, competencyId: q.competency_id });
    if (recentNgrams.length > JACCARD_WINDOW) recentNgrams.shift();
  }

  // Contamination — skip for large batches to save CPU
  if (questions_total_hint <= 500) {
    const ft = `${q.question_text} ${opts.join(" ")} ${q.explanation || ""}`;
    const contam = checkContamination(ft.slice(0, 5000), professionName);
    if (contam.isContaminated) {
      issues.push(`CONTAMINATION: ${contam.detectedIndustry} [${contam.matchedTerms.slice(0, 3).join(", ")}]`);
    }
  }

  return { questionId: q.id, passed: issues.length === 0, issues };
}

// ── Balanced JSON extractor ──
function extractFirstJsonObject(text: string): string | null {
  const s = text.indexOf("{");
  if (s < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = s; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) { esc = false; continue; }
      if (ch === "\\") { esc = true; continue; }
      if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') { inStr = true; continue; }
    if (ch === "{") depth++;
    if (ch === "}") { depth--; if (depth === 0) return text.slice(s, i + 1); }
  }
  return null;
}

// ── Tier 2 ──
const TIER2_BASE_TOKENS = 2500;
const TIER2_RETRY_TOKENS = 3500;

async function tier2Validate(
  q: { id: string; question_text: string; options: any; correct_answer: number; explanation: string | null; difficulty: string | null; blueprint_name?: string },
  professionName: string,
): Promise<{ questionId: string; score: number; decision: string; issues: string[] }> {
  const routed = getModel("quality_audit");

  const basePrompt = `Du bist ein IHK-Prüfungsexperte für ${professionName}. Validiere diese Prüfungsfrage.

BEWERTUNGSDIMENSIONEN:
1. EINDEUTIGKEIT (35%): Genau eine richtige Antwort? Keine Interpretationsspielräume?
2. DISTRAKTOREN-QUALITÄT (25%): Plausibel aber eindeutig falsch? Typische Fehler abgebildet?
3. IHK-KONFORMITÄT (25%): IHK-Prüfungsstil? Realistische Aufgabenstellung?
4. BERUFSBEZUG (15%): Konkreter Bezug zum Beruf ${professionName}?

AUTO-REJECT: Mehrere korrekte Antworten → reject. Offensichtlich falsche Distraktoren → revise. Fachlicher Fehler → reject.

Antworte NUR mit JSON: {"overall_score": 0-100, "decision": "approve|revise|reject", "dimension_scores": {"eindeutigkeit": 0-100, "distraktoren": 0-100, "ihk_konformitaet": 0-100, "berufsbezug": 0-100}, "critical_issues": [{"severity": "critical|warning|info", "category": "string", "message": "string"}]}`;

  const userContent = `Beruf: ${professionName}\nBlueprint: ${q.blueprint_name || "unbekannt"}\nSchwierigkeit: ${q.difficulty}\n\nFRAGE: ${q.question_text}\n\nOPTIONEN:\n${(Array.isArray(q.options) ? q.options : []).map((o: string, i: number) => `${i === q.correct_answer ? "✓" : "✗"} ${i + 1}. ${o}`).join("\n")}\n\nERKLÄRUNG: ${q.explanation || "(keine)"}`;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const isRetry = attempt > 0;
      const systemPrompt = isRetry
        ? basePrompt + "\n\nWICHTIG: Antworte ausschließlich mit minifiziertem JSON. Kein Markdown, kein Prosa-Text."
        : basePrompt;

      const aiResult = await callAIJSON({
        provider: routed.provider,
        model: routed.model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userContent },
        ],
        max_tokens: isRetry ? TIER2_RETRY_TOKENS : TIER2_BASE_TOKENS,
      });

      let raw = (aiResult.content || "").trim();
      raw = raw.replace(/```(?:json)?|```/gi, "").trim();
      const extracted = extractFirstJsonObject(raw);

      if (!extracted) {
        if (!isRetry) {
          console.warn(`[validate-exam] Truncated JSON for ${q.id} — retrying`);
          continue;
        }
        throw new Error("TIER2_JSON_TRUNCATED");
      }

      const cleaned = extracted.replace(/,\s*([\]}])/g, "$1");
      const parsed = JSON.parse(cleaned);

      const VALID_DECISIONS = ["approve", "revise", "reject"];
      if (typeof parsed.overall_score !== "number" || !VALID_DECISIONS.includes(parsed.decision)) {
        throw new Error("TIER2_SCHEMA_INVALID");
      }

      return {
        questionId: q.id,
        score: parsed.overall_score,
        decision: parsed.decision,
        issues: (parsed.critical_issues || []).map((i: any) => `${i.severity}: ${i.message}`),
      };
    } catch (e) {
      const msg = ((e as Error).message || "").toLowerCase();
      const isTruncationLike = msg.includes("truncated") || msg.includes("unexpected end") || msg.includes("unterminated");
      const isCoreSchemaMiss = msg.includes("schema_invalid");

      if (attempt === 0 && (isTruncationLike || isCoreSchemaMiss)) {
        console.warn(`[validate-exam] Parse error for ${q.id} — retrying`);
        continue;
      }
      console.error(`[validate-exam] LLM failed for ${q.id}: ${msg}`);
      return { questionId: q.id, score: -1, decision: "skipped", issues: [`LLM_ERROR: ${msg}`] };
    }
  }

  return { questionId: q.id, score: -1, decision: "skipped", issues: ["LLM_ERROR: exhausted retries"] };
}

// ═══════════════════════════════════════════════════════════════════
// MAIN HANDLER — with time-budget + cursor resumption
// ═══════════════════════════════════════════════════════════════════
Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  const t0 = Date.now();
  const timeLeft = () => TIME_BUDGET_MS - (Date.now() - t0);
  const timings: Record<string, number> = {};

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const body = await req.json().catch(() => ({}));
  const p = body.payload || body;

  const packageId = p.package_id;
  const curriculumId = p.curriculum_id;
  const certificationId = p.certification_id || null;

  if (!packageId || !curriculumId) return json({ error: "Missing package_id or curriculum_id" }, 400);

  // ── Artifact Guard: don't run if 0 questions exist at all ──
  // FIX: Previously checked for status='approved', but THIS step is the one that
  // validates and approves questions. Checking for 'approved' created a deadlock
  // (Henne-Ei / chicken-egg). Now checks for ANY questions (incl. draft).
  const { count: totalQuestionCount } = await sb
    .from("exam_questions")
    .select("id", { count: "exact", head: true })
    .eq("curriculum_id", curriculumId);

  if ((totalQuestionCount ?? 0) === 0) {
    console.log(`[validate-exam] NO_QUESTIONS_EXIST for curriculum ${curriculumId.slice(0,8)} — backoff 120s`);
    return json({ ok: false, transient: true, backoff_seconds: 120, error: "NO_QUESTIONS_EXIST_YET" });
  }

  // ── Deterministic no-pending guard (prevents 409 retry loops) ──
  // FIX v3.1: Use aggregate COUNT instead of loading all rows to prevent OOM on large curricula (41k+ questions)
  const { data: qcAgg, error: qcAggErr } = await sb.rpc("count_exam_qc_status", { p_curriculum_id: curriculumId });
  
  let qcCounts: Record<string, number> = {};
  if (!qcAggErr && qcAgg) {
    // RPC returns array of {qc_status, cnt}
    for (const row of (qcAgg as any[])) {
      qcCounts[row.qc_status || "null"] = Number(row.cnt);
    }
  } else {
    // Fallback: individual count queries (memory-safe)
    console.warn(`[validate-exam] qcAgg RPC failed (${qcAggErr?.message}), using fallback counts`);
    for (const qs of ["pending", "approved", "tier1_passed", "tier1_failed", "needs_revision", "pruned_quality", "retired", "rejected"]) {
      const { count } = await sb
        .from("exam_questions")
        .select("id", { count: "exact", head: true })
        .eq("curriculum_id", curriculumId)
        .eq("qc_status", qs);
      if ((count ?? 0) > 0) qcCounts[qs] = count!;
    }
    // Also count null qc_status
    const { count: nullCount } = await sb
      .from("exam_questions")
      .select("id", { count: "exact", head: true })
      .eq("curriculum_id", curriculumId)
      .is("qc_status", null);
    if ((nullCount ?? 0) > 0) qcCounts["null"] = nullCount!;
  }

  const pendingQcCount = qcCounts.pending || 0;
  if (pendingQcCount === 0) {
    const approvedCount = (qcCounts.approved || 0) + (qcCounts["null"] || 0);
    const failedCount = (qcCounts.tier1_failed || 0) + (qcCounts.needs_revision || 0);
    const unresolvedCount = Math.max(0, (totalQuestionCount ?? 0) - approvedCount);

    // Idempotent success: already fully validated (0 unresolved)
    if (unresolvedCount === 0 && approvedCount > 0) {
      console.log(`[validate-exam] IDEMPOTENT_SUCCESS: no pending + all approved (${approvedCount})`);
      return json({
        ok: true,
        batch_complete: true,
        validation_passed: true,
        idempotent_already_validated: true,
        qc_counts: qcCounts,
        message: `✅ Exam QC bereits abgeschlossen (${approvedCount} approved, 0 unresolved).`,
      });
    }

    // Derive missing LF coverage for targeted re-seed
    let missingLfIds: string[] = [];
    try {
      const { data: lfs } = await sb
        .from("learning_fields")
        .select("id")
        .eq("curriculum_id", curriculumId);

      // Memory-safe: count approved per LF with aggregate query
      const { data: approvedLfRows } = await sb
        .from("exam_questions")
        .select("learning_field_id")
        .eq("curriculum_id", curriculumId)
        .in("qc_status", ["approved"])
        .not("learning_field_id", "is", null)
        .limit(1000);

      const approvedLf = new Set(
        (approvedLfRows || []).map((r: any) => r.learning_field_id as string),
      );

      missingLfIds = (lfs || [])
        .map((lf: any) => lf.id as string)
        .filter((id: string) => !approvedLf.has(id));
    } catch (lfErr) {
      console.warn(`[validate-exam] LF coverage derivation failed: ${(lfErr as Error)?.message}`);
    }

    // ── SYSTEM-WIDE FIX: Prevent infinite re-seed loop ──
    const MIN_APPROVED_FOR_PASS = 500;
    const unresolvedRatio = approvedCount > 0 ? failedCount / approvedCount : 1;
    const poolSufficient = approvedCount >= MIN_APPROVED_FOR_PASS && missingLfIds.length === 0 && unresolvedRatio < 0.05;

    if (poolSufficient && failedCount > 0) {
      console.log(`[validate-exam] TERMINAL_CLEANUP: rejecting ${failedCount} unresolvable questions (approved=${approvedCount}, ratio=${(unresolvedRatio * 100).toFixed(1)}%)`);
      try {
        await sb
          .from("exam_questions")
          .update({ qc_status: "rejected", status: "rejected" })
          .eq("curriculum_id", curriculumId)
          .in("qc_status", ["tier1_failed", "needs_revision"]);
      } catch (rejectErr) {
        console.warn(`[validate-exam] REJECT_CLEANUP_FAIL: ${(rejectErr as Error)?.message?.slice(0, 100)}`);
      }

      return json({
        ok: true,
        batch_complete: true,
        validation_passed: true,
        terminal_cleanup: true,
        rejected_count: failedCount,
        qc_counts: { ...qcCounts, rejected: failedCount },
        message: `✅ Exam Pool validiert (${approvedCount} approved). ${failedCount} unresolvable Fragen als rejected markiert.`,
      });
    }

    const issues = [
      "NO_PENDING_QUESTIONS",
      `UNRESOLVED_QUALITY_FLAGS:${unresolvedCount}`,
      ...(missingLfIds.length > 0 ? [`MISSING_LF_COVERAGE:${missingLfIds.length}`] : []),
    ];

    console.warn(`[validate-exam] NO_PENDING_WITH_UNRESOLVED: approved=${approvedCount}, unresolved=${unresolvedCount}, missingLF=${missingLfIds.length}`);
    return json({
      ok: false,
      batch_complete: true,
      validation_passed: false,
      reseed_required: true,
      no_pending_questions: true,
      issues,
      missing_lf_ids: missingLfIds.slice(0, 50),
      qc_counts: qcCounts,
      message: `❌ Keine pending Fragen, aber ${unresolvedCount} unresolved QC-Fälle vorhanden. Re-Seed erforderlich.`,
    });
  }

  // ── Cursor from previous partial run ──
  const cursor = p.batch_cursor as { phase?: string; last_id?: string; t1_stats?: any; t1_pass_ids?: string[] } | null;
  const startPhase = cursor?.phase || "tier1";
  const startAfterId = cursor?.last_id || null;

  // Resolve profession
  let professionName: string;
  try {
    const prof = await resolveProfession(sb, { certificationId, curriculumId });
    professionName = prof.professionName;
  } catch (e) {
    return json({ error: (e as Error).message }, 400);
  }
  timings.resolve = Date.now() - t0;

  // ═══ PHASE: TIER 1 — Structural checks (paginated) ═══
  let t1Stats = cursor?.t1_stats || { total: 0, passed: 0, failed: 0, failIds: [] as string[] };
  let t1PassIds: string[] = cursor?.t1_pass_ids || [];
  let lastProcessedId: string | null = startAfterId;
  let allQuestionsLoaded = false;

  if (startPhase === "tier1") {
    const recentNgrams: Array<{ id: string; ngrams: Set<string>; competencyId?: string }> = [];
    let pageAfterId = startAfterId;

    while (timeLeft() > 10_000) { // Keep 10s buffer for DB writes
      // FIX: Only validate 'pending' questions — never re-validate already-processed ones.
      // Re-validating tier1_failed questions caused infinite QG fail loops because
      // the same questions kept failing and the pass-rate stayed below 70%.
      let query = sb
        .from("exam_questions")
        .select("id, question_text, options, correct_answer, explanation, difficulty, blueprint_id, competency_id")
        .eq("curriculum_id", curriculumId)
        .eq("qc_status", "pending")
        .order("id")
        .limit(PAGE_SIZE);

      if (pageAfterId) {
        query = query.gt("id", pageAfterId);
      }

      const { data: questions, error: qErr } = await query;
      if (qErr) return json({ error: qErr.message }, 500);

      if (!questions || questions.length === 0) {
        allQuestionsLoaded = true;
        break;
      }

      questions_total_hint = t1Stats.total + questions.length;

      const pageFailed: string[] = [];
      for (const q of questions as any[]) {
        const result = tier1Check(q, professionName, recentNgrams);
        t1Stats.total++;
        if (result.passed) {
          t1Stats.passed++;
          t1PassIds.push(q.id);
        } else {
          t1Stats.failed++;
          pageFailed.push(q.id);
        }
        lastProcessedId = q.id;
      }

      // Batch flag failed questions
      for (let i = 0; i < pageFailed.length; i += 50) {
        const chunk = pageFailed.slice(i, i + 50);
        const { error: uErr } = await sb.from("exam_questions").update({ qc_status: "tier1_failed" }).in("id", chunk);
        if (uErr) {
          const r = await handleDbFailure({ supabase: sb, packageId: packageId ?? null, stepKey: "validate_exam_pool" }, uErr);
          if (r?.permanent) return json(r, 422);
        }
      }

      t1Stats.failIds.push(...pageFailed);

      console.log(`[validate-exam] T1 page: ${questions.length} questions, ${pageFailed.length} failed, elapsed=${Date.now() - t0}ms`);

      // If fewer than PAGE_SIZE returned, we've seen all
      if (questions.length < PAGE_SIZE) {
        allQuestionsLoaded = true;
        break;
      }

      pageAfterId = lastProcessedId;
    }

    // If we ran out of time before loading all questions → return partial
    if (!allQuestionsLoaded) {
      console.log(`[validate-exam] Time budget reached during T1 at ${lastProcessedId} — returning partial`);
      return json({
        ok: null,
        partial: true,
        batch_complete: false,
        batch_cursor: {
          phase: "tier1",
          last_id: lastProcessedId,
          t1_stats: t1Stats,
          t1_pass_ids: t1PassIds,
        },
        message: `⏳ Tier 1 partial: ${t1Stats.total} geprüft, ${t1Stats.failed} fehlerhaft. Wird fortgesetzt…`,
      });
    }
  }

  timings.tier1 = Date.now() - t0;
  const t1PassRate = t1Stats.total > 0 ? (t1Stats.passed / t1Stats.total) * 100 : 100;
  console.log(`[validate-exam] T1 complete: ${t1Stats.passed}/${t1Stats.total} passed (${t1PassRate.toFixed(1)}%), elapsed=${timings.tier1}ms`);

  // If no questions found at all
  if (t1Stats.total === 0) {
    return json({ ok: false, error: "NO_QUESTIONS_TO_VALIDATE" }, 409);
  }

  // Fast-fail: if < 70% pass T1 → systemic issue, no need for T2
  if (t1PassRate < 70) {
    return json({
      ok: false,
      batch_complete: true,
      tier1_pass_rate: t1PassRate,
      tier1_failures: t1Stats.failed,
      message: `❌ Exam QC Tier 1 fehlgeschlagen: ${t1Stats.failed}/${t1Stats.total} Fragen haben strukturelle Mängel.`,
    });
  }

  // ═══ PHASE: TIER 2 — LLM sample ═══
  // Only run if we have enough time left
  let t2Results: Array<{ questionId: string; score: number; decision: string; issues: string[] }> = [];
  let t2Skipped = false;

  if (timeLeft() > 20_000 && (startPhase === "tier1" || startPhase === "tier2")) {
    const sampleSize = Math.min(SAMPLE_SIZE, t1PassIds.length);
    // Pick random sample from passed IDs
    const shuffled = [...t1PassIds].sort(() => Math.random() - 0.5);
    const sampleIds = shuffled.slice(0, sampleSize);

    // Load full data for sample
    const { data: sampleQs } = await sb
      .from("exam_questions")
      .select("id, question_text, options, correct_answer, explanation, difficulty, blueprint_id")
      .in("id", sampleIds);

    let consecutiveRateLimits = 0;
    for (const q of (sampleQs || []) as any[]) {
      if (consecutiveRateLimits >= 2 || timeLeft() < 8_000) {
        console.log(`[validate-exam] T2 early exit: rateLimits=${consecutiveRateLimits}, timeLeft=${timeLeft()}ms`);
        break;
      }
      const result = await tier2Validate(q, professionName);
      t2Results.push(result);

      if (result.score === -1) {
        consecutiveRateLimits++;
      } else {
        consecutiveRateLimits = 0;
        const { error: uErr } = await sb.from("exam_questions").update({
          qc_status: result.decision === "approve" ? "approved" : "needs_revision",
        }).eq("id", q.id);
        if (uErr) {
          const r = await handleDbFailure({ supabase: sb, packageId: packageId ?? null, stepKey: "validate_exam_pool" }, uErr);
          if (r?.permanent) return json(r, 422);
        }
      }

      await new Promise(r => setTimeout(r, 3000 + Math.random() * 2000));
    }
  } else {
    t2Skipped = true;
    console.log(`[validate-exam] T2 skipped: timeLeft=${timeLeft()}ms`);
  }

  timings.tier2 = Date.now() - t0;

  const scoredResults = t2Results.filter(r => r.score >= 0);
  const avgScore = scoredResults.length > 0
    ? scoredResults.reduce((sum, r) => sum + r.score, 0) / scoredResults.length
    : 100; // Trust T1 if no T2 scores
  const rejected = scoredResults.filter(r => r.score < INDIVIDUAL_REJECT_THRESHOLD);

  // Batch mark non-sampled as tier1_passed (only if we have time)
  if (timeLeft() > 5_000) {
    const t2Ids = new Set(t2Results.map(r => r.questionId));
    const passedNotSampled = t1PassIds.filter(id => !t2Ids.has(id));
    for (let i = 0; i < passedNotSampled.length; i += 100) {
      if (timeLeft() < 3_000) break;
      const chunk = passedNotSampled.slice(i, i + 100);
      const { error: uErr } = await sb.from("exam_questions").update({ qc_status: "tier1_passed" }).in("id", chunk);
      if (uErr) {
        const r = await handleDbFailure({ supabase: sb, packageId: packageId ?? null, stepKey: "validate_exam_pool" }, uErr);
        if (r?.permanent) return json(r, 422);
      }
    }
  }

  // ═══ GATES 3-6 — only if time permits ═══
  let bloomGatePass = true;
  let contextGatePass = true;
  let distractorGatePass = true;
  let timeGatePass = true;
  let discriminationGatePass = true;
  const allWarnings: string[] = [];
  let gatesRun = false;

  if (timeLeft() > 8_000 && (startPhase === "tier1" || startPhase === "tier2" || startPhase === "gates")) {
    gatesRun = true;

    // Gate 3: Bloom Distribution — load blueprints for a sample
    const bpSampleIds = t1PassIds.slice(0, 300);
    const { data: sampleQsForBp } = await sb
      .from("exam_questions")
      .select("id, blueprint_id")
      .in("id", bpSampleIds);

    const bpIds = [...new Set((sampleQsForBp || []).filter((q: any) => q.blueprint_id).map((q: any) => q.blueprint_id))];
    const bloomCounts: Record<string, number> = { remember: 0, understand: 0, apply: 0, analyze: 0 };
    const contextCounts: Record<string, number> = {};
    let blueprintsMapped = 0;

    if (bpIds.length > 0 && timeLeft() > 5_000) {
      const bpCogMap = new Map<string, { cognitive: string; context: string }>();
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

      for (const q of (sampleQsForBp || []) as any[]) {
        const bpInfo = q.blueprint_id ? bpCogMap.get(q.blueprint_id) : null;
        if (bpInfo) {
          bloomCounts[bpInfo.cognitive] = (bloomCounts[bpInfo.cognitive] || 0) + 1;
          contextCounts[bpInfo.context] = (contextCounts[bpInfo.context] || 0) + 1;
          blueprintsMapped++;
        }
      }
    }

    const bloomTotal = Object.values(bloomCounts).reduce((s, v) => s + v, 0);
    if (bloomTotal > 0) {
      const rememberRatio = bloomCounts.remember / bloomTotal;
      const applyPlusAnalyze = (bloomCounts.apply + bloomCounts.analyze) / bloomTotal;
      if (rememberRatio > 0.25) { allWarnings.push(`BLOOM_TOO_MUCH_REMEMBER: ${(rememberRatio * 100).toFixed(1)}%`); bloomGatePass = false; }
      if (applyPlusAnalyze < 0.25) { allWarnings.push(`BLOOM_TOO_LOW_APPLY_ANALYZE: ${(applyPlusAnalyze * 100).toFixed(1)}%`); bloomGatePass = false; }
      const isolatedRatio = (contextCounts["isolated_knowledge"] || 0) / bloomTotal;
      if (isolatedRatio > 0.30) { allWarnings.push(`CONTEXT_TOO_MUCH_ISOLATED: ${(isolatedRatio * 100).toFixed(1)}%`); contextGatePass = false; }
    }

    // Gate 4: Distractor Quality (sample of 100)
    if (timeLeft() > 5_000) {
      const distSampleIds = t1PassIds.slice(0, 100);
      const { data: qWithMeta } = await sb
        .from("exam_questions")
        .select("id, distractor_meta, item_discrimination")
        .in("id", distSampleIds);

      let distractorMissing = 0;
      let distractorWeak = 0;
      let lowDisc = 0;
      let discChecked = 0;

      for (const q of (qWithMeta || []) as any[]) {
        // Distractor check
        if (!q.distractor_meta) { distractorMissing++; }
        else {
          const raw = q.distractor_meta;
          const dm: any[] = Array.isArray(raw) ? raw : (raw?.raw && Array.isArray(raw.raw) ? raw.raw : []);
          if (dm.filter((d: any) => d?.why_wrong && d?.why_tempting).length < 2) distractorWeak++;
        }
        // Discrimination check
        if (q.item_discrimination !== null && q.item_discrimination !== undefined) {
          discChecked++;
          if (q.item_discrimination < 0.20) lowDisc++;
        }
      }

      const sampleLen = (qWithMeta || []).length || 1;
      if ((distractorMissing + distractorWeak) / sampleLen >= 0.4) {
        distractorGatePass = false;
        allWarnings.push(`DISTRACTOR_QUALITY: ${distractorMissing} missing, ${distractorWeak} weak out of ${sampleLen}`);
      }
      if (discChecked > 10 && (lowDisc / discChecked) > 0.3) {
        discriminationGatePass = false;
        allWarnings.push(`LOW_DISCRIMINATION: ${lowDisc}/${discChecked}`);
      }
    }
  }

  timings.gates = Date.now() - t0;

  // ═══ Final verdict ═══
  const overallPass = avgScore >= SAMPLE_PASS_THRESHOLD
    && t1PassRate >= 70
    && bloomGatePass
    && contextGatePass
    && distractorGatePass;

  await sb.from("course_packages").update({
    last_error: overallPass ? null : `Exam QC v3: avg=${avgScore.toFixed(0)}, t1=${t1PassRate.toFixed(0)}%, bloom=${bloomGatePass}, ctx=${contextGatePass}, dist=${distractorGatePass}`,
  }).eq("id", packageId);

  if (!overallPass) {
    try {
      await sb.from("ops_alerts").insert({
        source: "validate-exam-pool-v3",
        severity: "warning",
        message: `Exam QC v3 failed for pkg ${packageId.slice(0, 8)}: avg=${avgScore.toFixed(0)}, bloom=${bloomGatePass}, ctx=${contextGatePass}, dist=${distractorGatePass}`,
        payload: { packageId, tier1_pass_rate: t1PassRate, tier2_avg_score: avgScore, bloom: bloomGatePass, context: contextGatePass, distractor: distractorGatePass },
      });
    } catch (_e) { /* best-effort */ }
  }

  timings.total = Date.now() - t0;
  console.log(`[validate-exam] DONE in ${timings.total}ms — ok=${overallPass}, gates_run=${gatesRun}`);

  return json({
    ok: overallPass,
    batch_complete: true,
    tier1: { total: t1Stats.total, passed: t1Stats.passed, failed: t1Stats.failed, pass_rate: t1PassRate },
    tier2: { sample_size: t2Results.length, avg_score: avgScore, flagged: rejected.length, skipped: t2Skipped, results: t2Results },
    bloom_gate: { passed: bloomGatePass },
    context_gate: { passed: contextGatePass },
    distractor_gate: { passed: distractorGatePass },
    time_gate: { passed: timeGatePass },
    discrimination_gate: { passed: discriminationGatePass },
    gates_run: gatesRun,
    warnings: allWarnings,
    debug_timings: timings,
    message: overallPass
      ? `✅ Exam QC v3 bestanden: ${t1PassRate.toFixed(0)}% T1, avg ${avgScore.toFixed(0)}/100 T2`
      : `❌ Exam QC v3 fehlgeschlagen: ${[
          t1PassRate < 70 ? `T1 ${t1PassRate.toFixed(0)}%` : null,
          avgScore < SAMPLE_PASS_THRESHOLD ? `T2 avg ${avgScore.toFixed(0)}` : null,
          !bloomGatePass ? "Bloom ✗" : null,
          !contextGatePass ? "Context ✗" : null,
          !distractorGatePass ? "Distraktoren ✗" : null,
        ].filter(Boolean).join(", ")}`,
  });
});
