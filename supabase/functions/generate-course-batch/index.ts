import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";

const LESSON_STEPS = ['einstieg', 'verstehen', 'anwenden', 'wiederholen', 'mini_check'] as const;

interface MiniCheckQuestion {
  question: string;
  options: string[];
  correct_answer: number;
  explanation: string;
}

// Separate prompts for regular content vs. mini_check
const stepPrompts: Record<string, string> = {
  einstieg: 'Erstelle eine aktivierende Einstiegsaktivität, die das Vorwissen der Lernenden anspricht und Neugier für das Thema weckt.',
  verstehen: 'Erstelle Lernmaterial zum Verstehen der Konzepte mit klaren Erklärungen, Beispielen und visuellen Darstellungen.',
  anwenden: 'Erstelle praktische Übungen und Aufgaben, bei denen das Gelernte angewendet wird.',
  wiederholen: 'Erstelle Wiederholungsaktivitäten zur Festigung des Gelernten (Zusammenfassung, Karteikarten, etc.).',
  mini_check: 'Erstelle strukturierte Prüfungsfragen zur Selbstüberprüfung.',
};

// Tool definition for MiniCheck structured output
const miniCheckTool = {
  type: "function" as const,
  function: {
    name: "create_mini_check",
    description: "Erstelle 4 Multiple-Choice-Fragen zur Wissensüberprüfung mit je 4 Antwortoptionen.",
    parameters: {
      type: "object",
      properties: {
        questions: {
          type: "array",
          items: {
            type: "object",
            properties: {
              question: { type: "string", description: "Die Frage" },
              options: { 
                type: "array", 
                items: { type: "string" },
                description: "Genau 4 Antwortoptionen"
              },
              correct_answer: { 
                type: "number", 
                description: "Index der korrekten Antwort (0-3)" 
              },
              explanation: { 
                type: "string", 
                description: "Erklärung warum die Antwort korrekt ist" 
              }
            },
            required: ["question", "options", "correct_answer", "explanation"],
            additionalProperties: false
          },
          minItems: 4,
          maxItems: 5
        },
        objectives: {
          type: "array",
          items: { type: "string" },
          description: "Lernziele die mit diesem Quiz überprüft werden"
        }
      },
      required: ["questions", "objectives"],
      additionalProperties: false
    }
  }
};

// Generate content for regular steps (text/html)
async function generateRegularContent(
  LOVABLE_API_KEY: string,
  comp: { title: string; description?: string; taxonomy_level?: string },
  step: string
): Promise<{ type: string; html: string; objectives: string[] } | null> {
  try {
    const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-3-flash-preview',
        messages: [
          {
            role: 'system',
            content: `Du bist ein Experte für die Erstellung von Lerninhalten für die berufliche Ausbildung. 
Erstelle strukturierte, praxisnahe Lerninhalte im JSON-Format.
Antworte AUSSCHLIESSLICH mit einem validen JSON-Objekt, keine Markdown-Codeblöcke.`
          },
          {
            role: 'user',
            content: `Erstelle Lerninhalt für:

Kompetenz: ${comp.title}
Beschreibung: ${comp.description || 'Keine Beschreibung'}
Taxonomiestufe: ${comp.taxonomy_level || 'Anwenden'}

Lernschritt: ${step}
Aufgabe: ${stepPrompts[step]}

Format (JSON):
{
  "type": "text",
  "html": "<h3>Titel</h3><p>Ausführlicher Inhalt mit mindestens 500 Zeichen...</p>",
  "objectives": ["Lernziel 1", "Lernziel 2", "Lernziel 3"]
}`
          }
        ],
        temperature: 0.7,
      }),
    });

    if (aiResponse.ok) {
      const result = await aiResponse.json();
      const content = result.choices?.[0]?.message?.content;
      if (content) {
        const cleanContent = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        return JSON.parse(cleanContent);
      }
    }
  } catch (error) {
    console.error(`[AI] Regular content error for ${step}:`, error);
  }
  return null;
}

// Generate MiniCheck with structured questions using tool calling
async function generateMiniCheck(
  LOVABLE_API_KEY: string,
  comp: { title: string; description?: string; taxonomy_level?: string }
): Promise<{ type: string; html: string; objectives: string[]; questions: MiniCheckQuestion[] } | null> {
  try {
    const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-3-flash-preview',
        messages: [
          {
            role: 'system',
            content: `Du bist ein IHK-Prüfungsexperte für die berufliche Ausbildung.
Erstelle realistische Multiple-Choice-Fragen auf IHK-Prüfungsniveau.
Jede Frage muss:
- Praxisbezogen und berufsspezifisch sein
- Genau 4 plausible Antwortoptionen haben
- Einen klaren Bezug zur Kompetenz haben
- Distraktoren enthalten, die typische Fehler abbilden`
          },
          {
            role: 'user',
            content: `Erstelle 4 Multiple-Choice-Fragen zur Selbstüberprüfung für:

Kompetenz: ${comp.title}
Beschreibung: ${comp.description || 'Keine Beschreibung'}
Taxonomiestufe: ${comp.taxonomy_level || 'Anwenden'}

Die Fragen sollen das Verständnis der Kompetenz auf IHK-Niveau prüfen.`
          }
        ],
        tools: [miniCheckTool],
        tool_choice: { type: "function", function: { name: "create_mini_check" } },
        temperature: 0.7,
      }),
    });

    if (aiResponse.ok) {
      const result = await aiResponse.json();
      const toolCall = result.choices?.[0]?.message?.tool_calls?.[0];
      
      if (toolCall?.function?.arguments) {
        const parsed = JSON.parse(toolCall.function.arguments);
        
        // Validate structure
        if (Array.isArray(parsed.questions) && parsed.questions.length >= 3) {
          // Validate each question
          const validQuestions = parsed.questions.filter((q: MiniCheckQuestion) => 
            q.question && 
            Array.isArray(q.options) && 
            q.options.length === 4 &&
            typeof q.correct_answer === 'number' &&
            q.correct_answer >= 0 && 
            q.correct_answer <= 3 &&
            q.explanation
          );

          if (validQuestions.length >= 3) {
            // Build HTML summary for display
            const questionsHtml = validQuestions.map((q: MiniCheckQuestion, i: number) => 
              `<div class="question-preview"><strong>Frage ${i + 1}:</strong> ${q.question}</div>`
            ).join('');

            return {
              type: 'mini_check',
              html: `<h3>Wissensüberprüfung: ${comp.title}</h3>
<p>Teste dein Wissen mit ${validQuestions.length} Multiple-Choice-Fragen.</p>
${questionsHtml}`,
              objectives: parsed.objectives || [`Wissen zu ${comp.title} überprüfen`],
              questions: validQuestions
            };
          }
        }
      }
    } else {
      const errorText = await aiResponse.text();
      console.error(`[AI] MiniCheck API error:`, aiResponse.status, errorText);
    }
  } catch (error) {
    console.error(`[AI] MiniCheck generation error:`, error);
  }
  return null;
}

// Process ONE learning field at a time to avoid timeout
serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req);
  if (corsResponse) return corsResponse;

  const origin = req.headers.get('origin');
  const corsHeaders = getCorsHeaders(origin);

  try {
    const { courseId, curriculumId, learningFieldIndex = 0 } = await req.json();

    if (!courseId || !curriculumId) {
      return new Response(
        JSON.stringify({ error: 'courseId and curriculumId are required' }),
        { status: 400, headers: { ...getCorsHeaders(origin), 'Content-Type': 'application/json' } }
      );
    }

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');

    if (!LOVABLE_API_KEY) {
      throw new Error('LOVABLE_API_KEY is not configured');
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    console.log(`[Batch] Starting batch generation for course: ${courseId}, LF index: ${learningFieldIndex}`);

    // Update course status
    await supabase
      .from('courses')
      .update({ status: 'generating' })
      .eq('id', courseId);

    // Fetch ALL learning fields
    const { data: learningFields, error: lfError } = await supabase
      .from('learning_fields')
      .select(`*, competencies (*)`)
      .eq('curriculum_id', curriculumId)
      .order('sort_order');

    if (lfError) throw lfError;

    if (!learningFields || learningFields.length === 0) {
      throw new Error('No learning fields found');
    }

    // Check if we're done
    if (learningFieldIndex >= learningFields.length) {
      // All done - update course status
      const { data: stats } = await supabase
        .from('lessons')
        .select('duration_minutes, module_id!inner(course_id)')
        .eq('module_id.course_id', courseId);
      
      const totalDuration = stats?.reduce((sum, l) => sum + (l.duration_minutes || 0), 0) || 0;
      
      await supabase
        .from('courses')
        .update({
          estimated_duration: Math.ceil(totalDuration / 60),
          status: 'draft',
        })
        .eq('id', courseId);

      return new Response(
        JSON.stringify({ 
          success: true, 
          complete: true, 
          message: 'Course generation complete',
          totalLearningFields: learningFields.length,
          totalDuration 
        }),
        { headers: { ...getCorsHeaders(origin), 'Content-Type': 'application/json' } }
      );
    }

    const lf = learningFields[learningFieldIndex];
    console.log(`[Batch] Processing LF ${learningFieldIndex + 1}/${learningFields.length}: ${lf.code} - ${lf.title}`);

    // Check if module already exists
    const { data: existingModule } = await supabase
      .from('modules')
      .select('id')
      .eq('course_id', courseId)
      .eq('learning_field_id', lf.id)
      .maybeSingle();

    let moduleId = existingModule?.id;

    if (!moduleId) {
      // Create module
      const { data: module, error: moduleError } = await supabase
        .from('modules')
        .insert({
          course_id: courseId,
          learning_field_id: lf.id,
          title: `${lf.code}: ${lf.title}`,
          description: lf.description,
          sort_order: learningFieldIndex,
        })
        .select()
        .single();

      if (moduleError) throw moduleError;
      moduleId = module.id;
    }

    // Create lessons for each competency
    const competencies = lf.competencies || [];
    let lessonsCreated = 0;
    let miniChecksWithQuestions = 0;
    let lessonSortOrder = 0;

    for (const comp of competencies) {
      for (const step of LESSON_STEPS) {
        // Check if lesson already exists
        const { data: existingLesson } = await supabase
          .from('lessons')
          .select('id')
          .eq('module_id', moduleId)
          .eq('competency_id', comp.id)
          .eq('step', step)
          .maybeSingle();

        if (existingLesson) {
          lessonSortOrder++;
          continue;
        }

        const stepDuration = step === 'mini_check' ? 10 : (step === 'verstehen' ? 25 : step === 'anwenden' ? 30 : step === 'wiederholen' ? 15 : 10);

        let lessonContent: Record<string, unknown> | null = null;

        // Use different generation methods for mini_check vs regular steps
        if (step === 'mini_check') {
          lessonContent = await generateMiniCheck(LOVABLE_API_KEY, comp);
          if (lessonContent?.questions) {
            miniChecksWithQuestions++;
          }
        } else {
          lessonContent = await generateRegularContent(LOVABLE_API_KEY, comp, step);
        }

        // Fallback if AI fails
        if (!lessonContent) {
          if (step === 'mini_check') {
            lessonContent = {
              type: 'mini_check',
              html: `<h3>Wissensüberprüfung: ${comp.title}</h3><p>Fragen werden generiert...</p>`,
              objectives: [`Wissen zu ${comp.title} überprüfen`],
              questions: [
                {
                  question: `Was ist ein wesentlicher Aspekt von "${comp.title}"?`,
                  options: ['Option A', 'Option B', 'Option C', 'Option D'],
                  correct_answer: 0,
                  explanation: 'Diese Frage wird noch generiert.'
                }
              ]
            };
          } else {
            lessonContent = {
              type: 'text',
              html: `<h3>${comp.title} - ${step}</h3><p>Inhalt wird generiert...</p>`,
              objectives: [`Verständnis von ${comp.title}`]
            };
          }
        }

        await supabase.from('lessons').insert({
          module_id: moduleId,
          competency_id: comp.id,
          title: `${comp.code}: ${comp.title}`,
          step: step,
          content: lessonContent,
          duration_minutes: stepDuration,
          sort_order: lessonSortOrder++,
        });

        lessonsCreated++;
      }
    }

    console.log(`[Batch] Created ${lessonsCreated} lessons (${miniChecksWithQuestions} MiniChecks with questions) for LF ${lf.code}`);

    return new Response(
      JSON.stringify({
        success: true,
        complete: false,
        currentIndex: learningFieldIndex,
        totalLearningFields: learningFields.length,
        nextIndex: learningFieldIndex + 1,
        learningFieldCode: lf.code,
        lessonsCreated,
        miniChecksWithQuestions,
        message: `Processed LF ${learningFieldIndex + 1}/${learningFields.length}: ${lf.code}`
      }),
      { headers: { ...getCorsHeaders(origin), 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Batch generation error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...getCorsHeaders(origin), 'Content-Type': 'application/json' } }
    );
  }
});
