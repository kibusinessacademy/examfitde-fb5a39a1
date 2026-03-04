import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req);
  if (corsResponse) return corsResponse;
  const origin = req.headers.get('origin');
  const headers = { ...getCorsHeaders(origin), 'Content-Type': 'application/json' };

  try {
    const { courseId, action } = await req.json();
    if (!courseId) return new Response(JSON.stringify({ error: 'Missing courseId' }), { status: 400, headers });

    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    if (action === 'cleanup') {
      // Get module IDs
      const { data: modules } = await supabase.from('modules').select('id').eq('course_id', courseId);
      const moduleIds = (modules || []).map((m: any) => m.id);

      if (moduleIds.length > 0) {
        // Get lesson IDs
        const { data: lessons } = await supabase.from('lessons').select('id').in('module_id', moduleIds);
        const lessonIds = (lessons || []).map((l: any) => l.id);

        // Delete minicheck questions
        if (lessonIds.length > 0) {
          await supabase.from('minicheck_questions').delete().in('lesson_id', lessonIds);
        }

        // Delete lessons
        await supabase.from('lessons').delete().in('module_id', moduleIds);

        // Delete quality results
        await supabase.from('quality_gate_results').delete().eq('course_id', courseId);
        await supabase.from('course_health_snapshots').delete().eq('course_id', courseId);

        // Delete modules
        await supabase.from('modules').delete().eq('course_id', courseId);
      }

      // Reset course
      await supabase.from('courses').update({
        status: 'draft', quality_score: 0, quality_report: null,
        publishing_status: 'draft', estimated_duration: null,
      }).eq('id', courseId);

      // Verify
      const { count } = await supabase.from('modules').select('id', { count: 'exact', head: true }).eq('course_id', courseId);

      return new Response(JSON.stringify({ success: true, action: 'cleanup', modulesRemaining: count }), { headers });
    }

    if (action === 'scaffold') {
      // Get course curriculum
      const { data: course } = await supabase.from('courses').select('curriculum_id').eq('id', courseId).single();
      if (!course?.curriculum_id) return new Response(JSON.stringify({ error: 'No curriculum' }), { status: 400, headers });

      const curriculumId = course.curriculum_id;

      // Create modules
      const { data: lfs } = await supabase.from('learning_fields')
        .select('id, code, title, description, sort_order')
        .eq('curriculum_id', curriculumId).order('sort_order');

      for (const lf of (lfs || [])) {
        const { data: mod } = await supabase.from('modules').insert({
          course_id: courseId,
          learning_field_id: lf.id,
          title: `${lf.code}: ${lf.title}`,
          description: lf.description,
          sort_order: lf.sort_order,
        }).select('id').single();

        if (!mod) continue;

        // Get competencies
        const { data: comps } = await supabase.from('competencies')
          .select('id, code, title, description, taxonomy_level, sort_order')
          .eq('learning_field_id', lf.id).order('sort_order');

        const steps = ['einstieg', 'verstehen', 'anwenden', 'wiederholen', 'mini_check'] as const;
        const rows = [];

        for (const comp of (comps || [])) {
          for (let si = 0; si < steps.length; si++) {
            const step = steps[si];
            rows.push({
              module_id: mod.id,
              competency_id: comp.id,
              title: `${comp.code}: ${comp.title}`,
              step,
              content: {
                type: step === 'mini_check' ? 'mini_check' : 'text',
                html: `<h3>${comp.title} – ${step}</h3><p>⏳ Inhalt wird generiert...</p>`,
                objectives: [`Verständnis von ${comp.title}`],
                _placeholder: true,
              },
              duration_minutes: step === 'mini_check' ? 5 : 10,
              sort_order: (comp.sort_order || 0) * 5 + si,
              weight_tag: ['mini_check', 'anwenden'].includes(step) ? 'high' : step === 'verstehen' ? 'medium' : 'low',
              exam_relevance_score: 30,
              mastery_weight: step === 'mini_check' ? 1.0 : 0,
              minicheck_parsed: false,
            });
          }
        }

        if (rows.length > 0) {
          await supabase.from('lessons').insert(rows);
        }
      }

      // Count results
      const { count: modCount } = await supabase.from('modules').select('id', { count: 'exact', head: true }).eq('course_id', courseId);
      const { data: mods } = await supabase.from('modules').select('id').eq('course_id', courseId);
      const mIds = (mods || []).map((m: any) => m.id);
      let lessonCount = 0;
      if (mIds.length > 0) {
        const { count } = await supabase.from('lessons').select('id', { count: 'exact', head: true }).in('module_id', mIds);
        lessonCount = count || 0;
      }

      await supabase.from('courses').update({ status: 'draft' }).eq('id', courseId);

      return new Response(JSON.stringify({ success: true, action: 'scaffold', modules: modCount, lessons: lessonCount }), { headers });
    }

    return new Response(JSON.stringify({ error: 'Unknown action. Use "cleanup" or "scaffold"' }), { status: 400, headers });
  } catch (err: unknown) {
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), { status: 500, headers });
  }
});
