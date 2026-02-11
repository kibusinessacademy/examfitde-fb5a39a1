import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";
import { validateAuth, unauthorizedResponse, forbiddenResponse } from "../_shared/auth.ts";

const LESSON_STEPS = ['einstieg', 'verstehen', 'anwenden', 'wiederholen', 'mini_check'] as const;

serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req);
  if (corsResponse) return corsResponse;
  const origin = req.headers.get('origin');
  const corsHeaders = getCorsHeaders(origin);

  const auth = await validateAuth(req, true);
  if (auth.error) {
    return auth.error === 'Admin access required'
      ? forbiddenResponse(auth.error)
      : unauthorizedResponse(auth.error);
  }

  try {
    const { courseId, curriculumId } = await req.json();
    if (!courseId || !curriculumId) {
      return new Response(JSON.stringify({ error: 'courseId and curriculumId are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    console.log(`[User: ${auth.user?.id}] Scaffolding course: ${courseId}`);

    // Load curriculum metadata
    const { data: course } = await supabase.from('courses').select('title').eq('id', courseId).single();
    const { data: curriculum } = await supabase.from('curricula').select('title, beruf_id').eq('id', curriculumId).single();
    let berufTitle = curriculum?.title || course?.title || 'Beruf';
    if (curriculum?.beruf_id) {
      const { data: beruf } = await supabase.from('berufe').select('bezeichnung_kurz').eq('id', curriculum.beruf_id).single();
      if (beruf) berufTitle = beruf.bezeichnung_kurz;
    }

    await supabase.from('courses').update({ status: 'generating', publishing_status: 'draft' }).eq('id', courseId);

    const { data: learningFields, error: lfError } = await supabase
      .from('learning_fields')
      .select('*, competencies (*)')
      .eq('curriculum_id', curriculumId)
      .order('sort_order');
    if (lfError) throw lfError;
    if (!learningFields?.length) throw new Error('No learning fields found');

    let totalDuration = 0;
    let lessonsCreated = 0;

    // Create modules + placeholder lessons (NO AI calls – fast)
    for (let lfIdx = 0; lfIdx < learningFields.length; lfIdx++) {
      const lf = learningFields[lfIdx];
      console.log(`[${lfIdx + 1}/${learningFields.length}] Scaffolding ${lf.code}`);

      const { data: module, error: moduleError } = await supabase
        .from('modules')
        .insert({
          course_id: courseId,
          learning_field_id: lf.id,
          title: `${lf.code}: ${lf.title}`,
          description: lf.description,
          sort_order: lfIdx,
        })
        .select().single();
      if (moduleError) throw moduleError;

      const competencies = lf.competencies || [];
      let lessonSortOrder = 0;

      // Batch insert all lessons for this module
      const lessonRows = [];
      for (const comp of competencies) {
        for (const step of LESSON_STEPS) {
          const stepDuration = step === 'mini_check' ? 5 : 10;
          totalDuration += stepDuration;

          lessonRows.push({
            module_id: module.id,
            competency_id: comp.id,
            title: `${comp.code}: ${comp.title}`,
            step,
            content: {
              type: step === 'mini_check' ? 'mini_check' : 'text',
              html: `<h3>${comp.title} – ${step}</h3><p>⏳ Inhalt wird generiert...</p>`,
              objectives: [`Verständnis von ${comp.title}`],
              _placeholder: true,
              _beruf: berufTitle,
            },
            duration_minutes: stepDuration,
            sort_order: lessonSortOrder++,
            weight_tag: step === 'mini_check' ? 'high' : step === 'anwenden' ? 'high' : step === 'verstehen' ? 'medium' : 'low',
            exam_relevance_score: 30,
            mastery_weight: step === 'mini_check' ? 1.0 : 0,
            minicheck_parsed: false,
          });
        }
      }

      if (lessonRows.length > 0) {
        const { error: insertError } = await supabase.from('lessons').insert(lessonRows);
        if (insertError) throw insertError;
        lessonsCreated += lessonRows.length;
      }
    }

    await supabase.from('courses').update({
      estimated_duration: Math.ceil(totalDuration / 60),
      status: 'draft',
    }).eq('id', courseId);

    console.log(`Scaffolding done: ${lessonsCreated} placeholder lessons created.`);
    console.log(`Next: Call generate-course-batch to fill content.`);

    return new Response(JSON.stringify({
      success: true,
      courseId,
      modulesCreated: learningFields.length,
      lessonsCreated,
      totalDuration,
      nextStep: 'Call POST /generate-course-batch with {"courseId": "...", "limit": 10} to fill content with AI.',
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) {
    console.error('Generate course error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
