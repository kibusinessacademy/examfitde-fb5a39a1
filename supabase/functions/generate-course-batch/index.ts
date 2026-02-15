import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";
import { callAIJSON, AITool } from "../_shared/ai-client.ts";
import { getModel } from "../_shared/model-routing.ts";

const LESSON_STEPS = ["einstieg", "verstehen", "anwenden", "wiederholen", "mini_check"] as const;
type LessonStep = (typeof LESSON_STEPS)[number];

const STEP_PROMPTS: Record<string, string> = {
  einstieg: "Erstelle eine aktivierende Einstiegsaktivität, die das Vorwissen der Lernenden anspricht und Neugier für das Thema weckt. Nutze ein konkretes Praxisszenario aus dem Berufsalltag.",
  verstehen: "Erstelle Lernmaterial zum Verstehen der Konzepte mit klaren Erklärungen, Gegenbeispielen und IHK-Prüfungsbezügen. Markiere prüfungsrelevante Inhalte mit ⭐. Füge nach jeder Erklärung ein Gegenbeispiel hinzu, das typische Fehlannahmen verdeutlicht.",
  anwenden: "Erstelle ein Entscheidungsszenario (KEINE reine Beschreibung). Der Lernende muss eine berufliche Entscheidung treffen und begründen. Zeige typische Prüfungsfallen mit ⚠️. Mindestens 2 Entscheidungsoptionen mit Abwägung.",
  wiederholen: "Erstelle KEINE erneute Erklärung. Erstelle stattdessen PRÜFUNGSVERDICHTUNG: 1. Merksätze 2. Typische IHK-Prüfungsfallen 3. Abgrenzungen 4. Formulierungsübungen 5. Prüfer-Hinweis",
  mini_check: "Erstelle 4 situative Multiple-Choice-Fragen auf IHK-Prüfungsniveau. QUALITÄTSSTANDARD: Mindestens 2 Fragen MÜSSEN ein konkretes Fallbeispiel/Szenario enthalten. Distraktoren müssen PLAUSIBEL sein.",
};

const MINI_CHECK_TOOL: AITool = {
  type: "function",
  function: {
    name: "create_mini_check",
    description: "Erstelle 4 Multiple-Choice-Fragen zur Wissensüberprüfung.",
    parameters: {
      type: "object",
      properties: {
        questions: {
          type: "array", minItems: 4, maxItems: 5,
          items: {
            type: "object",
            properties: {
              question: { type: "string" }, options: { type: "array", items: { type: "string" } }, correct_answer: { type: "number" }, explanation: { type: "string" }
            },
            required: ["question", "options", "correct_answer", "explanation"]
          }
        },
        objectives: { type: "array", items: { type: "string" } }
      },
      required: ["questions", "objectives"]
    }
  }
};

serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req);
  if (corsResponse) return corsResponse;
  const origin = req.headers.get("origin");
  const corsHeaders = getCorsHeaders(origin);

  try {
    const { courseId, lessonId, step, competency } = await req.json();
    if (!competency || !step) throw new Error("Missing params");

    const routed = step === "mini_check" ? getModel("minicheck") : getModel("learning_course");
    const systemPrompt = "Du bist ein IHK-Experte für berufliche Ausbildungsinhalte. Erstelle strukturierte, praxisnahe Lerninhalte im JSON-Format. Markiere prüfungsrelevante Stellen mit ⭐.";
    const userPrompt = `Erstelle Lerninhalt für:\nKompetenz: ${competency.title}\nBeschreibung: ${competency.description}\nTaxonomie: ${competency.taxonomy_level}\nLernschritt: ${step}\nAufgabe: ${STEP_PROMPTS[step]}`;

    let result;
    if (step === "mini_check") {
      const aiRes = await callAIJSON({
        provider: routed.provider, model: routed.model,
        messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }],
        tools: [MINI_CHECK_TOOL], tool_choice: { type: "function", function: { name: "create_mini_check" } }
      });
      const args = aiRes.toolCalls?.[0]?.function?.arguments;
      if (!args) throw new Error("No tool args");
      const parsed = JSON.parse(args);
      result = {
        type: "mini_check",
        html: `<h3>Wissensüberprüfung: ${competency.title}</h3><p>Teste dein Wissen mit Multiple-Choice-Fragen.</p>`,
        objectives: parsed.objectives || [`Wissen zu ${competency.title} überprüfen`],
        questions: parsed.questions
      };
    } else {
      const aiRes = await callAIJSON({
        provider: routed.provider, model: routed.model,
        messages: [{ role: "system", content: systemPrompt + " Antworte mit JSON: { type: 'text', html: '...', objectives: [], ihk_relevanz: '...' }" }, { role: "user", content: userPrompt }]
      });
      try {
        const jsonMatch = aiRes.content.match(/\{[\s\S]*\}/);
        result = JSON.parse(jsonMatch?.[0] || aiRes.content);
      } catch { throw new Error("Failed to parse AI response"); }
    }

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    
    // Track generation
    const { data: genRec } = await supabase.from("ai_generations").insert({
      entity_type: "lesson", generator_model: routed.model,
      input_context: { competency: competency.title, step, taxonomy: competency.taxonomy_level, courseId },
      output_content: result, status: "generated", metadata: { provider: routed.provider, competencyCode: competency.code }
    }).select("id").single();

    // Trigger validation
    try {
      await supabase.functions.invoke("validate-content", {
        body: { mode: "lesson", content: result, generationId: genRec?.id, courseId, lessonId, generatorProvider: routed.provider }
      });
    } catch (e) { console.error("Validation trigger failed:", e); }

    return new Response(JSON.stringify(result), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (err) {
    console.error("generate-course-batch error:", err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
