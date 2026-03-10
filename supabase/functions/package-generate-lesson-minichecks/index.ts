import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { callAIJSON } from "../_shared/ai-client.ts";
import type { AIProvider } from "../_shared/ai-client.ts";
import { shouldSoftStop, getTimeBudget } from "../_shared/time-budget.ts";

/**
 * package-generate-lesson-minichecks
 * 
 * Generates MiniCheck questions for each lesson in a course package.
 * - Learning-Track (has_learning_course=true): lesson-based, 5-8 items per lesson
 * - ExamFirst (has_learning_course=false): competency/drill-based, 3-5 items per competency
 * 
 * SSOT: minicheck_questions table with mode='lesson' | 'drill'
 * 
 * v2: Uses SSOT time-budget with shouldSoftStop() instead of hardcoded timeout.
 *     Reduced MAX_TARGETS_PER_RUN from 40→5 to stay within 55s edge limit.
 *     Each AI call takes ~8-12s, so 5 targets ≈ 40-50s (within soft-stop window).
 */

const ITEMS_PER_LESSON = 7;
const ITEMS_PER_DRILL = 5;
const MAX_TARGETS_PER_RUN = 5;

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

/**
 * Direct AI call via _shared/ai-client — no ai-tutor routing.
 * This fixes Blocker B: ai-tutor expects {message, mode, role...}
 * but we need {messages: [{role, content}], ...} (OpenAI-compatible).
 */
async function callAI(systemPrompt: string, userPrompt: string): Promise<string> {
  const result = await callAIJSON({
    provider: "lovable" as AIProvider,
    model: "openai/gpt-5.2",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    temperature: 0.4,
    max_tokens: 4000,
  });
  return result.content || "";
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
  "options": [{"text": "..."}, {"text": "..."}, {"text": "..."}, {"text": "..."}],
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

/** Normalize options to consistent {text: string}[] format */
function normalizeOptions(opts: unknown): Array<{ text: string }> {
  if (!Array.isArray(opts)) return [];
  return opts.map((o: unknown) => {
    if (typeof o === "string") {
      return { text: o.replace(/^[A-D]\)\s*/, "") };
    }
    if (o && typeof o === "object" && "text" in (o as any)) {
      return { text: String((o as any).text) };
    }
    return { text: String(o) };
  });
}

/** Robust JSON array parser — handles markdown fences, wrapper objects, nested brackets */
function parseJsonArray(raw: string): any[] {
  let cleaned = raw.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();

  // Try direct parse first
  try {
    const v = JSON.parse(cleaned);
    if (Array.isArray(v)) return v;
    if (v && Array.isArray((v as any).items)) return (v as any).items;
  } catch { /* fallback below */ }

  // Fallback: find first balanced array
  const start = cleaned.indexOf("[");
  if (start === -1) throw new Error("No JSON array found");

  let depth = 0;
  for (let i = start; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (ch === "[") depth++;
    if (ch === "]") {
      depth--;
      if (depth === 0) {
        return JSON.parse(cleaned.slice(start, i + 1));
      }
    }
  }
  throw new Error("Unclosed JSON array");
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

    const startMs = Date.now();
    const budget = getTimeBudget("lesson_minichecks");

    try {
    const { data: pkgRow } = await sb
      .from("course_packages")
      .select("track, feature_flags, course_id")
      .eq("id", packageId)
      .single();

    const featureFlags = pkgRow?.feature_flags || {};

    // has_minichecks → run/skip
    const hasMiniChecks = featureFlags.has_minichecks ?? false;
    if (!hasMiniChecks) {
      return json({ ok: true, skipped: true, reason: "MINICHECKS_DISABLED" });
    }

    // has_learning_course → lesson vs drill mode
    const hasLearningCourse = featureFlags.has_learning_course ?? (pkgRow?.track === "AUSBILDUNG_VOLL");
    const effectiveCourseId = courseId || pkgRow?.course_id;
    const mode: "lesson" | "drill" = hasLearningCourse ? "lesson" : "drill";

    // Prereq check (mode-specific)
    if (mode === "lesson") {
      if (!(await prereqDone(sb, packageId, "validate_learning_content"))) {
        return json({ ok: false, retry: true, error: "PREREQ_NOT_DONE: validate_learning_content" }, 409);
      }
    } else {
      if (!(await prereqDone(sb, packageId, "validate_exam_pool"))) {
        return json({ ok: false, retry: true, error: "PREREQ_NOT_DONE: validate_exam_pool" }, 409);
      }
    }

    // Get profession name
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
      // Lesson MODE: SSOT path — always modules → lessons (never direct .eq on course_id/module_id)
      if (!effectiveCourseId) throw new Error("course_id required for lesson mode");

      const { data: modules } = await sb
        .from("modules")
        .select("id")
        .eq("course_id", effectiveCourseId);

      const moduleIds = (modules || []).map(m => m.id);
      if (moduleIds.length > 0) {
        const { data: allLessons } = await sb
          .from("lessons")
          .select("id, title, content, competency_id, step")
          .in("module_id", moduleIds)
          .not("content", "is", null)
          .neq("step", "mini_check")
          .order("sort_order", { ascending: true })
          .order("id", { ascending: true });

        if (allLessons?.length) {
          const compIds = [...new Set(allLessons.filter(l => l.competency_id).map(l => l.competency_id))];
          const compMap: Record<string, string> = {};
          if (compIds.length > 0) {
            const { data: comps } = await sb.from("competencies").select("id, title").in("id", compIds);
            for (const c of comps || []) compMap[c.id] = c.title;
          }

          const lessonIds = allLessons.map(l => l.id);
          const { data: existing } = await sb
            .from("minicheck_questions")
            .select("lesson_id")
            .in("lesson_id", lessonIds)
            .eq("curriculum_id", curriculumId)
            .eq("mode", "lesson");
          const existingSet = new Set((existing || []).map(e => e.lesson_id));

          for (const lesson of allLessons) {
            if (existingSet.has(lesson.id)) continue;
            const contentText = typeof lesson.content === "string"
              ? lesson.content
              : JSON.stringify(lesson.content || {});
            // Skip placeholders and very short content
            if (contentText.length < 200) continue;
            if (contentText.includes('"_placeholder":true') || contentText.includes('"_placeholder": true')) continue;

            targets.push({
              id: lesson.id,
              title: lesson.title,
              content: contentText,
              competencyTitle: compMap[lesson.competency_id] || "Allgemein",
              competencyId: lesson.competency_id,
              lessonId: lesson.id,
            });
          }
        }
      }

      if (targets.length === 0) {
        console.log(`[MiniChecks] No eligible lessons found for course ${effectiveCourseId} — falling back to drill mode`);
      }
    }

    // DRILL MODE: fallback or explicit
    if (mode === "drill" || (mode === "lesson" && targets.length === 0)) {
      const effectiveMode = "drill";
      const { data: lfs } = await sb
        .from("learning_fields")
        .select("id")
        .eq("curriculum_id", curriculumId);
      const lfIds = (lfs || []).map(lf => lf.id);

      if (lfIds.length === 0) throw new Error("No learning fields found for curriculum");

      const { data: allComps } = await sb
        .from("competencies")
        .select("id, title, description")
        .in("learning_field_id", lfIds)
        .order("created_at", { ascending: true });

      if (!allComps?.length) throw new Error("No competencies found");

      const compIdsAll = allComps.map(c => c.id);
      const { data: existingDrills } = await sb
        .from("minicheck_questions")
        .select("competency_id")
        .in("competency_id", compIdsAll)
        .eq("curriculum_id", curriculumId)
        .eq("mode", effectiveMode);
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

    // +1 probe: fetch one extra to definitively know if more remain
    const targetsFound = targets.length;
    const hasMore = targetsFound > MAX_TARGETS_PER_RUN;
    if (hasMore) {
      console.log(`[MiniChecks] Capping targets from ${targetsFound} to ${MAX_TARGETS_PER_RUN} (more remain)`);
      targets = targets.slice(0, MAX_TARGETS_PER_RUN);
    }

    const effectiveMode = targets[0]?.lessonId ? "lesson" : "drill";
    console.log(`[MiniChecks] ${effectiveMode} mode: ${targets.length} targets to generate for ${packageId.slice(0, 8)} (hasMore=${hasMore}, found=${targetsFound})`);

    for (const target of targets) {
      if (shouldSoftStop(startMs, "lesson_minichecks")) {
        console.log(`[MiniChecks] Soft-stop reached after ${totalGenerated} generated (${Date.now() - startMs}ms/${budget.softStopMs}ms)`);
        break;
      }

      const itemCount = target.lessonId ? ITEMS_PER_LESSON : ITEMS_PER_DRILL;
      const targetMode: "lesson" | "drill" = target.lessonId ? "lesson" : "drill";
      const { system, user } = buildMiniCheckPrompt(
        target.title,
        target.content,
        target.competencyTitle,
        itemCount,
        targetMode,
        professionName
      );

      try {
        const rawResponse = await callAI(system, user);
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
          options: normalizeOptions(q.options),
          correct_answer: typeof q.correct_answer === "number" ? q.correct_answer : 0,
          explanation: q.explanation || "",
          difficulty: q.difficulty || "medium",
          cognitive_level: q.cognitive_level || "understand",
          trap_tags: Array.isArray(q.trap_tags) ? q.trap_tags : [],
          distractor_meta: {},
          mode: targetMode,
          status: "draft",
          sort_order: idx,
        }));

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

    const elapsed = Date.now() - startMs;
    const softStopped = shouldSoftStop(startMs, "lesson_minichecks");
    console.log(`[MiniChecks] ${softStopped ? "⏱️ Soft-stopped" : "✅ Done"}: ${totalGenerated} questions generated, ${totalFailed} failed, ${elapsed}ms`);

    // batch_complete=false triggers runner re-enqueue (line 939 in job-runner)
    // hasMore is the definitive "+1 probe" signal — no false positives
    const batchComplete = !softStopped && totalFailed === 0 && !hasMore;

    // Progress heartbeat: merge meta (never overwrite existing keys like stall_runs, artifact_*)
    const progressNote = totalGenerated > 0
      ? `${totalGenerated} generated, ${totalFailed} failed, hasMore=${hasMore}, elapsed=${elapsed}ms`
      : `0 generated (all existed or skipped), hasMore=${hasMore}, elapsed=${elapsed}ms`;

    const { data: stepRow } = await sb
      .from("package_steps")
      .select("meta")
      .eq("package_id", packageId)
      .eq("step_key", "generate_lesson_minichecks")
      .maybeSingle();

    const nextMeta = { ...((stepRow?.meta as Record<string, unknown>) ?? {}), last_progress_note: progressNote };

    await sb.from("package_steps")
      .update({ meta: nextMeta })
      .eq("package_id", packageId)
      .eq("step_key", "generate_lesson_minichecks");

    return json({
      ok: true,
      batch_complete: batchComplete,
      mode: effectiveMode,
      generated: totalGenerated,
      failed: totalFailed,
      targets_found: targetsFound,
      targets_processed: targets.length,
      elapsed_ms: elapsed,
      soft_stopped: softStopped,
      has_more: hasMore,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[MiniChecks] FATAL: ${msg}`);
    return json({ ok: false, error: msg }, 500);
  }
});
