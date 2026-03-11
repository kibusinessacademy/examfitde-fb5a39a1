import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { callAIJSON } from "../_shared/ai-client.ts";
import { getModel } from "../_shared/model-routing.ts";
import { ERROR_TAG_VOCABULARY, filterTags } from "../_shared/error-tag-vocabulary.ts";

/**
 * pool-rework-trap-retrofit — Worker for batch trap-tag retrofit.
 * Vocabulary comes from SSOT shared module, NOT from job payload.
 */

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { "content-type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-rework-secret",
      },
    });
  }

  // Auth: cron secret only
  const cronSecret = Deno.env.get("REWORK_CRON_SECRET");
  const headerSecret = req.headers.get("x-rework-secret");
  if (!cronSecret || !headerSecret || headerSecret !== cronSecret) {
    return json({ error: "Unauthorized — x-rework-secret required" }, 401);
  }

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const body = await req.json().catch(() => ({}));
  const questionIds: string[] = body.question_ids || [];
  const professionName: string = body.profession_name || "Fachkraft";

  if (!questionIds.length) return json({ ok: true, message: "No questions to retrofit" });

  const { data: questions, error: qErr } = await sb
    .from("exam_questions")
    .select("id, question_text, options, correct_answer, explanation")
    .in("id", questionIds);

  if (qErr || !questions?.length) return json({ error: qErr?.message || "No questions found" }, 500);

  const routed = getModel("quality_audit");
  let retrofitted = 0;
  let failed = 0;

  for (const q of questions) {
    try {
      const result = await callAIJSON({
        provider: routed.provider,
        model: routed.model,
        messages: [
          {
            role: "system",
            content: `Du bist ein IHK-Prüfungsexperte für ${professionName}. Analysiere die folgende Rechenaufgabe und identifiziere typische Prüfungsfallen (trap_tags).

Antworte NUR mit JSON: {"trap_tags": ["tag1", "tag2"], "distractor_analysis": [{"option_index": 0, "error_tag": "tag", "why_wrong": "..."}]}

Verwende NUR Tags aus diesem Vokabular: ${ERROR_TAG_VOCABULARY.join(", ")}`,
          },
          {
            role: "user",
            content: `FRAGE: ${q.question_text}\n\nOPTIONEN:\n${(Array.isArray(q.options) ? q.options : []).map((o: string, i: number) => `${i === q.correct_answer ? "✓" : "✗"} ${i + 1}. ${o}`).join("\n")}\n\nERKLÄRUNG: ${q.explanation || "(keine)"}`,
          },
        ],
        max_tokens: 800,
      });

      const clean = result.content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      const parsed = JSON.parse(clean);

      // Use SSOT filterTags — only valid tags pass
      const validTags = filterTags(parsed.trap_tags);

      if (validTags.length > 0) {
        const updateData: Record<string, unknown> = { trap_tags: validTags };
        if (parsed.distractor_analysis) updateData.distractor_meta = parsed.distractor_analysis;
        await sb.from("exam_questions").update(updateData).eq("id", q.id);
        retrofitted++;
      } else {
        failed++;
      }
    } catch {
      failed++;
    }

    await new Promise((r) => setTimeout(r, 1500));
  }

  console.log(`[trap-retrofit] Done: ${retrofitted} tagged, ${failed} failed / ${questions.length}`);

  if (failed > questions.length * 0.5) {
    try {
      await sb.from("ops_alerts").insert({
        source: "pool-rework-trap-retrofit", severity: "warn",
        message: `Trap retrofit: ${failed}/${questions.length} failed`,
        payload: { retrofitted, failed, total: questions.length },
      });
    } catch (_e) { /* best-effort */ }
  }

  return json({ ok: true, retrofitted, failed, total: questions.length });
});
