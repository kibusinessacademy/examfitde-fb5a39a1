import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

/**
 * generate-content — Worker-based Content Engine
 * 
 * Two modes:
 *  1. ENQUEUE (POST with blueprint_id/question_id) — creates a queued job, returns immediately
 *  2. PROCESS  (POST with { mode: "process", limit: N }) — claims + processes queued jobs
 * 
 * SSOT Guards:
 *  - Only approved questions + blueprints
 *  - Source snapshot persisted for audit
 *  - Hook ID tracked for usage analytics
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const lovableApiKey = Deno.env.get("LOVABLE_API_KEY");

  if (!lovableApiKey) return json({ error: "LOVABLE_API_KEY not configured" }, 500);

  const sb = createClient(supabaseUrl, serviceKey);

  try {
    const body = await req.json().catch(() => ({}));
    const mode = body.mode || "enqueue";

    if (mode === "process") {
      return await processJobs(sb, lovableApiKey, body.limit || 3);
    }

    return await enqueueJob(sb, body);
  } catch (err) {
    console.error("[generate-content] UNHANDLED:", err);
    const msg = err instanceof Error ? err.message : String(err);
    return json({ error: msg }, 500);
  }
});

// ─── ENQUEUE MODE ────────────────────────────────────────────
async function enqueueJob(sb: any, body: any) {
  const {
    blueprint_id,
    question_id,
    content_type = "video",
    platform = "tiktok",
    target_audience = "azubi",
    content_category = "reichweite",
    format = "1min_ihk_frage",
  } = body;

  if (!blueprint_id && !question_id) {
    return json({ error: "blueprint_id or question_id required" }, 400);
  }

  // ── Load & validate question ──
  let question: any = null;
  let blueprint: any = null;

  if (question_id) {
    const { data, error } = await sb
      .from("exam_questions")
      .select("id, question_text, correct_answer, explanation, difficulty, cognitive_level, curriculum_id, competency_id, blueprint_id, status")
      .eq("id", question_id)
      .maybeSingle();
    if (error) return json({ error: `Question load failed: ${error.message}` }, 500);
    if (!data) return json({ error: "Question not found" }, 404);
    if (data.status !== "approved") return json({ error: `SSOT_GATE: Question status is '${data.status}', must be 'approved'` }, 422);
    question = data;
  }

  if (blueprint_id || question?.blueprint_id) {
    const bpId = blueprint_id || question.blueprint_id;
    const { data } = await sb
      .from("question_blueprints")
      .select("id, topic, subtopic, difficulty, bloom_level, ihk_relevant, status")
      .eq("id", bpId)
      .maybeSingle();
    if (data) {
      if (data.status && data.status !== "approved" && data.status !== "active") {
        return json({ error: `SSOT_GATE: Blueprint status is '${data.status}', must be 'approved'` }, 422);
      }
      blueprint = data;
    }
  }

  // Find approved question from blueprint if none given
  if (!question && blueprint_id) {
    const { data } = await sb
      .from("exam_questions")
      .select("id, question_text, correct_answer, explanation, difficulty, cognitive_level, curriculum_id, competency_id, blueprint_id, status")
      .eq("blueprint_id", blueprint_id)
      .eq("status", "approved")
      .limit(1)
      .maybeSingle();
    if (!data) return json({ error: "No approved question found for blueprint" }, 404);
    question = data;
  }

  if (!question) return json({ error: "No approved question available" }, 404);

  // ── Pick a hook ──
  const { data: hooks } = await sb
    .from("content_hooks")
    .select("id, hook_text, category, usage_count")
    .eq("is_active", true)
    .eq("category", content_category)
    .limit(10);

  const selectedHook = hooks && hooks.length > 0
    ? hooks[Math.floor(Math.random() * hooks.length)]
    : null;

  // ── Build source snapshot (audit) ──
  const sourceSnapshot = {
    question_id: question.id,
    question_text: question.question_text,
    correct_answer: question.correct_answer,
    explanation: question.explanation || null,
    difficulty: question.difficulty,
    cognitive_level: question.cognitive_level,
    blueprint_id: blueprint?.id || question.blueprint_id,
    blueprint_topic: blueprint?.topic || null,
    blueprint_subtopic: blueprint?.subtopic || null,
    snapshot_at: new Date().toISOString(),
  };

  // ── Insert job as queued ──
  const { data: job, error: insertErr } = await sb.from("content_jobs").insert({
    blueprint_id: blueprint?.id || question.blueprint_id,
    question_id: question.id,
    curriculum_id: question.curriculum_id,
    competency_id: question.competency_id,
    content_type,
    platform,
    status: "queued",
    hook: selectedHook?.hook_text || null,
    hook_id: selectedHook?.id || null,
    target_audience,
    content_category,
    source_type: question_id ? "question" : "blueprint",
    source_snapshot: sourceSnapshot,
    generation_meta: { format, hook_category: content_category },
  }).select("id").single();

  if (insertErr) return json({ error: `Insert failed: ${insertErr.message}` }, 500);

  return json({ ok: true, content_job_id: job.id, status: "queued" });
}

// ─── PROCESS MODE (Worker) ──────────────────────────────────
async function processJobs(sb: any, apiKey: string, limit: number) {
  // Claim jobs atomically
  const { data: claimed, error: claimErr } = await sb.rpc("claim_content_jobs", {
    p_limit: Math.min(limit, 5),
    p_worker_id: "generate-content-worker",
  });

  if (claimErr) return json({ error: `Claim failed: ${claimErr.message}` }, 500);
  if (!claimed || claimed.length === 0) return json({ ok: true, processed: 0, message: "No jobs to process" });

  const results: any[] = [];

  for (const job of claimed) {
    try {
      await processOneJob(sb, apiKey, job);
      results.push({ id: job.id, status: "generated" });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[generate-content] Job ${job.id} failed:`, msg);

      await sb.from("content_jobs").update({
        status: "failed",
        last_error: msg.slice(0, 2000),
        attempt_count: (job.attempt_count || 0) + 1,
        updated_at: new Date().toISOString(),
      }).eq("id", job.id);

      results.push({ id: job.id, status: "failed", error: msg.slice(0, 200) });
    }
  }

  return json({ ok: true, processed: results.length, results });
}

async function processOneJob(sb: any, apiKey: string, job: any) {
  const format = job.generation_meta?.format || "1min_ihk_frage";
  const snapshot = job.source_snapshot || {};

  // Rebuild from snapshot (no extra DB calls needed)
  const questionText = snapshot.question_text || "Keine Frage verfügbar";
  const correctAnswer = snapshot.correct_answer || "";
  const explanation = snapshot.explanation || "";
  const difficulty = snapshot.difficulty || "mittel";
  const bloomLevel = snapshot.cognitive_level || "verstehen";
  const blueprintTopic = snapshot.blueprint_topic || "";
  const blueprintSubtopic = snapshot.blueprint_subtopic || "";
  const hookText = job.hook || "Diese Frage kommt in der IHK-Prüfung:";

  // ── Build prompt ──
  const formatTemplates: Record<string, string> = {
    "1min_ihk_frage": `Erstelle ein TikTok/Reels-Skript im Format "1 Minute – 1 IHK Frage".

HOOK (0-3 Sek, maximal provokant, stoppe den Scroll):
Nutze diesen Hook als Inspiration: "${hookText}"

FRAGE (3-8 Sek):
Zeige die Prüfungsfrage klar und deutlich.

PAUSE (1-2 Sek):
"Was würdest du wählen?" oder ähnlich.

AUFLÖSUNG (8-20 Sek):
Erkläre, warum die richtige Antwort korrekt ist. Kurz, klar, prüfungsnah.

CTA (2-3 Sek):
Leite zu ExamFit weiter.

Regeln:
- Sprache: Du-Anrede, direkt, jung, nicht schulisch
- Keine Floskeln
- Prüfungsnähe betonen
- Maximal 150 Wörter gesamt`,

    "fehleranalyse": `Erstelle ein Fehleranalyse-Video-Skript.
Zeige einen typischen Azubi-Fehler bei dieser Prüfungsfrage.
Erkläre, warum der Fehler passiert und wie man ihn vermeidet.
Regeln: "Die meisten denken..." → "Aber richtig ist..."
Prüfungscoach-Tonalität. Maximal 120 Wörter.`,

    "post": `Erstelle einen Instagram/LinkedIn Post-Text.
Zeige die Frage als Text-Post. Inkludiere: Frage, falsche Denkweise, richtige Antwort, Lern-Tipp.
Hashtags: #IHKPrüfung #Azubi #Prüfungsvorbereitung #ExamFit
Maximal 200 Wörter.`,
  };

  const template = formatTemplates[format] || formatTemplates["1min_ihk_frage"];

  const systemPrompt = `Du bist der ExamFit Prüfungscoach – direkt, ehrlich, kompetent.
Du erstellst Social-Media-Content für Azubis, die ihre IHK-Prüfung bestehen wollen.
Dein Ton: motivierend aber realistisch, jung aber nicht albern, prüfungsnah.
Marke: ExamFit – "Bestehe deine IHK-Prüfung. Systematisch. Messbar. Sicher."`;

  const userPrompt = `${template}

--- PRÜFUNGSFRAGE ---
Frage: ${questionText}
Richtige Antwort: ${correctAnswer}
Erklärung: ${explanation || "Keine zusätzliche Erklärung verfügbar."}
Schwierigkeit: ${difficulty}
Bloom-Level: ${bloomLevel}
${blueprintTopic ? `Blueprint-Thema: ${blueprintTopic} / ${blueprintSubtopic}` : ""}
---

Liefere NUR das fertige Skript, keine Meta-Kommentare.`;

  // ── Call Lovable AI ──
  const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-3-flash-preview",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.8,
    }),
  });

  if (!aiResponse.ok) {
    const errText = await aiResponse.text().catch(() => "unknown");
    throw new Error(`AI_GATEWAY_${aiResponse.status}: ${errText.slice(0, 300)}`);
  }

  const aiJson = await aiResponse.json();
  const script = aiJson.choices?.[0]?.message?.content || "";
  const usage = aiJson.usage || {};

  if (!script || script.length < 20) {
    throw new Error("ZERO_GENERATION: AI returned empty or too-short script");
  }

  // Extract hook from script
  const scriptLines = script.split("\n").filter((l: string) => l.trim());
  const extractedHook = scriptLines[0]?.replace(/^(HOOK|hook|Hook)[:\s]*/i, "").trim() || hookText;

  // ── Update job to generated ──
  const { error: updateErr } = await sb.from("content_jobs").update({
    status: "generated",
    script,
    hook: extractedHook,
    cta: "Teste dich auf ExamFit → examfit.de",
    hashtags: ["IHKPrüfung", "Azubi", "Prüfungsvorbereitung", "ExamFit"],
    llm_model: "google/gemini-3-flash-preview",
    llm_cost_eur: 0,
    attempt_count: (job.attempt_count || 0) + 1,
    generation_meta: {
      ...job.generation_meta,
      format,
      hook_used: hookText,
      usage,
      generated_at: new Date().toISOString(),
    },
    updated_at: new Date().toISOString(),
  }).eq("id", job.id);

  if (updateErr) throw new Error(`Update failed: ${updateErr.message}`);

  // ── Track hook usage ──
  if (job.hook_id) {
    await sb.rpc("increment_content_hook_usage", { p_hook_id: job.hook_id }).catch(() => {});
  }
}
