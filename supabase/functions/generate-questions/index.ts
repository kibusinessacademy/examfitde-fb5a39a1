import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { validateAuth, unauthorizedResponse, forbiddenResponse } from "../_shared/auth.ts";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";
import { callAIJSON, aiErrorResponse } from "../_shared/ai-client.ts";

serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req);
  if (corsResponse) return corsResponse;

  const origin = req.headers.get('origin');
  const corsHeaders = getCorsHeaders(origin);

  // ==================== AUTH CHECK ====================
  const auth = await validateAuth(req, true);
  
  if (auth.error) {
    if (auth.error === 'Admin access required') {
      return forbiddenResponse(auth.error);
    }
    return unauthorizedResponse(auth.error);
  }
  // ====================================================

  try {
    const { competencyId, competencyTitle, competencyDescription, learningFieldTitle, curriculumId, count = 3, difficulty = 'medium' } = await req.json();

    // Load profession name dynamically
    let professionName = "Auszubildende";
    if (curriculumId) {
      const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
      try {
        const { data: curriculum } = await supabase.from("curricula").select("title, beruf_id").eq("id", curriculumId).maybeSingle();
        if (curriculum?.beruf_id) {
          const { data: beruf } = await supabase.from("berufe").select("bezeichnung_kurz, bezeichnung_lang").eq("id", curriculum.beruf_id).maybeSingle();
          if (beruf) professionName = beruf.bezeichnung_kurz || beruf.bezeichnung_lang || professionName;
        } else if (curriculum?.title) {
          const match = curriculum.title.replace(/^Rahmenlehrplan\s+/i, "").trim();
          if (match) professionName = match;
        }
      } catch (e) {
        console.error("[generate-questions] Profession load failed:", e);
      }
    }

    console.log(`[User: ${auth.user?.id}] Generating ${count} ${difficulty} questions for "${professionName}": ${competencyTitle}`);

    const systemPrompt = `Du bist ein erfahrener IHK-Prüfungsexperte für ${professionName}. Du erstellst Prüfungsfragen, die sich anfühlen, als kämen sie direkt aus einer echten IHK-Abschlussprüfung für ${professionName}.

REGELN:
- Jede Frage hat genau 4 Antwortmöglichkeiten
- Nur eine Antwort ist korrekt
- Fragen müssen einen konkreten Praxisbezug zum Berufsalltag von ${professionName} haben
- Distraktoren bilden typische Denkfehler von ${professionName} ab
- Schwierigkeit: easy (Grundwissen), medium (Anwendung/Berechnung), hard (Analyse/Transfer)
- Ausführliche Erklärung mit Fachbegriffen von ${professionName}
- KEINE generischen Fragen ohne Berufsbezug
- Fragen dürfen NICHT nach KI klingen — formuliere wie ein erfahrener IHK-Aufgabenersteller

Antworte AUSSCHLIESSLICH mit einem validen JSON-Array:
[
  {
    "question_text": "Konkretes Szenario aus dem Alltag von ${professionName}...",
    "options": ["Option A", "Option B", "Option C", "Option D"],
    "correct_answer": 0,
    "explanation": "Fachliche Erklärung mit Bezug zu ${professionName}...",
    "difficulty": "easy|medium|hard"
  }
]`;

    const userPrompt = `Erstelle ${count} ${difficulty === 'easy' ? 'leichte' : difficulty === 'medium' ? 'mittelschwere' : 'schwere'} Prüfungsfragen für ${professionName}.

Lernfeld: ${learningFieldTitle}
Kompetenz: ${competencyTitle}
${competencyDescription ? `Beschreibung: ${competencyDescription}` : ''}

WICHTIG: Jede Frage braucht ein konkretes Szenario aus dem Arbeitsalltag von ${professionName}. Keine generischen "Was ist...?"-Fragen.`;

    const result = await callAIJSON({
      provider: "openai",
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.7,
    });

    if (!result.content) {
      throw new Error('No content in AI response');
    }

    let questions;
    try {
      const cleanContent = result.content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      questions = JSON.parse(cleanContent);
    } catch (parseError) {
      console.error('JSON parse error:', parseError);
      throw new Error('Failed to parse AI response as JSON');
    }

    const formattedQuestions = questions.map((q: any, idx: number) => ({
      question_text: q.question_text,
      options: q.options,
      correct_answer: q.correct_answer,
      explanation: q.explanation,
      difficulty: q.difficulty || difficulty,
      competency_id: competencyId,
      ai_generated: true,
      status: 'draft',
    }));

    console.log(`Successfully generated ${formattedQuestions.length} questions for "${professionName}"`);

    return new Response(
      JSON.stringify({ success: true, questions: formattedQuestions }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Generate questions error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});