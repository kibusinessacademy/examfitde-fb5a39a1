import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import { corsHeaders, getCorsHeaders } from "../_shared/cors.ts";

const LESSON_STEPS = ['einstieg', 'verstehen', 'anwenden', 'wiederholen', 'mini_check'] as const;

const stepPrompts: Record<string, string> = {
  einstieg: 'Erstelle eine aktivierende Einstiegsaktivität, die das Vorwissen der Lernenden anspricht und Neugier für das Thema weckt.',
  verstehen: 'Erstelle Lernmaterial zum Verstehen der Konzepte mit klaren Erklärungen, Beispielen und visuellen Darstellungen.',
  anwenden: 'Erstelle praktische Übungen und Aufgaben, bei denen das Gelernte angewendet wird.',
  wiederholen: 'Erstelle Wiederholungsaktivitäten zur Festigung des Gelernten (Zusammenfassung, Karteikarten, etc.).',
  mini_check: 'Erstelle ein kurzes Quiz mit 3-5 Fragen zur Selbstüberprüfung des Wissens.',
};

// Process ONE learning field at a time to avoid timeout
serve(async (req) => {
  const origin = req.headers.get('origin');
  
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: getCorsHeaders(origin) });
  }

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

        const stepDuration = step === 'mini_check' ? 5 : 10;

        // Generate AI content
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
                const cleanContent = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
                lessonContent = JSON.parse(cleanContent);
              } catch {
                console.error('Failed to parse AI content');
              }
            }
          }
        } catch (aiError) {
          console.error('AI error:', aiError);
        }

        // Fallback if AI fails
        if (!lessonContent) {
          lessonContent = {
            type: 'text',
            html: `<h3>${comp.title} - ${step}</h3><p>Inhalt wird generiert...</p>`,
            objectives: [`Verständnis von ${comp.title}`]
          };
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

    console.log(`[Batch] Created ${lessonsCreated} lessons for LF ${lf.code}`);

    return new Response(
      JSON.stringify({
        success: true,
        complete: false,
        currentIndex: learningFieldIndex,
        totalLearningFields: learningFields.length,
        nextIndex: learningFieldIndex + 1,
        learningFieldCode: lf.code,
        lessonsCreated,
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
