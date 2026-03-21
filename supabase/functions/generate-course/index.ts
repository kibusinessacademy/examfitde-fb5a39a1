// Deno.serve is built-in
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";
import { validateAuth, unauthorizedResponse, forbiddenResponse } from "../_shared/auth.ts";

const LESSON_STEPS = ["einstieg", "verstehen", "anwenden", "wiederholen", "mini_check"] as const;
const CHUNK_SIZE = 200; // bulk insert chunk size

Deno.serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req);
  if (corsResponse) return corsResponse;
  const origin = req.headers.get("origin");
  const corsHeaders = getCorsHeaders(origin);
  const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };

  const auth = await validateAuth(req, true);
  if (auth.error) {
    return auth.error === "Admin access required"
      ? forbiddenResponse(auth.error)
      : unauthorizedResponse(auth.error);
  }

  try {
    const { courseId, curriculumId } = await req.json();
    if (!courseId || !curriculumId) {
      return new Response(JSON.stringify({ error: "courseId and curriculumId are required" }),
        { status: 400, headers: jsonHeaders });
    }

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // ── Generation Lock ──────────────────────────────────────────────
    const { error: lockError } = await supabase
      .from("course_generation_locks")
      .insert({ course_id: courseId, locked_by: auth.user?.id || "system" });

    if (lockError) {
      if (lockError.code === "23505") {
        console.warn(`[Lock] Course ${courseId} already generating.`);
        return new Response(JSON.stringify({
          error: "Course generation already in progress",
          code: "GENERATION_LOCKED",
        }), { status: 409, headers: jsonHeaders });
      }
      throw lockError;
    }

    console.log(`[User: ${auth.user?.id}] Scaffolding course: ${courseId}`);

    try {
      // ── Load curriculum metadata ───────────────────────────────────
      const { data: course } = await supabase.from("courses").select("title").eq("id", courseId).single();
      const { data: curriculum } = await supabase.from("curricula").select("title, beruf_id").eq("id", curriculumId).single();
      let berufTitle = curriculum?.title || course?.title || "Beruf";
      if (curriculum?.beruf_id) {
        const { data: beruf } = await supabase.from("berufe").select("bezeichnung_kurz").eq("id", curriculum.beruf_id).single();
        if (beruf) berufTitle = beruf.bezeichnung_kurz;
      }

      await supabase.from("courses").update({ status: "generating", publishing_status: "draft" }).eq("id", courseId);

      // ── Load all learning fields + competencies in ONE query ───────
      const { data: learningFields, error: lfError } = await supabase
        .from("learning_fields")
        .select("*, competencies (*)")
        .eq("curriculum_id", curriculumId)
        .order("sort_order");
      if (lfError) throw lfError;
      if (!learningFields?.length) throw new Error("No learning fields found");

      // ── HARD GUARD: If no competencies exist, create synthetic ones from LF titles ──
      const totalComps = learningFields.reduce((sum, lf) => sum + (lf.competencies?.length || 0), 0);
      if (totalComps === 0) {
        console.warn(`[scaffold] Curriculum ${curriculumId} has ${learningFields.length} LFs but 0 competencies — creating synthetic competencies`);
        for (const lf of learningFields) {
          const syntheticComp = {
            learning_field_id: lf.id,
            code: `${lf.code || 'LF'}-K1`,
            title: lf.title || `Kompetenz ${lf.code}`,
            description: lf.description || lf.title || '',
            taxonomy_level: 'apply',
          };
          const { data: inserted, error: insertErr } = await supabase
            .from("competencies")
            .insert(syntheticComp)
            .select("*")
            .single();
          if (insertErr && insertErr.code !== '23505') {
            console.error(`[scaffold] Failed to create synthetic competency for LF ${lf.id}: ${insertErr.message}`);
          } else if (inserted) {
            lf.competencies = [inserted];
          }
        }
        console.log(`[scaffold] Created synthetic competencies for ${learningFields.length} LFs`);
      }

      // ── BULK: Load existing modules for this course ────────────────
      const { data: existingModules } = await supabase
        .from("modules")
        .select("id, learning_field_id")
        .eq("course_id", courseId);

      const moduleByLF = new Map<string, string>();
      for (const m of existingModules || []) {
        moduleByLF.set(m.learning_field_id, m.id);
      }

      // ── Create missing modules (bulk) ──────────────────────────────
      const missingModules = learningFields
        .filter((lf, idx) => !moduleByLF.has(lf.id))
        .map((lf, idx) => ({
          course_id: courseId,
          learning_field_id: lf.id,
          title: `${lf.code}: ${lf.title}`,
          description: lf.description,
          sort_order: learningFields.indexOf(lf),
        }));

      if (missingModules.length > 0) {
        const { data: inserted, error: modInsertErr } = await supabase
          .from("modules")
          .upsert(missingModules, { onConflict: "course_id,learning_field_id", ignoreDuplicates: true })
          .select("id, learning_field_id");

        if (modInsertErr && modInsertErr.code !== "23505") throw modInsertErr;
        for (const m of inserted || []) {
          moduleByLF.set(m.learning_field_id, m.id);
        }
      }

      // Refresh module map if needed (race fallback)
      if (moduleByLF.size < learningFields.length) {
        const { data: allMods } = await supabase
          .from("modules")
          .select("id, learning_field_id")
          .eq("course_id", courseId);
        for (const m of allMods || []) {
          moduleByLF.set(m.learning_field_id, m.id);
        }
      }

      // ── Collect all module IDs ─────────────────────────────────────
      const moduleIds = [...moduleByLF.values()];

      // ── BULK: Load ALL existing lessons for all modules ────────────
      const { data: existingLessons } = await supabase
        .from("lessons")
        .select("module_id, competency_id, step")
        .in("module_id", moduleIds);

      const existingLessonKeys = new Set<string>();
      for (const l of existingLessons || []) {
        existingLessonKeys.add(`${l.module_id}|${l.competency_id}|${l.step}`);
      }

      // ── Build missing lesson rows ──────────────────────────────────
      let totalDuration = 0;
      let lessonsCreated = 0;
      let lessonsSkipped = 0;
      const allNewLessons: any[] = [];

      for (const lf of learningFields) {
        const moduleId = moduleByLF.get(lf.id);
        if (!moduleId) {
          console.warn(`No module for LF ${lf.id}, skipping`);
          continue;
        }

        const competencies = lf.competencies || [];
        let lessonSortOrder = 0;

        for (const comp of competencies) {
          for (const step of LESSON_STEPS) {
            const key = `${moduleId}|${comp.id}|${step}`;
            if (existingLessonKeys.has(key)) {
              lessonsSkipped++;
              lessonSortOrder++;
              continue;
            }

            const stepDuration = step === "mini_check" ? 5 : 10;
            totalDuration += stepDuration;

            allNewLessons.push({
              module_id: moduleId,
              competency_id: comp.id,
              title: `${comp.code}: ${comp.title}`,
              step,
              content: {
                type: step === "mini_check" ? "mini_check" : "text",
                html: `<h3>${comp.title} – ${step}</h3><p>⏳ Inhalt wird generiert...</p>`,
                objectives: [`Verständnis von ${comp.title}`],
                _placeholder: true,
                _beruf: berufTitle,
              },
              duration_minutes: stepDuration,
              sort_order: lessonSortOrder++,
              weight_tag: step === "mini_check" ? "high" : step === "anwenden" ? "high" : step === "verstehen" ? "medium" : "low",
              exam_relevance_score: 30,
              mastery_weight: step === "mini_check" ? 1.0 : 0,
              minicheck_parsed: step === "mini_check" ? true : false,
            });
          }
        }
      }

      // ── BULK: Chunked insert of all new lessons ────────────────────
      for (let i = 0; i < allNewLessons.length; i += CHUNK_SIZE) {
        const chunk = allNewLessons.slice(i, i + CHUNK_SIZE);
        const { error: insertError } = await supabase.from("lessons").insert(chunk);
        if (insertError) {
          if (insertError.code === "23505") {
            console.warn(`[Chunk ${i}] Partial duplicate, inserting individually`);
            for (const row of chunk) {
              try { await supabase.from("lessons").insert(row); } catch (_e) { /* skip duplicate */ }
            }
          } else {
            throw insertError;
          }
        }
        lessonsCreated += chunk.length;
      }

      await supabase.from("courses").update({
        estimated_duration: Math.ceil(totalDuration / 60),
        status: "draft",
      }).eq("id", courseId);

      // ── Post-generation validation ─────────────────────────────────
      const validationResult = await supabase.rpc("validate_course_integrity", { p_course_id: courseId });
      const integrity = validationResult.data;
      console.log(`[Integrity] Passed: ${integrity?.passed}, Issues: ${JSON.stringify(integrity?.issues)}`);

      // Release lock
      await supabase.from("course_generation_locks").delete().eq("course_id", courseId);

      console.log(`Scaffolding done: ${lessonsCreated} created, ${lessonsSkipped} skipped.`);

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
      await supabase.from("course_generation_locks").delete().eq("course_id", courseId);
      throw innerError;
    }

  } catch (error) {
    console.error("Generate course error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
