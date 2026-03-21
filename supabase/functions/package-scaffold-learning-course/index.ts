import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const LESSON_STEPS = ["einstieg", "verstehen", "anwenden", "wiederholen", "mini_check"] as const;

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const body = await req.json().catch(() => ({}));
  const p = body.payload || body;

  const packageId = p.package_id;
  const courseId = p.course_id;
  const curriculumId = p.curriculum_id;

  if (!packageId || !courseId || !curriculumId) {
    return json({ error: "Missing package_id, course_id, or curriculum_id" }, 400);
  }

  // pipeline-runner handles step_start/step_done/step_fail.
  // Do NOT touch pipeline_lock / course_package_locks / update_course_package_step.

  try {
    // ── Generation Lock (idempotent) ──
    const { error: lockError } = await sb
      .from("course_generation_locks")
      .insert({ course_id: courseId, locked_by: "pipeline" });

    if (lockError) {
      if (lockError.code === "23505") {
        // Lock exists — but verify artifacts before declaring success
        const { count: moduleCount } = await sb
          .from("modules")
          .select("id", { count: "exact", head: true })
          .eq("course_id", courseId);
        const { count: lessonCount } = await sb
          .from("lessons")
          .select("id", { count: "exact", head: true })
          .in("module_id", (await sb.from("modules").select("id").eq("course_id", courseId)).data?.map((m: any) => m.id) || []);

        if ((moduleCount ?? 0) > 0 && (lessonCount ?? 0) > 0) {
          console.log(`[scaffold] Course ${courseId} locked AND has ${moduleCount} modules, ${lessonCount} lessons — idempotent success`);
          return json({ ok: true, skipped: true, reason: "GENERATION_LOCKED", modules: moduleCount, lessons: lessonCount });
        }

        // Lock exists but NO artifacts — previous run failed mid-flight. Clear lock and re-run.
        console.warn(`[scaffold] STALE LOCK: Course ${courseId} locked but has ${moduleCount} modules, ${lessonCount} lessons — clearing lock and re-running`);
        await sb.from("course_generation_locks").delete().eq("course_id", courseId);
        // Fall through to re-run scaffold below
      }
      // Non-lock error: continue anyway (table might not exist for some setups)
      console.warn(`[scaffold] Lock warning: ${lockError.message}`);
    }

    try {
      // ── Set course status ──
      await sb.from("courses").update({ status: "generating", publishing_status: "draft" }).eq("id", courseId);

      // ── Load learning fields ──
      const { data: lfs, error: lfErr } = await sb
        .from("learning_fields")
        .select("id, code, title, description, sort_order")
        .eq("curriculum_id", curriculumId)
        .order("sort_order");

      if (lfErr) throw new Error(`LF query: ${lfErr.message}`);
      if (!lfs || lfs.length === 0) throw new Error("No learning fields found");

      let modulesCreated = 0;
      let lessonsCreated = 0;

      for (const lf of lfs) {
        // Check if module already exists (idempotent)
        const { data: existingMod } = await sb
          .from("modules")
          .select("id")
          .eq("course_id", courseId)
          .eq("learning_field_id", lf.id)
          .maybeSingle();

        let modId: string;
        if (existingMod) {
          modId = existingMod.id;
        } else {
          const { data: mod, error: modErr } = await sb.from("modules").insert({
            course_id: courseId,
            learning_field_id: lf.id,
            title: `${lf.code}: ${lf.title}`,
            description: lf.description,
            sort_order: lf.sort_order,
          }).select("id").single();

          if (modErr) {
            if (modErr.code === "23505") continue; // duplicate
            throw new Error(`Module insert: ${modErr.message}`);
          }
          if (!mod) continue;
          modId = mod.id;
          modulesCreated++;
        }

        // ── Load competencies ──
        const { data: comps } = await sb
          .from("competencies")
          .select("id, code, title, description, taxonomy_level, sort_order")
          .eq("learning_field_id", lf.id)
          .order("sort_order");

        if (!comps || comps.length === 0) continue;

        // Check if lessons already exist for this module
        const { count: existingLessons } = await sb
          .from("lessons")
          .select("id", { count: "exact", head: true })
          .eq("module_id", modId);

        if ((existingLessons ?? 0) > 0) {
          lessonsCreated += existingLessons!; // count existing as success for idempotency guard
          continue;
        }

        const rows = [];
        for (const comp of comps) {
          for (let si = 0; si < LESSON_STEPS.length; si++) {
            const step = LESSON_STEPS[si];
            rows.push({
              module_id: modId,
              competency_id: comp.id,
              title: `${comp.code}: ${comp.title}`,
              step,
              content: {
                type: step === "mini_check" ? "mini_check" : "text",
                html: `<h3>${comp.title} – ${step}</h3><p>⏳ Inhalt wird generiert...</p>`,
                objectives: [`Verständnis von ${comp.title}`],
                _placeholder: true,
              },
              duration_minutes: step === "mini_check" ? 5 : 10,
              sort_order: (comp.sort_order || 0) * 5 + si,
              weight_tag: ["mini_check", "anwenden"].includes(step) ? "high" : step === "verstehen" ? "medium" : "low",
              exam_relevance_score: 30,
              mastery_weight: step === "mini_check" ? 1.0 : 0,
              minicheck_parsed: step === "mini_check" ? true : false,
            });
          }
        }

        if (rows.length > 0) {
          // Chunk inserts to avoid payload limits
          const CHUNK = 200;
          for (let i = 0; i < rows.length; i += CHUNK) {
            const { error: insErr } = await sb.from("lessons").insert(rows.slice(i, i + CHUNK));
            if (insErr) {
              if (insErr.code === "23505") continue; // duplicates
              throw new Error(`Lesson insert: ${insErr.message}`);
            }
          }
          lessonsCreated += rows.length;
        }
      }

      // ── Update course status ──
      await sb.from("courses").update({ status: "draft" }).eq("id", courseId);

      console.log(`[scaffold] Done: ${modulesCreated} modules, ${lessonsCreated} lessons for course ${courseId.slice(0, 8)}`);

      // ── GUARD: 0 lessons is NOT success ──
      // If modules were created but no lessons, competencies are likely missing.
      // Return 422 (permanent) so pipeline does NOT proceed on empty scaffold.
      if (lessonsCreated === 0) {
        console.error(`[scaffold] PERMANENT: ${modulesCreated} modules created but 0 lessons — competencies likely missing for curriculum ${curriculumId}`);
        return json({
          ok: false,
          batch_complete: false,
          error: "SCAFFOLD_EMPTY_NO_LESSONS",
          message: `${modulesCreated} Module erstellt, aber 0 Lektionen — Kompetenzen fehlen im Curriculum.`,
          modules_created: modulesCreated,
          lessons_created: 0,
          permanent: true,
          retry: false,
        }, 422);
      }

      return json({ ok: true, batch_complete: true, modules_created: modulesCreated, lessons_created: lessonsCreated });

    } finally {
      // Release generation lock
      await sb.from("course_generation_locks").delete().eq("course_id", courseId);
    }
  } catch (e: unknown) {
    const msg = (e as Error)?.message || String(e);
    // Idempotency: if unique constraint violation, verify artifacts before declaring success
    if (msg.includes("23505") || msg.includes("duplicate") || msg.includes("already exists")) {
      const { count: modCheck } = await sb
        .from("modules")
        .select("id", { count: "exact", head: true })
        .eq("course_id", courseId);
      if ((modCheck ?? 0) > 0) {
        console.log(`[scaffold] Idempotent hit (${msg.slice(0, 60)}) — ${modCheck} modules exist, treating as success`);
        return json({ ok: true, skipped: true, reason: "already_exists", modules: modCheck });
      }
      // Constraint hit but no artifacts — this is a real failure
      console.error(`[scaffold] Constraint hit but 0 modules — NOT treating as success: ${msg.slice(0, 100)}`);
    }
    console.error(`[scaffold] Error: ${msg}`);
    return json({ ok: false, error: msg }, 500);
  }
});
