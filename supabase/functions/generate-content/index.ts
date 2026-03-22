import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const lovableApiKey = Deno.env.get("LOVABLE_API_KEY");

  if (!lovableApiKey) {
    return new Response(JSON.stringify({ error: "LOVABLE_API_KEY not configured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const sb = createClient(supabaseUrl, serviceKey);

  try {
    const body = await req.json();
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
      return new Response(JSON.stringify({ error: "blueprint_id or question_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 1. Load question (from blueprint or directly)
    let question: any = null;
    let blueprint: any = null;

    if (question_id) {
      const { data, error } = await sb
        .from("exam_questions")
        .select("id, question_text, correct_answer, explanation, difficulty, cognitive_level, curriculum_id, competency_id, blueprint_id")
        .eq("id", question_id)
        .single();
      if (error) throw new Error(`Question not found: ${error.message}`);
      question = data;
    }

    if (blueprint_id || question?.blueprint_id) {
      const bpId = blueprint_id || question.blueprint_id;
      const { data, error } = await sb
        .from("question_blueprints")
        .select("id, topic, subtopic, difficulty, bloom_level, ihk_relevant")
        .eq("id", bpId)
        .single();
      if (!error && data) blueprint = data;
    }

    // If no question given, find one from blueprint
    if (!question && blueprint_id) {
      const { data } = await sb
        .from("exam_questions")
        .select("id, question_text, correct_answer, explanation, difficulty, cognitive_level, curriculum_id, competency_id, blueprint_id")
        .eq("blueprint_id", blueprint_id)
        .eq("status", "approved")
        .limit(1)
        .single();
      if (data) question = data;
    }

    if (!question) {
      return new Response(JSON.stringify({ error: "No approved question found for blueprint" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 2. Load a random hook
    const { data: hooks } = await sb
      .from("content_hooks")
      .select("hook_text, category")
      .eq("is_active", true)
      .eq("category", content_category)
      .limit(5);

    const randomHook = hooks && hooks.length > 0
      ? hooks[Math.floor(Math.random() * hooks.length)].hook_text
      : "Diese Frage kommt in der IHK-Prüfung:";

    // 3. Build prompt based on format
    const formatTemplates: Record<string, string> = {
      "1min_ihk_frage": `Erstelle ein TikTok/Reels-Skript im Format "1 Minute – 1 IHK Frage".

HOOK (0-3 Sek, maximal provokant, stoppe den Scroll):
Nutze diesen Hook als Inspiration: "${randomHook}"

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

Regeln:
- "Die meisten denken..." → "Aber richtig ist..."
- Prüfungscoach-Tonalität
- Maximal 120 Wörter`,

      "post": `Erstelle einen Instagram/LinkedIn Post-Text.

Zeige die Frage als Karussell-Idee oder Text-Post.
Inkludiere: Frage, falsche Denkweise, richtige Antwort, Lern-Tipp.
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
Frage: ${question.question_text}
Richtige Antwort: ${question.correct_answer}
Erklärung: ${question.explanation || "Keine zusätzliche Erklärung verfügbar."}
Schwierigkeit: ${question.difficulty || "mittel"}
Bloom-Level: ${question.cognitive_level || "verstehen"}
${blueprint ? `Blueprint-Thema: ${blueprint.topic} / ${blueprint.subtopic || ""}` : ""}
---

Liefere NUR das fertige Skript, keine Meta-Kommentare.`;

    // 4. Call Lovable AI
    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${lovableApiKey}`,
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
      const errText = await aiResponse.text();
      if (aiResponse.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Bitte warte kurz." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (aiResponse.status === 402) {
        return new Response(JSON.stringify({ error: "AI Credits aufgebraucht." }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw new Error(`AI Gateway error [${aiResponse.status}]: ${errText}`);
    }

    const aiJson = await aiResponse.json();
    const script = aiJson.choices?.[0]?.message?.content || "";
    const usage = aiJson.usage || {};

    // Extract hook from script (first line usually)
    const scriptLines = script.split("\n").filter((l: string) => l.trim());
    const extractedHook = scriptLines[0]?.replace(/^(HOOK|hook|Hook)[:\s]*/i, "").trim() || randomHook;

    // 5. Save content_job
    const { data: job, error: insertErr } = await sb.from("content_jobs").insert({
      blueprint_id: blueprint?.id || question.blueprint_id,
      question_id: question.id,
      curriculum_id: question.curriculum_id,
      competency_id: question.competency_id,
      content_type,
      platform,
      status: "generated",
      hook: extractedHook,
      script,
      cta: "Teste dich auf ExamFit → examfit.de",
      hashtags: ["IHKPrüfung", "Azubi", "Prüfungsvorbereitung", "ExamFit", "IHK"],
      target_audience,
      content_category,
      llm_model: "google/gemini-3-flash-preview",
      llm_cost_eur: 0,
      generation_meta: {
        format,
        hook_used: randomHook,
        question_difficulty: question.difficulty,
        bloom_level: question.cognitive_level,
        usage,
      },
    }).select("id").single();

    if (insertErr) throw new Error(`Insert failed: ${insertErr.message}`);

    // 6. Update hook usage count
    if (hooks && hooks.length > 0) {
      await sb.rpc("increment_hook_usage_noop").catch(() => {
        // noop if rpc doesn't exist yet
      });
    }

    return new Response(JSON.stringify({
      success: true,
      content_job_id: job?.id,
      script,
      hook: extractedHook,
      question_id: question.id,
      blueprint_id: blueprint?.id,
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    console.error("generate-content error:", err);
    const msg = err instanceof Error ? err.message : "Unknown error";
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
