import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

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
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*" } });
  }

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });

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
        const { error: updErr } = await sb
          .from("exam_questions")
          .update({
            conflict_type: result.conflict_type,
            complexity_score: result.complexity_score,
            scenario_type: result.scenario_type,
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

    // Log to auto_heal_log
    if (!dryRun && updated > 0) {
      await sb.from("auto_heal_log").insert({
        action_type: "backfill_conflict_type",
        trigger_source: "backfill-conflict-type",
        result_status: "ok",
        result_detail: `Backfilled ${updated} questions (${conflicts} with conflict_type)`,
        metadata: { updated, conflicts, distribution, curriculum_id: curriculumId, errors: errors.slice(0, 5) },
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
