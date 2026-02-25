import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

/**
 * package-generate-lesson-minichecks
 * 
 * Generates MiniCheck questions for each lesson in a course package.
 * - Learning-Track (has_learning_course=true): lesson-based, 5-8 items per lesson
 * - ExamFirst (has_learning_course=false): competency/drill-based, 3-5 items per competency
 * 
 * SSOT: minicheck_questions table with mode='lesson' | 'drill'
 */

const TIME_BUDGET_MS = 160_000;
const ITEMS_PER_LESSON = 7;
const ITEMS_PER_DRILL = 5;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function assertUuid(name: string, v: unknown) {
  const re = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!v || typeof v !== "string" || !re.test(v)) throw new Error(`INVALID_${name.toUpperCase()}`);
}

async function prereqDone(sb: ReturnType<typeof createClient>, packageId: string, stepKey: string) {
  const { data: d1 } = await sb
    .from("package_steps").select("status")
    .eq("package_id", packageId).eq("step_key", stepKey).maybeSingle();
  if (d1?.status === "done") return true;
  const { data: d2 } = await sb
    .from("course_package_build_steps").select("status")
    .eq("package_id", packageId).eq("step_key", stepKey).maybeSingle();
  return d2?.status === "done";
}

async function callLovableAI(prompt: string, systemPrompt: string): Promise<string> {
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const res = await fetch(`${SUPABASE_URL}/functions/v1/ai-tutor`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify({
      mode: "internal_generation",
      model: "google/gemini-2.5-flash",
      system_prompt: systemPrompt,
      user_prompt: prompt,
      max_tokens: 4000,
    }),
  });

  if (!res.ok) throw new Error(`AI call failed: ${res.status}`);
  const data = await res.json();
  return data.response || data.text || JSON.stringify(data);
}

function buildMiniCheckPrompt(
  lessonTitle: string,
  lessonContent: string,
  competencyTitle: string,
  itemCount: number,
  mode: "lesson" | "drill",
  professionName: string
): { system: string; user: string } {
  const system = `Du bist ein erfahrener IHK-Prüfungsexperte und Fachdidaktiker für den Beruf "${professionName}".
Deine Aufgabe: Erstelle exakt ${itemCount} MiniCheck-Fragen im Multiple-Choice-Format.

REGELN:
- Jede Frage hat genau 4 Antwortoptionen (A-D)
- Genau EINE Antwort ist korrekt
- Distraktoren müssen fachlich plausibel sein (typische IHK-Fallen)
- Erklärung muss begründen, warum die richtige Antwort korrekt ist UND warum jeder Distraktor falsch ist
- Schwierigkeitsverteilung: 30% leicht, 40% mittel, 30% schwer
- Kognitive Stufen variieren: remember, understand, apply, analyze
- Keine Trivialfragen ("Was ist...?"), sondern Anwendungs-/Transferfragen

AUSGABE: Reines JSON-Array, kein Markdown, kein Kommentar:
[{
  "question_text": "...",
  "options": ["A) ...", "B) ...", "C) ...", "D) ..."],
  "correct_answer": 0,
  "explanation": "Richtig ist A, weil... B ist falsch, weil... C ist falsch, weil... D ist falsch, weil...",
  "difficulty": "easy|medium|hard",
  "cognitive_level": "remember|understand|apply|analyze",
  "trap_tags": ["verwechslung_paragraph", "rechenfehler", ...]
}]`;

  const contextBlock = mode === "lesson"
    ? `Lektion: "${lessonTitle}"\nKompetenz: "${competencyTitle}"\n\nLektionsinhalt (Zusammenfassung):\n${lessonContent.slice(0, 3000)}`
    : `Kompetenz: "${competencyTitle}"\nModus: Micro-Drill (kurzes Warm-up-Training)`;

  const user = `Erstelle ${itemCount} MiniCheck-Fragen für:\n${contextBlock}`;

  return { system, user };
}

function parseJsonArray(raw: string): any[] {
  // Strip markdown fences
  let cleaned = raw.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
  // Find array bounds
  const start = cleaned.indexOf("[");
  const end = cleaned.lastIndexOf("]");
  if (start === -1 || end === -1) throw new Error("No JSON array found");
  cleaned = cleaned.slice(start, end + 1);
  return JSON.parse(cleaned);
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const body = await req.json().catch(() => ({}));
  const p = body.payload || body;

  try {
    assertUuid("package_id", p?.package_id);
    assertUuid("curriculum_id", p?.curriculum_id);
  } catch (e: unknown) {
    return json({ error: (e as Error).message }, 400);
  }

  const packageId = p.package_id as string;
  const courseId = p.course_id as string | undefined;
  const curriculumId = p.curriculum_id as string;

  // Prereq: exam pool should be done (MiniChecks run after content generation)
  if (!(await prereqDone(sb, packageId, "validate_exam_pool"))) {
    return json({ ok: false, retry: true, error: "PREREQ_NOT_DONE: validate_exam_pool" }, 409);
  }

  const startTime = Date.now();

  try {
    // Determine mode from package feature_flags
    const { data: pkgRow } = await sb
      .from("course_packages")
      .select("track, feature_flags, course_id")
      .eq("id", packageId)
      .single();

    const featureFlags = pkgRow?.feature_flags || {};
    const hasLearningCourse = featureFlags.has_learning_course ?? (pkgRow?.track === "AUSBILDUNG_VOLL");
    const effectiveCourseId = courseId || pkgRow?.course_id;
    const mode: "lesson" | "drill" = hasLearningCourse ? "lesson" : "drill";

    // Get profession name for context
    const { data: currRow } = await sb.from("curricula").select("beruf_id, title").eq("id", curriculumId).maybeSingle();
    let professionName = currRow?.title || "Fachberuf";
    if (currRow?.beruf_id) {
      const { data: berufRow } = await sb.from("berufe").select("bezeichnung_kurz").eq("id", currRow.beruf_id).maybeSingle();
      if (berufRow) professionName = berufRow.bezeichnung_kurz;
    }

    let totalGenerated = 0;
    let totalFailed = 0;
    let targets: Array<{ id: string; title: string; content: string; competencyTitle: string; competencyId: string | null; lessonId: string | null }> = [];

    if (mode === "lesson") {
      // ═══ LESSON MODE: Generate per lesson ═══
      if (!effectiveCourseId) throw new Error("course_id required for lesson mode");

      const { data: lessons } = await sb
        .from("lessons")
        .select("id, title, content, competency_id")
        .eq("course_id", effectiveCourseId)
        .not("content", "is", null)
        .order("sort_order", { ascending: true });

      if (!lessons?.length) throw new Error("No lessons found for course");

      // Load competency titles
      const compIds = [...new Set(lessons.filter(l => l.competency_id).map(l => l.competency_id))];
      const compMap: Record<string, string> = {};
      if (compIds.length > 0) {
        const { data: comps } = await sb.from("competencies").select("id, title").in("id", compIds);
        for (const c of comps || []) compMap[c.id] = c.title;
      }

      // Check which lessons already have MiniChecks
      const lessonIds = lessons.map(l => l.id);
      const { data: existing } = await sb
        .from("minicheck_questions")
        .select("lesson_id")
        .in("lesson_id", lessonIds)
        .eq("mode", "lesson");
      const existingSet = new Set((existing || []).map(e => e.lesson_id));

      for (const lesson of lessons) {
        if (existingSet.has(lesson.id)) continue; // skip already generated
        const contentText = typeof lesson.content === "string"
          ? lesson.content
          : JSON.stringify(lesson.content || {});
        if (contentText.length < 50) continue; // skip placeholder lessons

        targets.push({
          id: lesson.id,
          title: lesson.title,
          content: contentText,
          competencyTitle: compMap[lesson.competency_id] || "Allgemein",
          competencyId: lesson.competency_id,
          lessonId: lesson.id,
        });
      }
    } else {
      // ═══ DRILL MODE: Generate per competency ═══
      const { data: comps } = await sb
        .from("competencies")
        .select("id, title, description, learning_field_id")
        .eq("learning_field_id", curriculumId) // via learning_fields join
        .order("sort_order", { ascending: true });

      // Actually need to go through learning_fields
      const { data: lfs } = await sb
        .from("learning_fields")
        .select("id")
        .eq("curriculum_id", curriculumId);
      const lfIds = (lfs || []).map(lf => lf.id);

      if (lfIds.length === 0) throw new Error("No learning fields found");

      const { data: allComps } = await sb
        .from("competencies")
        .select("id, title, description")
        .in("learning_field_id", lfIds)
        .order("sort_order", { ascending: true });

      if (!allComps?.length) throw new Error("No competencies found");

      // Check existing drills
      const compIdsAll = allComps.map(c => c.id);
      const { data: existingDrills } = await sb
        .from("minicheck_questions")
        .select("competency_id")
        .in("competency_id", compIdsAll)
        .eq("mode", "drill");
      const existingDrillSet = new Set((existingDrills || []).map(e => e.competency_id));

      for (const comp of allComps) {
        if (existingDrillSet.has(comp.id)) continue;
        targets.push({
          id: comp.id,
          title: comp.title,
          content: comp.description || comp.title,
          competencyTitle: comp.title,
          competencyId: comp.id,
          lessonId: null,
        });
      }
    }

    console.log(`[MiniChecks] ${mode} mode: ${targets.length} targets to generate for ${packageId.slice(0, 8)}`);

    // Process targets within time budget
    for (const target of targets) {
      if (Date.now() - startTime > TIME_BUDGET_MS) {
        console.log(`[MiniChecks] Time budget exceeded after ${totalGenerated} generated`);
        break;
      }

      const itemCount = mode === "lesson" ? ITEMS_PER_LESSON : ITEMS_PER_DRILL;
      const { system, user } = buildMiniCheckPrompt(
        target.title,
        target.content,
        target.competencyTitle,
        itemCount,
        mode,
        professionName
      );

      try {
        const rawResponse = await callLovableAI(user, system);
        const questions = parseJsonArray(rawResponse);

        if (!Array.isArray(questions) || questions.length === 0) {
          totalFailed++;
          continue;
        }

        const rows = questions.map((q: any, idx: number) => ({
          lesson_id: target.lessonId,
          curriculum_id: curriculumId,
          competency_id: target.competencyId,
          question_text: q.question_text || q.text || "",
          options: Array.isArray(q.options) ? q.options : [],
          correct_answer: typeof q.correct_answer === "number" ? q.correct_answer : 0,
          explanation: q.explanation || "",
          difficulty: q.difficulty || "medium",
          cognitive_level: q.cognitive_level || "understand",
          trap_tags: Array.isArray(q.trap_tags) ? q.trap_tags : [],
          distractor_meta: {},
          mode,
          status: "draft",
          sort_order: idx,
        }));

        // Filter out invalid rows
        const validRows = rows.filter((r: any) =>
          r.question_text.length > 10 &&
          Array.isArray(r.options) && r.options.length === 4 &&
          r.explanation.length > 20
        );

        if (validRows.length > 0) {
          const { error: insertErr } = await sb
            .from("minicheck_questions")
            .insert(validRows);

          if (insertErr) {
            console.warn(`[MiniChecks] Insert error for ${target.id.slice(0, 8)}: ${insertErr.message}`);
            totalFailed++;
          } else {
            totalGenerated += validRows.length;
          }
        } else {
          totalFailed++;
        }
      } catch (genErr) {
        console.warn(`[MiniChecks] Generation failed for ${target.id.slice(0, 8)}: ${(genErr as Error).message}`);
        totalFailed++;
      }
    }

    const elapsed = Date.now() - startTime;
    console.log(`[MiniChecks] ✅ Done: ${totalGenerated} questions generated, ${totalFailed} failed, ${elapsed}ms`);

    return json({
      ok: true,
      mode,
      generated: totalGenerated,
      failed: totalFailed,
      targets_total: targets.length,
      elapsed_ms: elapsed,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[MiniChecks] FATAL: ${msg}`);
    return json({ ok: false, error: msg }, 500);
  }
});
