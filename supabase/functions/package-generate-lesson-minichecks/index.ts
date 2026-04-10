import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { callAIWithFailover } from "../_shared/ai-client.ts";
import type { AIProvider } from "../_shared/ai-client.ts";
import { getModelChainAsync } from "../_shared/model-routing.ts";
import { shouldSoftStop, getTimeBudget } from "../_shared/time-budget.ts";
import { bootstrapLLMLogging } from "../_shared/llm-log-bootstrap.ts";
import { shouldUseBatch, BATCH_DEFAULT_MODEL } from "../_shared/batch/routing-config.ts";
import { mergePackageStepMeta } from "../_shared/merge-step-meta.ts";
import { buildBatchRequests, submitBatchViaFunction } from "../_shared/batch/enqueue-openai.ts";
import { getContentProfile } from "../_shared/track-content-profiles.ts";

/**
 * package-generate-lesson-minichecks
 * 
 * Generates MiniCheck questions for each lesson in a course package.
 * - Learning-Track (has_learning_course=true): lesson-based, 5-8 items per lesson
 * - ExamFirst (has_learning_course=false): competency/drill-based, 3-5 items per competency
 * 
 * SSOT: minicheck_questions table with mode='lesson' | 'drill'
 * 
 * v3: MAX_TARGETS_PER_RUN 5→3 to prevent timeouts. Budget raised to 50s/38s soft-stop.
 *     3 targets × ~12s = ~36s (within soft-stop window with margin).
 */

const ITEMS_PER_LESSON = 7;
const ITEMS_PER_DRILL = 5;
const MIN_ITEMS_PER_LESSON = 3;
const MAX_TARGETS_PER_RUN = 3;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function assertUuid(name: string, v: unknown) {
  const re = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!v || typeof v !== "string" || !re.test(v)) throw new Error(`INVALID_${name.toUpperCase()}`);
}

async function prereqDone(sb: ReturnType<typeof createClient>, packageId: string, stepKey: string) {
  const FULFILLED = ["done", "skipped"];
  const { data: d1 } = await sb
    .from("package_steps").select("status")
    .eq("package_id", packageId).eq("step_key", stepKey).maybeSingle();
  if (!d1) return true;
  if (FULFILLED.includes(d1.status)) return true;
  const { data: d2 } = await sb
    .from("course_package_build_steps").select("status")
    .eq("package_id", packageId).eq("step_key", stepKey).maybeSingle();
  return d2?.status ? FULFILLED.includes(d2.status) : false;
}

/**
 * Direct AI call via _shared/ai-client — no ai-tutor routing.
 * This fixes Blocker B: ai-tutor expects {message, mode, role...}
 * but we need {messages: [{role, content}], ...} (OpenAI-compatible).
 */
async function callAI(systemPrompt: string, userPrompt: string): Promise<string> {
  const chain = await getModelChainAsync("minicheck");
  const result = await callAIWithFailover(
    chain.map(c => ({ provider: c.provider, model: c.model })),
    {
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.4,
      max_tokens: 4000,
    },
  );
  return result.content || "";
}

function buildMiniCheckPrompt(
  lessonTitle: string,
  lessonContent: string,
  competencyTitle: string,
  itemCount: number,
  mode: "lesson" | "drill",
  professionName: string,
  track?: string,
): { system: string; user: string } {
  const profile = getContentProfile(track || "AUSBILDUNG_VOLL");
  const mc = profile.minicheck;

  const system = `Du bist ein ${mc.persona} für "${professionName}".
Deine Aufgabe: Erstelle exakt ${itemCount} MiniCheck-Fragen im Multiple-Choice-Format.

REGELN:
- Jede Frage hat genau 4 Antwortoptionen (A-D)
- Genau EINE Antwort ist korrekt
- Distraktoren müssen fachlich plausibel sein (${mc.distractorStyle})
- Erklärung muss begründen, warum die richtige Antwort korrekt ist UND warum jeder Distraktor falsch ist
- Schwierigkeitsverteilung: ${mc.bloomDistribution}
- Kognitive Stufen variieren: remember, understand, apply, analyze${profile.track === "STUDIUM" ? ", evaluate" : ""}
- ${mc.questionStyle}

AUSGABE: Reines JSON-Array, kein Markdown, kein Kommentar:
[{
  "question_text": "...",
  "options": [{"text": "..."}, {"text": "..."}, {"text": "..."}, {"text": "..."}],
  "correct_answer": 0,
  "explanation": "Richtig ist A, weil... B ist falsch, weil... C ist falsch, weil... D ist falsch, weil...",
  "difficulty": "easy|medium|hard",
  "cognitive_level": "remember|understand|apply|analyze${profile.track === "STUDIUM" ? "|evaluate" : ""}",
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
  bootstrapLLMLogging(sb, "package_generate_lesson_minichecks");
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
      return json({ ok: false, skipped: true, reason: "MINICHECKS_DISABLED" });
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

          // Robust per-lesson counts with pagination (prevents hidden row-limit drift)
          const countByLesson = new Map<string, number>();
          for (let i = 0; i < lessonIds.length; i += 200) {
            const chunk = lessonIds.slice(i, i + 200);
            let from = 0;
            const PAGE = 1000;

            while (true) {
              const { data: existing, error: existingErr } = await sb
                .from("minicheck_questions")
                .select("lesson_id")
                .in("lesson_id", chunk)
                .eq("curriculum_id", curriculumId)
                .eq("mode", "lesson")
                .range(from, from + PAGE - 1);

              if (existingErr) throw existingErr;
              if (!existing || existing.length === 0) break;

              for (const e of existing) {
                if (!e.lesson_id) continue;
                countByLesson.set(e.lesson_id, (countByLesson.get(e.lesson_id) || 0) + 1);
              }

              if (existing.length < PAGE) break;
              from += PAGE;
            }
          }

          for (const lesson of allLessons) {
            const existingCount = countByLesson.get(lesson.id) || 0;
            // Only target lessons below the didactic minimum required by validator
            if (existingCount >= MIN_ITEMS_PER_LESSON) continue;
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
      // FIX: Use .limit(5000) to avoid Supabase 1000-row default limit
      const existingDrillSet = new Set<string>();
      for (let i = 0; i < compIdsAll.length; i += 200) {
        const chunk = compIdsAll.slice(i, i + 200);
        const { data: existingDrills } = await sb
          .from("minicheck_questions")
          .select("competency_id")
          .in("competency_id", chunk)
          .eq("curriculum_id", curriculumId)
          .eq("mode", effectiveMode)
          .limit(5000);
        for (const e of existingDrills || []) existingDrillSet.add(e.competency_id);
      }

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

    // ── BATCH ROUTING: Submit all targets as one batch instead of sync loop ──
    const forceSyncMode = p._force_sync === true || p.force_sync === true;
    if (shouldUseBatch("package_generate_lesson_minichecks", { forceSyncMode, itemCount: targets.length })) {
      const model = BATCH_DEFAULT_MODEL;
      const batchItems = targets.map((target, idx) => {
        const itemCount = target.lessonId ? ITEMS_PER_LESSON : ITEMS_PER_DRILL;
        const targetMode: "lesson" | "drill" = target.lessonId ? "lesson" : "drill";
        const { system, user } = buildMiniCheckPrompt(
          target.title, target.content, target.competencyTitle,
          itemCount, targetMode, professionName, pkgRow?.track,
        );
        const customId = `mc_${curriculumId.slice(0, 8)}_${(target.lessonId || target.competencyId || target.id).slice(0, 8)}_${idx}_${Date.now()}`;
        return {
          customId,
          sourceJobId: p.job_id || null,
          sourceRef: {
            lesson_id: target.lessonId,
            curriculum_id: curriculumId,
            competency_id: target.competencyId,
            package_id: packageId,
            mode: targetMode,
            profession_name: professionName,
            title: target.title,
          },
          jobType: "package_generate_lesson_minichecks",
          model,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          temperature: 0.4,
          maxTokens: 4000,
        };
      });

      const requests = buildBatchRequests(batchItems);
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

      const submitResult = await submitBatchViaFunction(supabaseUrl, serviceRoleKey, {
        jobType: "package_generate_lesson_minichecks",
        model,
        requests,
        metadata: {
          curriculum_id: curriculumId,
          package_id: packageId,
          target_count: String(targets.length),
          mode: effectiveMode,
        },
      });

      if (!submitResult.ok) {
        console.error(`[MiniChecks] BATCH_SUBMIT_FAILED: ${submitResult.error} — falling back to sync`);
        // Fall through to sync loop below
      } else {
        console.log(`[MiniChecks] BATCH_ENQUEUED: ${targets.length} targets → batch_id=${submitResult.batchId} model=${model}`);
        return json({
          ok: true,
          batch_mode: true,
          batch_id: submitResult.batchId,
          targets_submitted: targets.length,
          model,
          batch_complete: false,
        });
      }
    }

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
        professionName,
        pkgRow?.track,
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
          // Row-by-row insert with dedup guard (unique index rejects exact duplicates)
          let insertOk = 0;
          for (const row of validRows) {
            const { error: singleErr } = await sb.from("minicheck_questions").insert(row);
            if (singleErr) {
              if (singleErr.code === "23505") {
                console.log(`[MiniChecks] Dedup guard: duplicate skipped for ${target.id.slice(0, 8)}`);
              } else {
                console.warn(`[MiniChecks] Insert error: ${singleErr.message}`);
              }
            } else {
              insertOk++;
            }
          }
          totalGenerated += insertOk;
          if (insertOk === 0) totalFailed++;
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

    // batch_complete=false triggers runner re-enqueue
    // NOTE: will be overridden below if DB confirms freshRemaining === 0
    let batchComplete = !softStopped && totalFailed === 0 && !hasMore;

    // ── Fresh remaining_targets_after from DB (not estimated) ──
    let freshRemaining = 0;
    if (effectiveMode === "lesson" && effectiveCourseId) {
      // Re-run the same paginated count query post-inserts
      const { data: modules2 } = await sb.from("modules").select("id").eq("course_id", effectiveCourseId);
      const modIds2 = (modules2 || []).map((m: any) => m.id);
      if (modIds2.length > 0) {
        const { data: allL2 } = await sb
          .from("lessons").select("id, content, step")
          .in("module_id", modIds2)
          .not("content", "is", null)
          .neq("step", "mini_check");

        if (allL2?.length) {
          const lIds2 = allL2.filter(l => {
            const ct = typeof l.content === "string" ? l.content : JSON.stringify(l.content || {});
            return ct.length >= 200 && !ct.includes('"_placeholder":true') && !ct.includes('"_placeholder": true');
          }).map(l => l.id);

          const postCount = new Map<string, number>();
          for (let i = 0; i < lIds2.length; i += 200) {
            const chunk = lIds2.slice(i, i + 200);
            let from = 0;
            const PAGE = 1000;
            while (true) {
              const { data: rows } = await sb
                .from("minicheck_questions").select("lesson_id")
                .in("lesson_id", chunk)
                .eq("curriculum_id", curriculumId)
                .eq("mode", "lesson")
                .range(from, from + PAGE - 1);
              if (!rows || rows.length === 0) break;
              for (const r of rows) {
                if (!r.lesson_id) continue;
                postCount.set(r.lesson_id, (postCount.get(r.lesson_id) || 0) + 1);
              }
              if (rows.length < PAGE) break;
              from += PAGE;
            }
          }
          for (const lid of lIds2) {
            if ((postCount.get(lid) || 0) < MIN_ITEMS_PER_LESSON) freshRemaining++;
          }
        }
      }
    } else if (effectiveMode === "drill") {
      // Drill mode: count competencies without minichecks
      const { data: lfs2 } = await sb.from("learning_fields").select("id").eq("curriculum_id", curriculumId);
      const lfIds2 = (lfs2 || []).map((lf: any) => lf.id);
      if (lfIds2.length > 0) {
        const { data: allComps2 } = await sb.from("competencies").select("id").in("learning_field_id", lfIds2);
        const compIds2 = (allComps2 || []).map((c: any) => c.id);
        const coveredSet = new Set<string>();
        for (let i = 0; i < compIds2.length; i += 200) {
          const chunk = compIds2.slice(i, i + 200);
          const { data: covered } = await sb
            .from("minicheck_questions").select("competency_id")
            .in("competency_id", chunk)
            .eq("curriculum_id", curriculumId)
            .eq("mode", "drill")
            .limit(5000);
          for (const c of covered || []) coveredSet.add(c.competency_id);
        }
        freshRemaining = compIds2.filter((id: string) => !coveredSet.has(id)).length;
      }
    }

    // ── Override batchComplete if DB confirms no remaining targets ──
    if (freshRemaining === 0) {
      batchComplete = true;
      console.log(`[MiniChecks] ✅ DB confirms freshRemaining=0 → batchComplete overridden to true`);
    }

    // ── Progress Guard & Meta Logging ──
    const { data: stepRow } = await sb
      .from("package_steps").select("meta")
      .eq("package_id", packageId)
      .eq("step_key", "generate_lesson_minichecks")
      .maybeSingle();

    const prevMeta = (stepRow?.meta as Record<string, unknown>) ?? {};
    const prevRemaining = Number(prevMeta.remaining_targets_after ?? Infinity);
    const prevStallRuns = Number(prevMeta.stall_runs ?? 0);

    // Stall = remaining didn't decrease AND nothing was generated
    const isStalled = freshRemaining > 0 && freshRemaining >= prevRemaining && totalGenerated === 0;
    const stallRuns = isStalled ? prevStallRuns + 1 : 0;
    const MAX_STALL_RUNS = 3;

    const progressNote = totalGenerated > 0
      ? `${totalGenerated} generated, ${totalFailed} failed, remaining=${freshRemaining}, elapsed=${elapsed}ms`
      : `0 generated, remaining=${freshRemaining}, stall=${stallRuns}/${MAX_STALL_RUNS}, elapsed=${elapsed}ms`;

    const nextMeta: Record<string, unknown> = {
      ...prevMeta,
      last_progress_note: progressNote,
      remaining_targets_before: targetsFound,
      remaining_targets_after: freshRemaining,
      stall_runs: stallRuns,
      last_run_generated: totalGenerated,
      last_run_at: new Date().toISOString(),
    };

    // ── Stall escalation: block step instead of forcing false completion ──
    if (stallRuns >= MAX_STALL_RUNS) {
      console.error(`[MiniChecks] ⚠️ STALL BLOCKED: remaining=${freshRemaining} unchanged for ${stallRuns} runs`);
      nextMeta.stall_escalated = true;
      nextMeta.stall_escalated_at = new Date().toISOString();
      nextMeta.blocked_reason = `Stall: ${freshRemaining} lessons below minimum, no progress over ${stallRuns} runs`;

      // Set step to blocked — pipeline stops visibly, never silently passes
      await sb.from("package_steps")
        .update({ status: "blocked" })
        .eq("package_id", packageId)
        .eq("step_key", "generate_lesson_minichecks");
      await mergePackageStepMeta(sb, packageId, "generate_lesson_minichecks", nextMeta);

      return json({
        ok: false,
        batch_complete: false,
        stall_escalated: true,
        blocked: true,
        blocked_reason: nextMeta.blocked_reason,
        remaining_targets: freshRemaining,
        stall_runs: stallRuns,
        elapsed_ms: elapsed,
      });
    }

    await mergePackageStepMeta(sb, packageId, "generate_lesson_minichecks", nextMeta);

    return json({
      ok: true,
      batch_complete: batchComplete,
      mode: effectiveMode,
      generated: totalGenerated,
      failed: totalFailed,
      targets_found: targetsFound,
      targets_processed: targets.length,
      remaining_targets_after: freshRemaining,
      stall_runs: stallRuns,
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
