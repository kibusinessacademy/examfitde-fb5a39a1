import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

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
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { competencyId, competencyTitle, competencyDescription, learningFieldTitle, count = 3, difficulty = 'medium' } = await req.json();

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      throw new Error('LOVABLE_API_KEY is not configured');
    }

    console.log(`Generating ${count} ${difficulty} questions for: ${competencyTitle}`);

    const userPrompt = `Erstelle ${count} ${difficulty === 'easy' ? 'leichte' : difficulty === 'medium' ? 'mittelschwere' : 'schwere'} Prüfungsfragen.

Lernfeld: ${learningFieldTitle}
Kompetenz: ${competencyTitle}
${competencyDescription ? `Beschreibung: ${competencyDescription}` : ''}

Die Fragen sollen das Niveau "${difficulty}" haben und prüfungsrelevant sein.`;

    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-3-flash-preview',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.7,
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: 'Rate limit exceeded. Please try again later.' }),
          { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: 'Payment required. Please add credits.' }),
          { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      throw new Error(`AI Gateway error: ${response.status}`);
    }

    const aiResponse = await response.json();
    const content = aiResponse.choices?.[0]?.message?.content;

    if (!content) {
      throw new Error('No content in AI response');
    }

    // Parse JSON from response
    let questions;
    try {
      const cleanContent = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
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
