import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";
import { validateAuth, unauthorizedResponse, forbiddenResponse } from "../_shared/auth.ts";

const LESSON_STEPS = ['einstieg', 'verstehen', 'anwenden', 'wiederholen', 'mini_check'] as const;

const stepPrompts: Record<string, string> = {
  einstieg: 'Erstelle eine aktivierende Einstiegsaktivität, die das Vorwissen der Lernenden anspricht und Neugier für das Thema weckt.',
  verstehen: 'Erstelle Lernmaterial zum Verstehen der Konzepte mit klaren Erklärungen, Beispielen und visuellen Darstellungen.',
  anwenden: 'Erstelle praktische Übungen und Aufgaben, bei denen das Gelernte angewendet wird.',
  wiederholen: 'Erstelle Wiederholungsaktivitäten zur Festigung des Gelernten (Zusammenfassung, Karteikarten, etc.).',
  mini_check: 'Erstelle ein kurzes Quiz mit 3-5 Fragen zur Selbstüberprüfung des Wissens.',
};

serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req);
  if (corsResponse) return corsResponse;

  const origin = req.headers.get('origin');
  const corsHeaders = getCorsHeaders(origin);

  // ==================== AUTH CHECK ====================
  // Require admin role for course generation
  const auth = await validateAuth(req, true); // requireAdmin = true
  
  if (auth.error) {
    if (auth.error === 'Admin access required') {
      return forbiddenResponse(auth.error);
    }
    return unauthorizedResponse(auth.error);
  }
  // ====================================================

  try {
    const { courseId, curriculumId, title, description } = await req.json();

    if (!courseId || !curriculumId) {
      return new Response(
        JSON.stringify({ error: 'courseId and curriculumId are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');

    if (!LOVABLE_API_KEY) {
      throw new Error('LOVABLE_API_KEY is not configured');
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    console.log(`[User: ${auth.user?.id}] Starting course generation for course: ${courseId}`);

    // Update course status to generating
    await supabase
      .from('courses')
      .update({ status: 'generating' })
      .eq('id', courseId);

    // Fetch learning fields and competencies for this curriculum
    const { data: learningFields, error: lfError } = await supabase
      .from('learning_fields')
      .select(`
        *,
        competencies (*)
      `)
      .eq('curriculum_id', curriculumId)
      .order('sort_order');

    if (lfError) throw lfError;

    if (!learningFields || learningFields.length === 0) {
      throw new Error('No learning fields found for this curriculum');
    }

    console.log(`Found ${learningFields.length} learning fields`);

    let totalDuration = 0;

    // Create modules and lessons for each learning field
    for (let lfIdx = 0; lfIdx < learningFields.length; lfIdx++) {
      const lf = learningFields[lfIdx];
      
      console.log(`Processing learning field: ${lf.code} - ${lf.title}`);

      // Create module for this learning field
      const { data: module, error: moduleError } = await supabase
        .from('modules')
        .insert({
          course_id: courseId,
          learning_field_id: lf.id,
          title: `${lf.code}: ${lf.title}`,
          description: lf.description,
          sort_order: lfIdx,
        })
        .select()
        .single();

      if (moduleError) throw moduleError;

      // Create lessons for each competency
      const competencies = lf.competencies || [];
      let lessonSortOrder = 0;

      for (const comp of competencies) {
        // Create 5 lessons (one for each step) for each competency
        for (const step of LESSON_STEPS) {
          const stepDuration = step === 'mini_check' ? 5 : 10;
          totalDuration += stepDuration;

          // Generate lesson content with AI
          let lessonContent = null;
          
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
                    content: `Du bist ein Experte für die Erstellung von Lerninhalten. 
                    Erstelle strukturierte Lerninhalte im JSON-Format.
                    Die Inhalte sollen für die berufliche Ausbildung geeignet sein.
                    Antworte AUSSCHLIESSLICH mit einem JSON-Objekt.`
                  },
                  {
                    role: 'user',
                    content: `Erstelle Lerninhalt für:
                    
Kompetenz: ${comp.title}
Beschreibung: ${comp.description || 'Keine Beschreibung'}
Taxonomiestufe: ${comp.taxonomy_level || 'Anwenden'}

Lernschritt: ${step}
Aufgabe: ${stepPrompts[step]}

Antworte mit einem JSON-Objekt im Format:
{
  "type": "text",
  "html": "<h3>Überschrift</h3><p>Inhalt...</p>",
  "objectives": ["Lernziel 1", "Lernziel 2"]
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
                try {
                  const cleanContent = content
                    .replace(/```json\n?/g, '')
                    .replace(/```\n?/g, '')
                    .trim();
                  lessonContent = JSON.parse(cleanContent);
                } catch {
                  console.error('Failed to parse AI content for lesson');
                }
              }
            }
          } catch (aiError) {
            console.error('AI generation error:', aiError);
          }

          // Fallback content if AI fails
          if (!lessonContent) {
            lessonContent = {
              type: 'text',
              html: `<h3>${comp.title} - ${step}</h3><p>Inhalt wird generiert...</p>`,
              objectives: [`Verständnis von ${comp.title}`]
            };
          }

          // Insert lesson
          await supabase.from('lessons').insert({
            module_id: module.id,
            competency_id: comp.id,
            title: `${comp.code}: ${comp.title}`,
            step: step,
            content: lessonContent,
            duration_minutes: stepDuration,
            sort_order: lessonSortOrder++,
          });
        }
      }
    }

    // Update course with total duration and status
    await supabase
      .from('courses')
      .update({
        estimated_duration: Math.ceil(totalDuration / 60), // Convert to hours
        status: 'draft', // Back to draft for review before publishing
      })
      .eq('id', courseId);

    console.log(`Course generation complete. Total duration: ${totalDuration} minutes`);

    return new Response(
      JSON.stringify({
        success: true,
        courseId,
        modulesCreated: learningFields.length,
        totalDuration,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Generate course error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});