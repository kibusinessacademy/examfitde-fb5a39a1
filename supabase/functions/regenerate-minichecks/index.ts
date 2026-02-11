import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";

/**
 * Regenerate MiniChecks — produces MiniCheckPlayer-compatible JSON:
 * { type:"mini_check", questions:[{id,text,options:[{id,text,is_correct}],explanation_correct,explanation_wrong}] }
 */

const MINICHECK_TOOL = {
  type: "function",
  function: {
    name: "create_mini_check",
    description: "Create a mini-check quiz with exactly 4 questions. Each question has exactly 4 options, one correct.",
    parameters: {
      type: "object",
      properties: {
        questions: {
          type: "array",
          minItems: 4,
          maxItems: 4,
          items: {
            type: "object",
            properties: {
              question: { type: "string", description: "Question text in German" },
              options: {
                type: "array",
                minItems: 4,
                maxItems: 4,
                items: { type: "string" }
              },
              correct_answer: {
                type: "integer",
                description: "Index 0-3 of the correct option",
                minimum: 0,
                maximum: 3
              },
              explanation_correct: { type: "string", description: "Why the correct answer is right" },
              explanation_wrong: { type: "string", description: "Common misconception / why others are wrong" }
            },
            required: ["question", "options", "correct_answer", "explanation_correct", "explanation_wrong"]
          }
        }
      },
      required: ["questions"]
    }
  }
};

/** Convert AI output → MiniCheckPlayer format */
function toPlayerFormat(aiQuestions: any[]): any {
  return {
    type: "mini_check",
    questions: aiQuestions.map((q, qi) => ({
      id: `q${qi + 1}`,
      text: q.question,
      options: q.options.map((opt: string, oi: number) => ({
        id: `q${qi + 1}_o${oi + 1}`,
        text: opt,
        is_correct: oi === q.correct_answer
      })),
      explanation_correct: q.explanation_correct || "Richtig!",
      explanation_wrong: q.explanation_wrong || "Leider falsch."
    })),
    generated_at: new Date().toISOString(),
    version: 3
  };
}

serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req);
  if (corsResponse) return corsResponse;
  const origin = req.headers.get("origin");
  const corsHeaders = getCorsHeaders(origin);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Parse optional body for limiting batch size
    let batchLimit = 20;
    try {
      const body = await req.json();
      if (body?.limit) batchLimit = Math.min(body.limit, 50);
    } catch { /* no body = defaults */ }

    // Find empty MiniChecks
    const { data: emptyMiniChecks, error: fetchErr } = await supabase
      .from("lessons")
      .select(`
        id, title, competency_id, content,
        competencies!inner(code, title, description)
      `)
      .eq("step", "mini_check")
      .limit(batchLimit);

    if (fetchErr) throw fetchErr;

    // Filter to those with no valid questions
    const lessonsToFix = (emptyMiniChecks || []).filter((l: any) => {
      const c = l.content as any;
      if (!c?.questions || !Array.isArray(c.questions)) return true;
      // Check if questions have the player format (text + options with is_correct)
      const valid = c.questions.filter((q: any) =>
        q?.text && q?.options?.length >= 4 && q.options.some((o: any) => o.is_correct === true)
      );
      return valid.length < 3;
    });

    if (lessonsToFix.length === 0) {
      return new Response(JSON.stringify({ success: true, message: "All MiniChecks valid", fixed: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    console.log(`Processing ${lessonsToFix.length} empty MiniChecks`);
    let fixed = 0, failed = 0;
    const errors: string[] = [];

    for (const lesson of lessonsToFix) {
      try {
        const comp = (lesson as any).competencies;
        const code = comp?.code || "?";
        const title = comp?.title || lesson.title;
        const desc = comp?.description || "";

        console.log(`Generating: ${code} – ${title}`);

        const prompt = `Du bist ein Experte für IHK-Prüfungsvorbereitung. Erstelle einen Mini-Check Quiz:

**Kompetenz:** ${code} – ${title}
**Beschreibung:** ${desc}

REGELN:
1. EXAKT 4 Multiple-Choice-Fragen auf IHK-Prüfungsniveau
2. Jede Frage hat EXAKT 4 Antwortmöglichkeiten
3. Nur EINE Antwort ist korrekt
4. Distraktoren müssen plausibel klingen
5. explanation_correct: Warum die richtige Antwort stimmt
6. explanation_wrong: Häufiger Denkfehler / warum die anderen falsch sind

Nutze die Funktion create_mini_check.`;

        const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${LOVABLE_API_KEY}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            model: "google/gemini-3-flash-preview",
            messages: [
              { role: "system", content: "Du bist ein deutscher IHK-Ausbildungsexperte. Antworte auf Deutsch. Nutze IMMER die Funktion." },
              { role: "user", content: prompt }
            ],
            tools: [MINICHECK_TOOL],
            tool_choice: { type: "function", function: { name: "create_mini_check" } },
            max_tokens: 2500
          })
        });

        if (!resp.ok) {
          errors.push(`${code}: AI ${resp.status}`);
          failed++;
          continue;
        }

        const ai = await resp.json();
        const toolCall = ai.choices?.[0]?.message?.tool_calls?.[0];
        if (!toolCall?.function?.arguments) {
          errors.push(`${code}: no tool call`);
          failed++;
          continue;
        }

        let parsed: any;
        try { parsed = JSON.parse(toolCall.function.arguments); } catch {
          errors.push(`${code}: JSON parse error`);
          failed++;
          continue;
        }

        const qs = parsed.questions;
        if (!Array.isArray(qs) || qs.length < 3) {
          errors.push(`${code}: only ${qs?.length ?? 0} questions`);
          failed++;
          continue;
        }

        // Validate
        const validQs = qs.filter((q: any) =>
          q?.question && Array.isArray(q?.options) && q.options.length >= 4 &&
          typeof q?.correct_answer === "number" && q.correct_answer >= 0 && q.correct_answer <= 3
        );

        if (validQs.length < 3) {
          errors.push(`${code}: ${validQs.length} valid`);
          failed++;
          continue;
        }

        // Convert to player format and save
        const playerContent = toPlayerFormat(validQs.slice(0, 4));

        const { error: updErr } = await supabase
          .from("lessons")
          .update({ content: playerContent, updated_at: new Date().toISOString() })
          .eq("id", lesson.id);

        if (updErr) {
          errors.push(`${code}: DB error`);
          failed++;
          continue;
        }

        // Also upsert into minicheck_questions table
        for (const pq of playerContent.questions) {
          const correctOpt = pq.options.find((o: any) => o.is_correct);
          await supabase.from("minicheck_questions").upsert({
            lesson_id: lesson.id,
            question_text: pq.text,
            options: pq.options.map((o: any) => o.text),
            correct_option_index: pq.options.findIndex((o: any) => o.is_correct),
            explanation: pq.explanation_correct,
            difficulty: "medium",
            competency_id: lesson.competency_id
          }, { onConflict: "lesson_id,question_text" }).select();
        }

        console.log(`✅ ${code}: ${validQs.length} questions saved`);
        fixed++;

        // Rate limit protection
        await new Promise(r => setTimeout(r, 600));

      } catch (e) {
        errors.push(`${lesson.id}: ${e instanceof Error ? e.message : "unknown"}`);
        failed++;
      }
    }

    return new Response(JSON.stringify({ success: true, fixed, failed, total: lessonsToFix.length, errors: errors.length ? errors : undefined }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });

  } catch (error) {
    console.error("regenerate-minichecks error:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});
