import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { validateAuth, unauthorizedResponse, forbiddenResponse } from "../_shared/auth.ts";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";
import { callAIJSON, aiErrorResponse } from "../_shared/ai-client.ts";

const systemPrompt = `Du bist ein Experte für die Erstellung von Prüfungsfragen für Berufsausbildungen (IHK-Prüfungen).
Erstelle Multiple-Choice-Fragen basierend auf dem gegebenen Thema und der Kompetenz.

Regeln:
- Jede Frage hat genau 4 Antwortmöglichkeiten
- Nur eine Antwort ist korrekt
- Fragen sollen praxisnah und prüfungsrelevant sein
- Schwierigkeit anpassen: easy (Wissen), medium (Verstehen/Anwenden), hard (Analysieren/Bewerten)
- Ausführliche Erklärung für die richtige Antwort

Antworte AUSSCHLIESSLICH mit einem validen JSON-Array:
[
  {
    "question_text": "Die Frage...",
    "options": ["Option A", "Option B", "Option C", "Option D"],
    "correct_answer": 0,
    "explanation": "Erklärung warum Option A richtig ist...",
    "difficulty": "easy|medium|hard"
  }
]`;

serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req);
  if (corsResponse) return corsResponse;

  const origin = req.headers.get('origin');
  const corsHeaders = getCorsHeaders(origin);

  // ==================== AUTH CHECK ====================
  // Require admin role to generate questions (expensive AI operation)
  const auth = await validateAuth(req, true); // requireAdmin = true
  
  if (auth.error) {
    if (auth.error === 'Admin access required') {
      return forbiddenResponse(auth.error);
    }
    return unauthorizedResponse(auth.error);
  }
  // ====================================================

  try {
    const { competencyId, competencyTitle, competencyDescription, learningFieldTitle, count = 3, difficulty = 'medium' } = await req.json();

    console.log(`[User: ${auth.user?.id}] Generating ${count} ${difficulty} questions for: ${competencyTitle}`);

    const userPrompt = `Erstelle ${count} ${difficulty === 'easy' ? 'leichte' : difficulty === 'medium' ? 'mittelschwere' : 'schwere'} Prüfungsfragen.

Lernfeld: ${learningFieldTitle}
Kompetenz: ${competencyTitle}
${competencyDescription ? `Beschreibung: ${competencyDescription}` : ''}

Die Fragen sollen das Niveau "${difficulty}" haben und prüfungsrelevant sein.`;

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

    // Parse JSON from response
    let questions;
    try {
      const cleanContent = result.content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      questions = JSON.parse(cleanContent);
    } catch (parseError) {
      console.error('JSON parse error:', parseError);
      throw new Error('Failed to parse AI response as JSON');
    }

    // Validate and format questions
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

    console.log(`Successfully generated ${formattedQuestions.length} questions`);

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
