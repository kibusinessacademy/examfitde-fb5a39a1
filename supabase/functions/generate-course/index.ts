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
  const jsonHeaders = { ...corsHeaders, 'Content-Type': 'application/json' };

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
        { status: 400, headers: jsonHeaders });
    }

    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    // ── LAYER 3: Generation Lock ──────────────────────────────────────
    const { error: lockError } = await supabase
      .from('course_generation_locks')
      .insert({ course_id: courseId, locked_by: auth.user?.id || 'system' });

    if (lockError) {
      // Lock already exists → another run is in progress
      if (lockError.code === '23505') { // unique_violation
        console.warn(`[Lock] Course ${courseId} is already being generated. Aborting.`);
        return new Response(JSON.stringify({
          error: 'Course generation already in progress',
          code: 'GENERATION_LOCKED',
        }), { status: 409, headers: jsonHeaders });
      }
      throw lockError;
    }

    console.log(`[User: ${auth.user?.id}] Scaffolding course: ${courseId} (lock acquired)`);

    try {
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
      let lessonsSkipped = 0;

      for (let lfIdx = 0; lfIdx < learningFields.length; lfIdx++) {
        const lf = learningFields[lfIdx];
        console.log(`[${lfIdx + 1}/${learningFields.length}] Scaffolding ${lf.code}`);

        // ── LAYER 2: Idempotent module creation ───────────────────────
        const { data: existingModule } = await supabase
          .from('modules')
          .select('id')
          .eq('course_id', courseId)
          .eq('learning_field_id', lf.id)
          .maybeSingle();

        let moduleId: string;
        if (existingModule) {
          moduleId = existingModule.id;
          console.log(`  Module exists: ${moduleId}`);
        } else {
          const { data: module, error: moduleError } = await supabase
            .from('modules')
            .insert({
              course_id: courseId,
              learning_field_id: lf.id,
              title: `${lf.code}: ${lf.title}`,
              description: lf.description,
              sort_order: lfIdx,
            })
            .select('id').single();
          if (moduleError) {
            // Handle race condition: unique constraint violation
            if (moduleError.code === '23505') {
              const { data: raceModule } = await supabase
                .from('modules')
                .select('id')
                .eq('course_id', courseId)
                .eq('learning_field_id', lf.id)
                .single();
              moduleId = raceModule!.id;
            } else {
              throw moduleError;
            }
          } else {
            moduleId = module.id;
          }
        }

        const competencies = lf.competencies || [];
        let lessonSortOrder = 0;

        // ── LAYER 2: Idempotent lesson creation ─────────────────────
        const lessonRows = [];
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
              lessonsSkipped++;
              lessonSortOrder++;
              continue; // Skip — already scaffolded
            }

            const stepDuration = step === 'mini_check' ? 5 : 10;
            totalDuration += stepDuration;

            lessonRows.push({
              module_id: moduleId,
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
          if (insertError) {
            // On unique constraint violation, skip gracefully
            if (insertError.code === '23505') {
              console.warn(`  Partial duplicate detected in batch insert, falling back to individual inserts`);
              for (const row of lessonRows) {
                await supabase.from('lessons').insert(row).catch(() => {});
              }
            } else {
              throw insertError;
            }
          }
          lessonsCreated += lessonRows.length;
        }
      }

      await supabase.from('courses').update({
        estimated_duration: Math.ceil(totalDuration / 60),
        status: 'draft',
      }).eq('id', courseId);

      // ── LAYER 4: Post-generation validation ───────────────────────
      const validationResult = await supabase.rpc('validate_course_integrity', { p_course_id: courseId });
      const integrity = validationResult.data;
      console.log(`[Integrity] Passed: ${integrity?.passed}, Issues: ${JSON.stringify(integrity?.issues)}`);

      // Release lock
      await supabase.from('course_generation_locks').delete().eq('course_id', courseId);

      console.log(`Scaffolding done: ${lessonsCreated} created, ${lessonsSkipped} skipped (idempotent).`);

      return new Response(JSON.stringify({
        success: true,
        courseId,
        modulesCreated: learningFields.length,
        lessonsCreated,
        lessonsSkipped,
        totalDuration,
        integrity,
        nextStep: 'Call POST /generate-course-batch with {"courseId": "...", "limit": 10} to fill content with AI.',
      }), { headers: jsonHeaders });

    } catch (innerError) {
      // Release lock on failure
      await supabase.from('course_generation_locks').delete().eq('course_id', courseId);
      throw innerError;
    }

  } catch (error) {
    console.error('Generate course error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
