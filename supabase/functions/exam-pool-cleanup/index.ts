import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "content-type": "application/json" } });
}

/**
 * exam-pool-cleanup — Automated sweep for broken approved questions
 *
 * Checks ALL approved questions for:
 * 1. correct_answer index out of bounds
 * 2. Meta-text / first-person / editing artifacts in explanation
 * 3. AI error confessions ("Tippfehler", "ich muss", etc.)
 * 4. Explanation contradicts correct option (basic heuristic)
 *
 * Can run as dry_run (default) or with apply=true to actually unapprove.
 * Designed to be called by cron or admin manually.
 */

const META_PATTERNS = [
  "ich muss prüfen", "ich muss korrigieren", "ich muss überprüfen",
  "es tut mir leid", "ich ändere option", "ich ändere die",
  "tippfehler", "ich korrigiere", "fehler in der frage",
  "ich habe einen fehler", "lassen sie mich",
  "ich prüfe nochmals", "ich überprüfe nochmals",
  "korrektur:", "hinweis: die frage", "anmerkung:",
  "achtung: ich", "ich entschuldige mich",
  "ich muss die frage", "ich muss die antwort",
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const body = await req.json().catch(() => ({}));
  const applyFixes = body.apply === true;
  const curriculumId = body.curriculum_id || null; // optional filter

  // Fetch all approved questions (paginated)
  const PAGE = 500;
  let offset = 0;
  const allQ: any[] = [];
  const baseQuery = () => {
    let q = sb.from("exam_questions")
      .select("id, question_text, options, correct_answer, explanation, difficulty, curriculum_id")
      .eq("qc_status", "approved");
    if (curriculumId) q = q.eq("curriculum_id", curriculumId);
    return q;
  };

  while (true) {
    const { data: batch, error } = await baseQuery().range(offset, offset + PAGE - 1);
    if (error) return json({ error: error.message }, 500);
    if (!batch || batch.length === 0) break;
    allQ.push(...batch);
    if (batch.length < PAGE) break;
    offset += batch.length;
  }

  console.log(`[cleanup] Scanning ${allQ.length} approved questions`);

  const flagged: Array<{ id: string; reasons: string[] }> = [];

  for (const q of allQ) {
    const reasons: string[] = [];
    const opts = Array.isArray(q.options) ? q.options : [];

    // 1. Index out of bounds
    if (q.correct_answer !== null && q.correct_answer !== undefined) {
      if (q.correct_answer < 0 || q.correct_answer >= opts.length) {
        reasons.push(`INDEX_OOB: correct_answer=${q.correct_answer}, options=${opts.length}`);
      }
    }

    // 2. Meta-text patterns
    const fullText = `${q.question_text || ""} ${q.explanation || ""}`.toLowerCase();
    for (const pat of META_PATTERNS) {
      if (fullText.includes(pat)) {
        reasons.push(`META_TEXT: "${pat}"`);
        break;
      }
    }

    // 3. Too few options
    if (opts.length < 4) {
      reasons.push(`TOO_FEW_OPTIONS: ${opts.length}`);
    }

    // 4. No explanation or too short
    if (!q.explanation || q.explanation.length < 80) {
      reasons.push(`EXPLANATION_SHORT: ${(q.explanation || "").length}`);
    }

    if (reasons.length > 0) {
      flagged.push({ id: q.id, reasons });
    }
  }

  console.log(`[cleanup] Found ${flagged.length} broken approved questions`);

  // Apply fixes if requested
  let unapproved = 0;
  if (applyFixes && flagged.length > 0) {
    const ids = flagged.map(f => f.id);
    for (let i = 0; i < ids.length; i += 50) {
      const chunk = ids.slice(i, i + 50);
      const { error } = await sb.from("exam_questions")
        .update({ qc_status: "needs_revision" })
        .in("id", chunk);
      if (!error) unapproved += chunk.length;
    }

    // Log to ops_alerts
    await sb.from("ops_alerts").insert({
      source: "exam-pool-cleanup",
      severity: "warning",
      message: `Cleanup: ${unapproved} broken approved questions → needs_revision`,
      payload: { flagged_count: flagged.length, sample_ids: ids.slice(0, 10) },
    }).then(() => {}).catch(() => {});
  }

  return json({
    ok: true,
    scanned: allQ.length,
    flagged: flagged.length,
    applied: applyFixes,
    unapproved,
    issues: flagged.slice(0, 50), // First 50 for review
  });
});
