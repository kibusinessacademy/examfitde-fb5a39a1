import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { callAIJSON } from "../_shared/ai-client.ts";
import { getModel } from "../_shared/model-routing.ts";

/**
 * pool-rework-trap-retrofit — Worker for batch trap-tag retrofit.
 * Called via job_queue by pool-rework planner.
 * Processes question IDs with LLM to assign SSOT-compliant trap_tags.
 */

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-job-runner-key",
      },
    });
  }

  // Auth: only job-runner or service role
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const jobRunnerKey = req.headers.get("x-job-runner-key");
  if (!jobRunnerKey || jobRunnerKey !== serviceKey) {
    return json({ error: "Unauthorized — job-runner key required" }, 401);
  }

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    serviceKey,
  );

  const body = await req.json().catch(() => ({}));
  const questionIds: string[] = body.question_ids || [];
  const vocabulary: string[] = body.error_tag_vocabulary || [];
  const professionName: string = body.profession_name || "Fachkraft";

  if (!questionIds.length) {
    return json({ ok: true, message: "No questions to retrofit" });
  }

  if (!vocabulary.length) {
    return json({ error: "Missing error_tag_vocabulary in payload" }, 400);
  }

  // Load questions
  const { data: questions, error: qErr } = await sb
    .from("exam_questions")
    .select("id, question_text, options, correct_answer, explanation")
    .in("id", questionIds);

  if (qErr || !questions?.length) {
    return json({ error: qErr?.message || "No questions found" }, 500);
  }

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

Verwende NUR Tags aus diesem Vokabular: ${vocabulary.join(", ")}`,
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
      const tags = Array.isArray(parsed.trap_tags) ? parsed.trap_tags : [];

      if (tags.length > 0) {
        // Normalize and filter against SSOT vocabulary
        const normalizedTags = tags
          .map((t: string) => String(t).toLowerCase().replace(/[\s-]+/g, "_").trim())
          .filter((t: string) => vocabulary.includes(t));

        if (normalizedTags.length > 0) {
          const updateData: Record<string, unknown> = { trap_tags: normalizedTags };
          if (parsed.distractor_analysis) {
            updateData.distractor_meta = parsed.distractor_analysis;
          }
          await sb.from("exam_questions").update(updateData).eq("id", q.id);
          retrofitted++;
        } else {
          failed++;
        }
      } else {
        failed++;
      }
    } catch {
      failed++;
    }

    // Rate limit protection
    await new Promise((r) => setTimeout(r, 1500));
  }

  console.log(`[trap-retrofit] Done: ${retrofitted} tagged, ${failed} failed out of ${questions.length}`);

  // Alert if significant failures
  if (failed > questions.length * 0.5) {
    await sb.from("ops_alerts").insert({
      source: "pool-rework-trap-retrofit",
      severity: "warn",
      message: `Trap retrofit: ${failed}/${questions.length} failed — check LLM responses`,
      payload: { retrofitted, failed, total: questions.length },
    }).then(() => {}).catch(() => {});
  }

  return json({ ok: true, retrofitted, failed, total: questions.length });
});
