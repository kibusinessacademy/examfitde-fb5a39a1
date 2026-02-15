import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { validateAuth, unauthorizedResponse, forbiddenResponse } from "../_shared/auth.ts";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";
import { callAIJSON, aiErrorResponse } from "../_shared/ai-client.ts";
import { resolveProfession } from "../_shared/profession-resolver.ts";
import { assertNoContamination } from "../_shared/contamination-guard.ts";

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

    // Load profession from SSOT — HARD GUARD
    if (!curriculumId) throw new Error("MISSING_CURRICULUM_ID: Cannot generate questions without curriculum context");
    
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const professionResult = await resolveProfession(supabase, { curriculumId });
    const professionName = professionResult.professionName;

    console.log(`[User: ${auth.user?.id}] Generating ${count} ${difficulty} questions for "${professionName}": ${competencyTitle}`);

    const systemPrompt = `Du bist ein erfahrener IHK-Prüfungsexperte für ${professionName}. Du erstellst Prüfungsfragen, die sich anfühlen, als kämen sie direkt aus einer echten IHK-Abschlussprüfung für ${professionName}.

REGELN:
- Jede Frage hat genau 4 Antwortmöglichkeiten
- Nur eine Antwort ist korrekt
- Fragen müssen einen konkreten Praxisbezug zum Berufsalltag von ${professionName} haben
- Distraktoren bilden typische Denkfehler von ${professionName} ab — NICHT offensichtlich falsch
- Schwierigkeit: easy (Grundwissen), medium (Anwendung/Berechnung), hard (Analyse/Transfer)
- Ausführliche Erklärung mit Fachbegriffen von ${professionName}
- KEINE generischen Fragen ohne Berufsbezug
- Fragen dürfen NICHT nach KI klingen — formuliere wie ein erfahrener IHK-Aufgabenersteller

ANTI-KI-REGELN:
- KEINE Sätze wie "In der heutigen Geschäftswelt..." oder "Es ist wichtig zu beachten..."
- KEINE generischen Szenarien wie "ein Unternehmen" — verwende konkrete Namen, Zahlen, Abteilungen
- JEDE Erklärung MUSS den konkreten Denkfehler hinter JEDEM falschen Distraktor benennen
- Distraktoren-Check: Erkläre in "explanation" warum JEDE falsche Option falsch ist (nicht nur die richtige)

Antworte AUSSCHLIESSLICH mit einem validen JSON-Array:
[
  {
    "question_text": "Konkretes Szenario aus dem Alltag von ${professionName}...",
    "options": ["Option A", "Option B", "Option C", "Option D"],
    "correct_answer": 0,
    "explanation": "Fachliche Erklärung: Richtig ist A weil... B ist falsch weil... C ist falsch weil... D ist falsch weil...",
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

    const formattedQuestions = questions.map((q: any, idx: number) => {
      // Contamination guard on each question
      assertNoContamination(q.question_text + " " + (q.explanation || ""), professionName, `question ${idx}`);
      return {
        question_text: q.question_text,
        options: q.options,
        correct_answer: q.correct_answer,
        explanation: q.explanation,
        difficulty: q.difficulty || difficulty,
        competency_id: competencyId,
        ai_generated: true,
        status: 'draft',
      };
    });

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