import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { validateAuth, unauthorizedResponse, forbiddenResponse } from "../_shared/auth.ts";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";

/**
 * backfill-conflict-type — Backfill-Worker für Altbestand
 *
 * Annotiert bestehende exam_questions (status=approved/draft) mit
 * conflict_type, complexity_score und scenario_type, sofern diese NULL sind.
 *
 * Logik: Heuristik-basiert (kein LLM-Call), analysiert question_text + options.
 * Ziel: ~30% der Fragen erhalten einen conflict_type != 'none'.
 *
 * Aufruf: POST { curriculum_id?, batch_size?, dry_run? }
 */

const DEFAULT_BATCH = 200;

const SIMILAR_PATTERNS = [
  /unterschied|differenz|abweich/i,
  /genau\s+(genommen|betrachtet)/i,
  /sowohl.*als\s+auch/i,
];

const LEGAL_PATTERNS = [
  /§\s*\d+|gesetz|verordnung|richtlinie|vorschrift|ApBetrO|BGB|HGB|AO|StGB|DSGVO|BetrVG|ArbSchG|JArbSchG|MuSchG|BBiG|SGB|GewO|UStG|EStG|KSchG/i,
  /rechtlich|gesetzlich|pflicht|muss.*laut|vorgeschrieben/i,
];

const PRIORITY_PATTERNS = [
  /zuerst|priorit|reihenfolge|als\s+erstes|vorrang|dringend/i,
  /schritt\s*1|zunächst|bevor\s+man/i,
];

const BEST_ANSWER_PATTERNS = [
  /am\s+besten|optimale?|geeignetste|sinnvollste|empfehlensw/i,
  /welche.*maßnahme.*ist.*richtig/i,
];

interface ConflictResult {
  conflict_type: string;
  complexity_score: number;
  scenario_type: string;
}

function classifyQuestion(questionText: string, options: string[], explanation: string): ConflictResult {
  const allText = `${questionText} ${options.join(" ")} ${explanation}`;

  // Check similarity between options (Levenshtein-like: shared prefix/suffix)
  let similarPairs = 0;
  for (let i = 0; i < options.length; i++) {
    for (let j = i + 1; j < options.length; j++) {
      const a = options[i].toLowerCase().trim();
      const b = options[j].toLowerCase().trim();
      // Shared words ratio
      const wordsA = new Set(a.split(/\s+/));
      const wordsB = new Set(b.split(/\s+/));
      const shared = [...wordsA].filter(w => wordsB.has(w) && w.length > 3).length;
      const maxLen = Math.max(wordsA.size, wordsB.size);
      if (maxLen > 2 && shared / maxLen >= 0.5) similarPairs++;
    }
  }

  // Score each conflict type
  let scores: Record<string, number> = {
    similar_options: 0,
    legal_vs_practical: 0,
    best_answer: 0,
    priority_conflict: 0,
  };

  if (similarPairs >= 2) scores.similar_options += 3;
  else if (similarPairs === 1) scores.similar_options += 1;
  for (const p of SIMILAR_PATTERNS) if (p.test(allText)) scores.similar_options += 1;

  for (const p of LEGAL_PATTERNS) if (p.test(allText)) scores.legal_vs_practical += 2;
  if (/praxis|praxisüblich|üblich|alltag/i.test(allText) && scores.legal_vs_practical > 0) {
    scores.legal_vs_practical += 1;
  }

  for (const p of PRIORITY_PATTERNS) if (p.test(allText)) scores.priority_conflict += 2;
  for (const p of BEST_ANSWER_PATTERNS) if (p.test(allText)) scores.best_answer += 2;

  // Pick highest scoring type (threshold: ≥ 3)
  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const [topType, topScore] = sorted[0];

  const hasConflict = topScore >= 3;
  const conflictType = hasConflict ? topType : "none";

  // Complexity score heuristic
  let complexity = 3; // default medium
  const wordCount = questionText.split(/\s+/).length;
  if (wordCount > 40) complexity += 1;
  if (wordCount > 70) complexity += 1;
  if (/berechne|kalkul|formel/i.test(questionText)) complexity += 1;
  if (hasConflict) complexity += 1;
  complexity = Math.min(complexity, 7);

  return {
    conflict_type: conflictType,
    complexity_score: complexity,
    scenario_type: hasConflict ? "conflict" : (/\b\d{2,}\b.*€|%|Stk/.test(questionText) ? "scenario" : "standard"),
  };
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  const pre = handleCorsPreflightRequest(req);
  if (pre) return pre;

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...getCorsHeaders(origin), "Content-Type": "application/json" } });

  // Require admin or internal job-runner secret — function bulk-mutates exam_questions via service role.
  const auth = await validateAuth(req, true);
  if (auth.error) {
    if (auth.error === 'Admin access required') return forbiddenResponse(auth.error, origin || undefined);
    return unauthorizedResponse(auth.error, origin || undefined);
  }

  try {
    const p = await req.json().catch(() => ({}));
    const curriculumId: string | null = p.curriculum_id || null;
    const batchSize: number = Math.min(p.batch_size || DEFAULT_BATCH, 500);
    const dryRun: boolean = p.dry_run === true;

    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // Find questions needing backfill
    let query = sb
      .from("exam_questions")
      .select("id, question_text, options, explanation, correct_answer, difficulty, cognitive_level")
      .in("status", ["approved", "draft"])
      .is("conflict_type", null)
      .order("created_at", { ascending: true })
      .limit(batchSize);

    if (curriculumId) {
      query = query.eq("curriculum_id", curriculumId);
    }

    const { data: questions, error: fetchErr } = await query;
    if (fetchErr) return json({ error: fetchErr.message }, 500);
    if (!questions?.length) return json({ ok: true, message: "No questions to backfill", updated: 0 });

    let updated = 0;
    let conflicts = 0;
    const distribution: Record<string, number> = {};
    const errors: string[] = [];

    for (const q of questions) {
      const opts = Array.isArray(q.options) ? q.options.map(String) : [];
      const result = classifyQuestion(q.question_text || "", opts, q.explanation || "");

      if (!dryRun) {
        // scenario_type wird NICHT mehr hier gesetzt — eigener Constraint-konformer Pfad,
        // freie Heuristik-Werte ("scenario"/"conflict"/"standard") verletzen
        // exam_questions_scenario_type_check (erlaubt: error_detection, applied_case, ...).
        const { error: updErr } = await sb
          .from("exam_questions")
          .update({
            conflict_type: result.conflict_type,
            complexity_score: result.complexity_score,
          })
          .eq("id", q.id);

        if (updErr) {
          errors.push(`${q.id}: ${updErr.message}`);
          continue;
        }
      }

      updated++;
      if (result.conflict_type !== "none") conflicts++;
      distribution[result.conflict_type] = (distribution[result.conflict_type] || 0) + 1;
    }

    // Log to auto_heal_log — `processed` is the true denominator (rows scanned),
    // `updated` is rows where DB write succeeded, `conflicts` is rows where
    // conflict_type != 'none'. Stop-Guard uses processed vs updated for true
    // efficiency rate.
    if (!dryRun) {
      await sb.from("auto_heal_log").insert({
        action_type: "backfill_conflict_type",
        trigger_source: "backfill-conflict-type",
        result_status: errors.length > 0 ? "partial" : "ok",
        result_detail: `Processed ${questions.length}, updated ${updated} (${conflicts} with conflict_type, ${errors.length} errors)`,
        metadata: {
          processed: questions.length,
          updated,
          conflicts,
          error_count: errors.length,
          distribution,
          curriculum_id: curriculumId,
          errors: errors.slice(0, 5),
        },
      });
    }

    return json({
      ok: true,
      dry_run: dryRun,
      total_found: questions.length,
      updated,
      conflicts,
      conflict_rate: `${((conflicts / updated) * 100).toFixed(1)}%`,
      distribution,
      errors: errors.slice(0, 10),
    });
  } catch (e) {
    console.error("[backfill-conflict-type] Fatal:", e);
    return json({ error: (e as Error).message }, 500);
  }
});
