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
- Konkretes Praxisszenario aus dem typischen ARBEITSALLTAG des Berufs — mit realistischen Akteuren (Kunden, Vorgesetzte, Kollegen), konkreten Zahlen und branchenüblichen Fachbegriffen
- 2-3 Reflexionsfragen als <ul><li> die zum Nachdenken anregen
- Bezug zum Vorwissen UND zur IHK-Prüfungsrelevanz
- PRÜFUNGSDRUCK-ELEMENT: "In der IHK-Prüfung wird dieses Thema häufig als Situationsaufgabe gestellt. Typische Falle: ..."
VERBOTEN: Generische Szenarien wie "in einem Unternehmen" oder "ein Mitarbeiter" ohne konkreten Berufsbezug.
PFLICHT: Verwende realistische, nicht-runde Zahlen (z.B. 12.450 €, 3,75 %, 47 Tage).`,
    minChars: 600,
  },
  verstehen: {
    system: `Erstelle **ausführliches Lernmaterial** (ca. 2500–4000 Zeichen HTML).
Struktur:
- <h3>Konzept-Titel</h3>
- Klare Definition und Erklärung der Kernkonzepte mit berufsspezifischen Beispielen
- Mindestens 3 praxisnahe Beispiele aus dem realen Berufsalltag (verschiedene Schwierigkeitsgrade)
- Wichtige Fachbegriffe als <strong> — erklärt wie im Berufsfeld tatsächlich verwendet
- Merksätze als <blockquote> mit ⭐ für prüfungsrelevante Inhalte
- Nach JEDER Erklärung ein Gegenbeispiel das typische Fehlannahmen verdeutlicht

RECHENAUFGABEN (PFLICHT bei quantitativen Themen):
- Vollständige Rechenwege mit Formeln: Formel → Einsetzen → Zwischenschritt → Ergebnis
- Realistische, nicht-runde Zahlen (z.B. 47.832,50 € statt 50.000 €)
- Mindestens 2 verschiedene Rechenbeispiele mit steigender Komplexität
- Ergebnis IMMER mit Interpretation: "Was bedeutet dieses Ergebnis für die Praxis?"

REGULATORIK (PFLICHT bei rechtlichen Themen):
- Konkrete §§-Referenzen (BGB, HGB, AO, UStG, DSGVO, BetrVG, BBiG etc.)
- Fristen und Termine explizit nennen
- Typische Prüfungsfrage zu diesem § als Beispiel

IHK-PRÜFUNGSBEZUG (PFLICHT):
- ⭐ "IHK-Prüfungstipp: ..." mindestens 2x pro Lektion
- "Typische Prüfungsfalle: ..." mindestens 1x
- "Achten Sie in der Prüfung besonders auf: ..."
- Abgrenzungstabelle: Ähnliche Begriffe die verwechselt werden (als <table>)

VERBOTEN: Akademische Definitionen ohne Praxisbezug. Oberflächliches Anreißen. Weniger als 2 Rechenbeispiele bei quantitativen Themen.`,
    minChars: 1800,
  },
  anwenden: {
    system: `Erstelle ein **Entscheidungsszenario mit Fallstudie** (ca. 1800–3000 Zeichen HTML) — KEINE reine Beschreibung.
Struktur:
- <h3>Fallstudie: [konkreter Titel mit Namen/Firma]</h3>
- Konkretes Fallbeispiel mit realistischen Zahlen, Namen und Kontexten aus dem Berufsalltag
- SITUATION: Detaillierte Ausgangslage mit allen relevanten Daten (Zahlen, Termine, Beteiligte)
- AUFGABE: 3-4 konkrete Teilaufgaben mit steigender Komplexität
- Mindestens 2 Entscheidungsoptionen mit fachlicher Abwägung der Vor- und Nachteile

RECHENAUFGABEN (PFLICHT bei quantitativen Themen):
- Mehrstufige Berechnungen (z.B. Angebotsvergleich mit Rabatt + Skonto + Bezugskosten, nicht nur einfache Addition)
- Alle Rechenwege vollständig ausformuliert
- Interpretation des Ergebnisses: "Welche Handlungsempfehlung ergibt sich?"

ENTSCHEIDUNGSLOGIK (PFLICHT):
- Pro-Contra-Tabelle für mindestens 2 Optionen
- Begründung der optimalen Entscheidung mit Fachbegriffen
- "Was wäre passiert, wenn Sie sich anders entschieden hätten?" (Konsequenz-Analyse)

PRÜFUNGSFALLEN:
- ⚠️ Typische Prüfungsfallen mit Erklärung markiert
- "Viele Prüflinge machen hier den Fehler, dass..."
- "Der IHK-Prüfer erwartet, dass Sie..."

Der Lernende muss die Entscheidung TREFFEN und fachlich BEGRÜNDEN.
VERBOTEN: Reine Beschreibungen. Isolierte Einzelaspekte statt Kombinationsaufgaben.`,
    minChars: 1400,
  },
  wiederholen: {
    system: `Erstelle eine **PRÜFUNGSVERDICHTUNG** (ca. 1500–2200 Zeichen HTML) — KEINE erneute Erklärung.
Struktur:
- <h3>Prüfungsverdichtung</h3>

MERKSÄTZE (PFLICHT):
- 5-7 kompakte Merksätze mit den Fachbegriffen wie sie in der IHK-Prüfung erwartet werden
- Bei §§-Themen: "Merke: § [Nr] [Gesetz] regelt [was] → Frist: [Tage/Monate]"
- Bei Rechnen: Formeln als Merksatz mit Beispielzahlen

PRÜFUNGSFALLEN (PFLICHT, mindestens 4):
- "Falle 1: [Fehler] → Richtig ist: [Korrektur] → Warum: [Begründung]"
- Typische Verwechslungen die in der IHK-Prüfung vorkommen
- Falsche Rechenwege die Prüflinge häufig wählen

ABGRENZUNGSTABELLE (PFLICHT):
- <table> mit Vergleich ähnlicher Begriffe/Konzepte (mind. 3 Zeilen)
- Spalten: Begriff | Definition | Beispiel | Prüfungsrelevanz

TRANSFERÜBUNGEN (PFLICHT, mindestens 2):
- "Aufgabe: Formulieren Sie die Antwort auf folgende IHK-Prüfungsfrage: ..."
- "Musterlösung: ..." (in IHK-Prüfungssprache)

PRÜFER-HINWEIS:
- "Was IHK-Prüfer besonders gern nachfragen: ..."
- "Zeitmanagement: Für diese Aufgabe haben Sie ca. X Minuten. Teilen Sie sich die Zeit so ein: ..."

VERBOTEN: Erneute Erklärung des Stoffes. NUR Verdichtung und Prüfungsvorbereitung.`,
    minChars: 1200,
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

  // NOTE: Don't use offset-based cursors — placeholder list shifts as content is generated.
  // Instead, always take the first BATCH_SIZE placeholders (idempotent via existingVersion check).
  const batch = placeholderLessons.slice(0, BATCH_SIZE);
  const remaining = placeholderLessons.length - batch.length;

  if (batch.length === 0) {
    // HARD GUARD: Re-query DB to confirm zero placeholders (don't trust in-memory filter alone)
    // NOTE: Can't use cross-table filter with .or() in Supabase, so fetch module IDs first
    const { data: courseModules } = await sb
      .from("modules")
      .select("id")
      .eq("course_id", courseId);
    const moduleIds = (courseModules || []).map((m: { id: string }) => m.id);

    let truePlaceholders = 0;
    if (moduleIds.length > 0) {
      const { count: nullCount } = await sb
        .from("lessons")
        .select("id", { count: "exact", head: true })
        .in("module_id", moduleIds)
        .is("content", null);
      const { count: phCount } = await sb
        .from("lessons")
        .select("id", { count: "exact", head: true })
        .in("module_id", moduleIds)
        .contains("content", { _placeholder: true });
      truePlaceholders = (nullCount ?? 0) + (phCount ?? 0);
    }

    if (truePlaceholders > 0) {
      console.warn(`[gen-content] In-memory filter found 0 but DB has ${truePlaceholders} placeholders — re-queue`);
      return json({
        ok: true,
        batch_complete: false,
        batch_cursor: { offset: 0 },
        message: `🔄 ${truePlaceholders} Placeholder verbleibend — erneut versuchen.`,
        total_lessons: allLessons?.length || 0,
        placeholders_remaining: truePlaceholders,
      });
    }

    return json({
      ok: true,
      batch_complete: true,
      message: `✅ Alle ${allLessons?.length || 0} Lektionen haben Inhalt.`,
      total_lessons: allLessons?.length || 0,
      placeholders_remaining: 0,
    });
  }

  console.log(`[gen-content] Processing ${batch.length}/${placeholderLessons.length} placeholder lessons for ${professionName}`);

  const { data: topics } = await sb
    .from("curriculum_topics")
    .select("topic_name, difficulty_level, parent_topic_id")
    .eq("certification_id", curriculumId)
    .limit(200);

  const topicList = (topics || []).filter((t: any) => t.parent_topic_id).map((t: any) => t.topic_name);

  // ── Load LF weighting & IHK focus for enriched prompts ──
  const { data: lfWeights } = await sb
    .from("learning_fields")
    .select("id, title, code, weight_percent, exam_part, difficulty_tier, ihk_focus_areas")
    .eq("curriculum_id", curriculumId);
  const lfMap = new Map((lfWeights || []).map((lf: any) => [lf.title, lf]));

  // ── Load module→LF mapping for enrichment ──
  const { data: modulesMeta } = await sb
    .from("modules")
    .select("id, title, learning_field_id")
    .eq("course_id", courseId);
  const moduleLfMap = new Map((modulesMeta || []).map((m: any) => [m.id, m.learning_field_id]));

  let generated = 0;
  let skippedWriteBack = 0;
  let failed = 0;
  let currentDelay = BASE_DELAY_MS;
  const details: any[] = [];

  for (const lesson of batch) {
    const isMiniCheck = lesson.step === "mini_check";
    const stepConfig = STEP_PROMPTS[lesson.step];
    const moduleName = (lesson as any).modules?.title || "";

    // ── Resolve LF context for this lesson ──
    const lfId = moduleLfMap.get(lesson.module_id);
    const lfData = lfId ? (lfWeights || []).find((lf: any) => lf.id === lfId) : (lfMap.get(moduleName) || null);
    const lfContext = lfData ? [
      `Lernfeld: ${lfData.code} – ${lfData.title}`,
      `Prüfungsgewichtung: ${lfData.weight_percent}%`,
      `Prüfungsteil: ${lfData.exam_part === 'teil_1' ? 'Teil 1 (Informationstechnisches Büromanagement)' : lfData.exam_part === 'teil_2' ? 'Teil 2 (Kundenbeziehungsprozesse / Wirtschaft & Steuerung)' : 'Teil 1 + Teil 2'}`,
      `Schwierigkeitsstufe: ${lfData.difficulty_tier}`,
      Array.isArray(lfData.ihk_focus_areas) && lfData.ihk_focus_areas.length > 0 ? `IHK-Schwerpunkte: ${lfData.ihk_focus_areas.join(", ")}` : "",
    ].filter(Boolean).join("\n") : "";

    const contextBlock = [
      `Beruf: ${professionName}`,
      `Modul: ${moduleName}`,
      `Lektion: ${lesson.title}`,
      lfContext,
      topicList.length > 0 ? `Relevante Themen: ${topicList.slice(0, 10).join(", ")}` : "",
    ].filter(Boolean).join("\n");

    const userPrompt = isMiniCheck
      ? `Erstelle 4 IHK-Prüfungsfragen für ${professionName}.\n\n${contextBlock}\n\nExakt 4 Fragen, je 4 Optionen, plausible Distraktoren, didaktische Erklärungen.`
      : `${stepConfig?.system || STEP_PROMPTS.verstehen.system}\n\n${contextBlock}`;

    try {
      // ── Use failover chain instead of single provider ──
      const chain = await getModelChainAsync(isMiniCheck ? "minicheck" : "learning_course");

      const result = await callAIWithFailover(
        chain.map(c => ({ provider: c.provider, model: c.model })),
        {
          messages: [
            {
              role: "system",
              content: `Du bist ein erfahrener IHK-Fachexperte mit 20 Jahren Berufserfahrung als ${professionName}. Du erstellst Lerninhalte die sich anfühlen, als wären sie von einem Fachlehrer geschrieben — NICHT von einer KI.

QUALITÄTSSTANDARD:
- Jeder Lernschritt MUSS die fachliche Tiefe des offiziellen Rahmenplans abbilden
- Praxisbeispiele MÜSSEN aus dem typischen Arbeitsalltag stammen — mit realistischen Kunden, Produkten, Zahlen
- Bei regulatorischen Themen: IMMER konkrete §§-Referenzen, Fristen, Aufsichtsbehörden nennen
- Bei Rechenthemen: IMMER vollständige Rechenwege mit realistischen (nicht-runden) Zahlen
- Kombinationsaufgaben bevorzugen (mehrere Konzepte verknüpfen)
- Markiere prüfungsrelevante Stellen mit ⭐

PRÜFUNGSDRUCK-ELEMENTE (PFLICHT in jedem Lernschritt):
- Mindestens 1x "⭐ IHK-Prüfungstipp: ..." pro Lektion
- Mindestens 1x "⚠️ Typische Prüfungsfalle: ..." pro Lektion
- Bei Rechenthemen: "Zeitmanagement: Für diese Aufgabe ~X Min einplanen"
- Transferfrage am Ende: "Wie würde sich die Situation ändern, wenn...?"
${lfData?.difficulty_tier === 'hard' ? '\nERHÖHTE SCHWIERIGKEIT (dieses Lernfeld ist prüfungskritisch!):\n- Mehrstufige Berechnungen mit mindestens 3 Rechenschritten\n- Kombinationsaufgaben aus mindestens 2 Themengebieten\n- Entscheidungsszenarien mit Pro-Contra-Analyse\n- Regulatorische Querverweise zwischen §§' : ''}
${lfData?.ihk_focus_areas?.length ? `\nIHK-SCHWERPUNKTE für dieses Lernfeld: ${lfData.ihk_focus_areas.join(", ")}\nBaue diese Schwerpunkte gezielt in Beispiele und Übungen ein.` : ''}

ANTI-KI-REGELN:
- KEINE Sätze wie "In der heutigen Geschäftswelt..." oder "Es ist wichtig zu verstehen, dass..."
- KEINE generischen Aufzählungen ohne konkreten Berufsbezug
- Schreibe so, wie ein erfahrener Ausbilder im Betrieb einem Azubi etwas erklärt

Nutze IMMER die bereitgestellte Funktion. KEINE Platzhalter.`,
            },
            { role: "user", content: userPrompt },
          ],
          tools: [isMiniCheck ? MINICHECK_TOOL : CONTENT_TOOL] as any,
          tool_choice: { type: "function", function: { name: isMiniCheck ? "create_mini_check" : "create_lesson_content" } },
          // temperature omitted — GPT-5 only supports default (1)
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

  // NEVER mark batch_complete unless ALL placeholders are resolved
  const batchComplete = remaining <= 0 && failed === 0;

  return json({
    ok: true,
    batch_complete: batchComplete,
    // Always re-queue if there are remaining OR if any failed (retry next cycle)
    ...(!batchComplete ? { batch_cursor: { offset: 0 } } : {}),
    generated,
    skipped_write_back: skippedWriteBack,
    failed,
    total_placeholders: placeholderLessons.length,
    remaining,
    details,
    message: batchComplete
      ? `✅ Alle Placeholder ersetzt. ${generated} generiert, ${skippedWriteBack} write-back.`
      : `🔄 ${generated} generiert, ${skippedWriteBack} write-back, ${remaining} verbleibend.`,
  });
});
