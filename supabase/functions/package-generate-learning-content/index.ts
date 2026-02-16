import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { callAIWithFailover, logLLMCostEvent, RateLimitError } from "../_shared/ai-client.ts";
import { getModelChainAsync } from "../_shared/model-routing.ts";
import { resolveProfession } from "../_shared/profession-resolver.ts";

/**
 * package-generate-learning-content — Pipeline Step
 *
 * Replaces placeholder lesson content with AI-generated, profession-specific
 * learning material. Writes to content_versions (Council write path).
 *
 * v4 changes:
 *   - Uses callAIWithFailover() for automatic provider rotation on 429s
 *   - Adaptive delay with exponential backoff after rate limits
 *   - Robust idempotency with ON CONFLICT handling
 */

const BATCH_SIZE = 8;
const BASE_DELAY_MS = 1200;   // 1.2s between calls (was 600ms — too aggressive)
const MAX_DELAY_MS = 8000;    // Max backoff

const STEP_PROMPTS: Record<string, { system: string; minChars: number }> = {
  einstieg: {
    system: `Erstelle eine **aktivierende Einstiegsaktivität** (ca. 800–1200 Zeichen HTML).
Struktur:
- <h3>Motivierender Titel</h3>
- Kurze Problemstellung oder Alltagsszenario das neugierig macht
- 2-3 Reflexionsfragen als <ul><li>
- Bezug zum Vorwissen`,
    minChars: 600,
  },
  verstehen: {
    system: `Erstelle **ausführliches Lernmaterial** (ca. 1500–2500 Zeichen HTML).
Struktur:
- <h3>Konzept-Titel</h3>
- Klare Definition und Erklärung der Kernkonzepte
- Mindestens 2 praxisnahe Beispiele
- Wichtige Fachbegriffe als <strong>
- Optionale Merksätze als <blockquote>
- Tabelle oder Liste zur Übersicht wenn sinnvoll`,
    minChars: 1200,
  },
  anwenden: {
    system: `Erstelle **praktische Übungsaufgaben** (ca. 1200–2000 Zeichen HTML).
Struktur:
- <h3>Praxis-Titel</h3>
- Realistische Arbeitssituation als Szenario
- 2-3 konkrete Aufgaben mit steigendem Schwierigkeitsgrad
- Hinweise zur Lösung (ohne Lösung zu verraten)
- Bezug zur beruflichen Praxis (IHK-relevant)`,
    minChars: 900,
  },
  wiederholen: {
    system: `Erstelle **Wiederholungsaktivitäten** (ca. 1000–1500 Zeichen HTML).
Struktur:
- <h3>Zusammenfassung & Wiederholung</h3>
- Die 5 wichtigsten Punkte als nummerierte Liste
- Lückentext oder Zuordnungsübung
- Eselsbrücken oder Merkhilfen
- Kurze Checkliste: "Ich kann jetzt..."`,
    minChars: 700,
  },
};

const CONTENT_TOOL = {
  type: "function" as const,
  function: {
    name: "create_lesson_content",
    description: "Erstelle strukturierten Lerninhalt für eine Lektion.",
    parameters: {
      type: "object",
      properties: {
        html: { type: "string", description: "HTML-Inhalt" },
        objectives: { type: "array", items: { type: "string" }, description: "2-4 Lernziele" },
      },
      required: ["html", "objectives"],
    },
  },
};

const MINICHECK_TOOL = {
  type: "function" as const,
  function: {
    name: "create_mini_check",
    description: "Erstelle 4 Multiple-Choice-Fragen zur Wissensüberprüfung.",
    parameters: {
      type: "object",
      properties: {
        questions: {
          type: "array", minItems: 4, maxItems: 4,
          items: {
            type: "object",
            properties: {
              question: { type: "string" },
              options: { type: "array", minItems: 4, maxItems: 4, items: { type: "string" } },
              correct_answer: { type: "integer", minimum: 0, maximum: 3 },
              explanation: { type: "string" },
            },
            required: ["question", "options", "correct_answer", "explanation"],
          },
        },
        objectives: { type: "array", items: { type: "string" } },
      },
      required: ["questions", "objectives"],
    },
  },
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

async function prereqDone(sb: ReturnType<typeof createClient>, packageId: string, stepKey: string) {
  // Check both step tables for compatibility (package_steps is authoritative)
  const { data: d1 } = await sb
    .from("package_steps").select("status")
    .eq("package_id", packageId).eq("step_key", stepKey).maybeSingle();
  if (d1?.status === "done") return true;
  const { data: d2 } = await sb
    .from("course_package_build_steps").select("status")
    .eq("package_id", packageId).eq("step_key", stepKey).maybeSingle();
  return d2?.status === "done";
}

async function existingVersion(sb: ReturnType<typeof createClient>, lessonId: string, step: string) {
  const { data } = await sb
    .from("content_versions")
    .select("id, content_json")
    .eq("lesson_id", lessonId)
    .eq("step_key", `step_${step}`)
    .eq("entity_type", step === "mini_check" ? "minicheck" : "lesson_step")
    .neq("status", "rejected")
    .limit(1)
    .maybeSingle();
  return data;
}

async function writeBackToLesson(
  sb: ReturnType<typeof createClient>,
  lessonId: string,
  contentJson: Record<string, unknown>,
) {
  const { error } = await sb.rpc("pipeline_write_lesson_content", {
    p_lesson_id: lessonId,
    p_content: { ...contentJson, _placeholder: false },
  });
  if (error) {
    console.error(`[gen-content] Lesson write-back failed for ${lessonId}: ${error.message}`);
    return false;
  }
  return true;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const body = await req.json().catch(() => ({}));
  const p = body.payload || body;

  const packageId = p.package_id;
  const courseId = p.course_id;
  const curriculumId = p.curriculum_id;
  const certificationId = p.certification_id || null;
  const batchCursor = p.batch_cursor || p._batch_cursor || null;

  if (!packageId || !curriculumId) {
    return json({ error: "Missing package_id or curriculum_id" }, 400);
  }

  if (!(await prereqDone(sb, packageId, "scaffold_learning_course"))) {
    return json({ ok: false, retry: true, error: "PREREQ_NOT_DONE: scaffold_learning_course" }, 409);
  }

  let professionName: string;
  try {
    const prof = await resolveProfession(sb, { certificationId, curriculumId });
    professionName = prof.professionName;
  } catch (e) {
    return json({ error: (e as Error).message }, 400);
  }

  const { data: allLessons, error: fetchErr } = await sb
    .from("lessons")
    .select("id, title, step, module_id, content, modules!inner(course_id, title)")
    .eq("modules.course_id", courseId)
    .order("id", { ascending: true });

  if (fetchErr) return json({ error: fetchErr.message }, 500);

  const placeholderLessons = (allLessons || []).filter((l: any) => {
    if (!l.content) return true;
    const c = l.content as Record<string, unknown>;
    if (c._placeholder === true || c._placeholder === "true") return true;
    if (typeof c.html === "string" && (c.html.includes("Platzhalter") || c.html.length < 100)) return true;
    return false;
  });

  const startIdx = batchCursor?.offset || 0;
  const batch = placeholderLessons.slice(startIdx, startIdx + BATCH_SIZE);
  const remaining = placeholderLessons.length - startIdx - batch.length;

  if (batch.length === 0) {
    return json({
      ok: true,
      batch_complete: true,
      message: `✅ Alle ${allLessons?.length || 0} Lektionen haben Inhalt.`,
      total_lessons: allLessons?.length || 0,
      placeholders_remaining: 0,
    });
  }

  console.log(`[gen-content] Processing ${batch.length}/${placeholderLessons.length} placeholder lessons (offset ${startIdx}) for ${professionName}`);

  const { data: topics } = await sb
    .from("curriculum_topics")
    .select("topic_name, difficulty_level, parent_topic_id")
    .eq("certification_id", curriculumId)
    .limit(200);

  const topicList = (topics || []).filter((t: any) => t.parent_topic_id).map((t: any) => t.topic_name);

  let generated = 0;
  let skippedWriteBack = 0;
  let failed = 0;
  let currentDelay = BASE_DELAY_MS;
  const details: any[] = [];

  for (const lesson of batch) {
    const isMiniCheck = lesson.step === "mini_check";
    const stepConfig = STEP_PROMPTS[lesson.step];
    const moduleName = (lesson as any).modules?.title || "";

    // ── Idempotency: check existing version ──
    const existing = await existingVersion(sb, lesson.id, lesson.step);
    if (existing) {
      const wrote = await writeBackToLesson(sb, lesson.id, existing.content_json as Record<string, unknown>);
      skippedWriteBack++;
      details.push({
        id: lesson.id, title: lesson.title, step: lesson.step,
        status: wrote ? "write_back" : "write_back_failed",
        versionId: existing.id,
      });
      continue;
    }

    const contextBlock = [
      `Beruf: ${professionName}`,
      `Modul: ${moduleName}`,
      `Lektion: ${lesson.title}`,
      topicList.length > 0 ? `Relevante Themen: ${topicList.slice(0, 10).join(", ")}` : "",
    ].filter(Boolean).join("\n");

    const userPrompt = isMiniCheck
      ? `Erstelle 4 IHK-Prüfungsfragen für ${professionName}.\n\n${contextBlock}\n\nExakt 4 Fragen, je 4 Optionen, plausible Distraktoren, didaktische Erklärungen.`
      : `${stepConfig?.system || STEP_PROMPTS.verstehen.system}\n\n${contextBlock}`;

    try {
      // ── Use failover chain instead of single provider ──
      const chain = await getModelChainAsync(isMiniCheck ? "minicheck" : "learning_content");

      const result = await callAIWithFailover(
        chain.map(c => ({ provider: c.provider, model: c.model })),
        {
          messages: [
            {
              role: "system",
              content: `Du bist IHK-Ausbildungsexperte für ${professionName}. Erstelle prüfungsrelevante, fachlich tiefe Lerninhalte auf Deutsch. Nutze IMMER die bereitgestellte Funktion. KEINE Platzhalter, KEINE generischen Texte.`,
            },
            { role: "user", content: userPrompt },
          ],
          tools: [isMiniCheck ? MINICHECK_TOOL : CONTENT_TOOL] as any,
          tool_choice: { type: "function", function: { name: isMiniCheck ? "create_mini_check" : "create_lesson_content" } },
          temperature: 0.7,
          max_tokens: isMiniCheck ? 4096 : 8192,
        },
      );

      // Parse tool call from failover result
      let content: any;
      if (result.toolCalls && result.toolCalls.length > 0) {
        content = JSON.parse(result.toolCalls[0].function.arguments);
      } else if (result.content) {
        try { content = JSON.parse(result.content); } catch { /* fallthrough */ }
      }
      if (!content || (!content.html && !content.questions)) {
        throw new Error("No parseable tool response from AI");
      }

      if (!isMiniCheck && (!content.html || content.html.length < (stepConfig?.minChars || 400))) {
        throw new Error(`Content too short: ${content.html?.length || 0} chars (min ${stepConfig?.minChars || 400})`);
      }

      const finalContent = isMiniCheck
        ? { type: "mini_check", questions: content.questions, objectives: content.objectives, generated_at: new Date().toISOString(), version: 3 }
        : { type: "text", html: content.html, objectives: content.objectives, generated_at: new Date().toISOString(), version: 3 };

      // Write to content_versions with upsert-like behavior
      const { data: newVersion, error: vErr } = await sb.from("content_versions").insert({
        course_id: courseId,
        lesson_id: lesson.id,
        step_key: `step_${lesson.step}`,
        content_json: finalContent,
        created_by_agent: "generate-learning-content",
        status: "under_review",
        council_round: 1,
        entity_type: isMiniCheck ? "minicheck" : "lesson_step",
      }).select("id").single();

      if (vErr) {
        // Handle duplicate key — likely a race condition retry
        if (vErr.message?.includes("idx_cv_idempotency") || vErr.code === "23505") {
          const existing2 = await existingVersion(sb, lesson.id, lesson.step);
          if (existing2) {
            await writeBackToLesson(sb, lesson.id, existing2.content_json as Record<string, unknown>);
            skippedWriteBack++;
            details.push({ id: lesson.id, title: lesson.title, step: lesson.step, status: "deduped", versionId: existing2.id });
            continue;
          }
        }
        throw vErr;
      }

      await writeBackToLesson(sb, lesson.id, finalContent);

      await sb.from("council_messages").insert({
        content_version_id: newVersion!.id,
        agent_name: "generate-learning-content",
        message_type: "proposal",
        message_json: { source: "pipeline-step", reason: "placeholder_replacement", profession: professionName, used_provider: result.provider, used_model: result.model },
      });

      await logLLMCostEvent(sb, {
        job_type: "generate_learning_content",
        provider: result.provider,
        model: result.model,
        tokens_in: result.usage?.input_tokens || 0,
        tokens_out: result.usage?.output_tokens || 0,
        cost_usd: ((result.usage?.input_tokens || 0) * 0.000003 + (result.usage?.output_tokens || 0) * 0.000015),
        package_id: packageId,
        certification_id: certificationId,
        course_id: courseId,
      });

      generated++;
      details.push({ id: lesson.id, title: lesson.title, step: lesson.step, status: "ok", versionId: newVersion!.id, provider: result.provider, model: result.model });

      // Success → reset delay toward base
      currentDelay = Math.max(BASE_DELAY_MS, currentDelay * 0.7);

    } catch (e) {
      failed++;
      const errMsg = (e as Error).message || String(e);
      console.error(`[gen-content] Failed lesson ${lesson.id}: ${errMsg}`);
      details.push({ id: lesson.id, title: lesson.title, step: lesson.step, status: "failed", error: errMsg });

      // Rate limit → exponential backoff
      if (e instanceof RateLimitError || errMsg.includes("Rate limit") || errMsg.includes("429")) {
        currentDelay = Math.min(currentDelay * 2, MAX_DELAY_MS);
        console.warn(`[gen-content] Backoff increased to ${currentDelay}ms`);
      }
    }

    // Adaptive delay between calls
    await new Promise(r => setTimeout(r, currentDelay));
  }

  const batchComplete = remaining <= 0;

  return json({
    ok: true,
    batch_complete: batchComplete,
    ...(batchComplete ? {} : { batch_cursor: { offset: startIdx + batch.length } }),
    generated,
    skipped_write_back: skippedWriteBack,
    failed,
    total_placeholders: placeholderLessons.length,
    remaining,
    details,
    message: batchComplete
      ? `✅ Alle Placeholder ersetzt. ${generated} generiert, ${skippedWriteBack} write-back.`
      : `🔄 Batch ${Math.floor(startIdx / BATCH_SIZE) + 1}: ${generated} generiert, ${skippedWriteBack} write-back, ${remaining} verbleibend.`,
  });
});
