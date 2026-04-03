import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.89.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const FORMATS = ["durchfall_realitaet", "mini_klausur", "aha_moment"] as const;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const body = await req.json().catch(() => ({}));
    const count = Math.min(body.count || 10, 20);

    // Get random approved questions with good explanations
    const { data: questions, error: qErr } = await supabase
      .from("exam_questions")
      .select("id, question_text, correct_answer, explanation, options, difficulty, cognitive_level, curriculum_id, trap_type")
      .eq("status", "approved")
      .not("explanation", "is", null)
      .not("question_text", "is", null)
      .order("created_at", { ascending: false })
      .limit(200);

    if (qErr) throw qErr;
    if (!questions || questions.length === 0) {
      return new Response(JSON.stringify({ generated: 0, reason: "no_questions" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Filter out already-used questions
    const questionIds = questions.map((q: any) => q.id);
    const { data: existing } = await supabase
      .from("video_scripts")
      .select("source_question_id")
      .in("source_question_id", questionIds);

    const usedIds = new Set((existing || []).map((e: any) => e.source_question_id));
    const available = questions.filter((q: any) => !usedIds.has(q.id));

    if (available.length === 0) {
      return new Response(JSON.stringify({ generated: 0, reason: "all_used" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const selected = available.sort(() => Math.random() - 0.5).slice(0, count);
    const results: any[] = [];

    for (let i = 0; i < selected.length; i++) {
      const question = selected[i];
      const formatType = FORMATS[i % FORMATS.length];

      try {
        const prompt = buildVideoPrompt(question, formatType);

        const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${LOVABLE_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "google/gemini-3-flash-preview",
            messages: [
              { role: "system", content: VIDEO_SYSTEM_PROMPT },
              { role: "user", content: prompt },
            ],
            tools: [{
              type: "function",
              function: {
                name: "create_video_script",
                description: "Create a structured video script for social media",
                parameters: {
                  type: "object",
                  properties: {
                    hook_text: { type: "string", description: "Opening hook, max 15 words, creates tension" },
                    body_text: { type: "string", description: "Main content with problem + example, 50-80 words" },
                    twist_text: { type: "string", description: "Surprising insight or reframe, 15-25 words" },
                    cta_text: { type: "string", description: "Call to action, max 10 words" },
                    caption_text: { type: "string", description: "Social media caption with emojis, 2-3 lines + CTA" },
                    title_suggestion: { type: "string", description: "Video title for internal use" },
                  },
                  required: ["hook_text", "body_text", "twist_text", "cta_text", "caption_text", "title_suggestion"],
                  additionalProperties: false,
                },
              },
            }],
            tool_choice: { type: "function", function: { name: "create_video_script" } },
          }),
        });

        if (!aiResp.ok) {
          const errText = await aiResp.text();
          console.error(`AI error for question ${question.id}: ${aiResp.status} ${errText}`);
          if (aiResp.status === 429 || aiResp.status === 402) break;
          continue;
        }

        const aiData = await aiResp.json();
        const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];
        if (!toolCall) { console.error("No tool call in response"); continue; }

        const script = JSON.parse(toolCall.function.arguments);

        const { error: insertErr } = await supabase.from("video_scripts").insert({
          format_type: formatType,
          hook_text: script.hook_text,
          body_text: script.body_text,
          twist_text: script.twist_text,
          cta_text: script.cta_text,
          caption_text: script.caption_text,
          script_json: {
            title: script.title_suggestion,
            format: formatType,
            source_question: question.question_text?.substring(0, 100),
            sections: {
              hook: script.hook_text,
              body: script.body_text,
              twist: script.twist_text,
              cta: script.cta_text,
            },
          },
          source_question_id: question.id,
          source_curriculum_id: question.curriculum_id,
          status: "ready",
        });

        if (insertErr) {
          console.error(`Insert error: ${insertErr.message}`);
          continue;
        }

        results.push({ format: formatType, title: script.title_suggestion, questionId: question.id });
      } catch (e) {
        console.error(`Error processing question ${question.id}:`, e);
      }
    }

    return new Response(JSON.stringify({ generated: results.length, scripts: results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("content-video-generate error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

const VIDEO_SYSTEM_PROMPT = `Du bist ein Social-Media-Skript-Autor für ExamFit (Klausurtraining für Studierende).

REGELN:
- Deutsch, Du-Ansprache, direkt und emotional
- Hook MUSS sofort Schmerz oder Neugier erzeugen (max 2 Sekunden Sprechzeit)
- KEIN Intro, KEIN Branding am Anfang
- Sprich wie ein Freund, nicht wie ein Unternehmen
- Nutze die Killer-Line: "Du lernst nicht mehr. Du trainierst, zu bestehen."
- CTAs: "Teste dich kostenlos auf ExamFit" oder "Trainiere echte Prüfungsfragen auf ExamFit"
- Alles muss als gesprochener Text funktionieren (für TikTok/Reels)
- Captions mit Emojis und Zeilenumbrüchen`;

function buildVideoPrompt(question: any, format: string): string {
  const optionsText = question.options
    ? Object.entries(question.options as Record<string, string>)
        .map(([k, v]) => `${k}: ${v}`)
        .join("\n")
    : "";

  const formatInstructions: Record<string, string> = {
    durchfall_realitaet: `FORMAT: "Durchfall-Realität" (Angst-Trigger)
- Hook: Warum Studierende durchfallen (NICHT weil sie nicht lernen)
- Problem: Falsche Lernmethode aufzeigen
- Beispiel: Konkreter Prüfungsfall
- Twist: "Die Uni bringt dir Wissen. Niemand bringt dir die Prüfung bei."
- Stark bei: Kalter Zielgruppe, Aufmerksamkeit`,

    mini_klausur: `FORMAT: "Mini-Klausur" (Interaktion)
- Hook: "Würdest du diese Klausurfrage bestehen?"
- Frage einblenden (vereinfacht, nicht 1:1)
- Pause-Moment ("Denk kurz nach...")
- Auflösung + typischer Denkfehler
- Stark bei: Engagement, Shares`,

    aha_moment: `FORMAT: "Aha-Moment" (Erkenntnis)
- Hook: "Das ist der Grund, warum du trotz Lernen durchfällst."
- Kern-Erkenntnis: Wissen ≠ Bestehen
- Kurzes Beispiel
- Punchline: "Trainiere zu bestehen, nicht zu lernen."
- Stark bei: Warmer Zielgruppe, Vertrauen`,
  };

  return `Erstelle ein Video-Skript basierend auf dieser Prüfungsfrage:

**Frage:** ${question.question_text}

**Optionen:**
${optionsText}

**Richtige Antwort:** ${question.correct_answer}
**Erklärung:** ${question.explanation || ""}
**Trap-Typ:** ${question.trap_type || "keiner"}

${formatInstructions[format] || formatInstructions.mini_klausur}

WICHTIG: Das Skript muss als gesprochener Text funktionieren (15-30 Sekunden).`;
}
