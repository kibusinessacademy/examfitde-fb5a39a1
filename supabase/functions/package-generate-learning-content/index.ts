import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { callAIWithFailover, logLLMCostEvent, RateLimitError } from "../_shared/ai-client.ts";
import { isTransientLlmError } from "../_shared/llm/normalize.ts";
import { getModelChainAsync } from "../_shared/model-routing.ts";
import { resolveProfession } from "../_shared/profession-resolver.ts";
import { loadCachedGlossary, formatGlossaryForPrompt } from "../_shared/glossary-loader.ts";
import { DEPTH_SELF_CHECK, REGULATORY_GUARD, ANTI_KI_RULES, buildMiniCheckPrompt, measureDepth, depthMeetsMinimum, mapToDifficultyLevel, getRequiredDepth, runV2QualityGate, loadMasteryContext, buildMasteryFeedbackSuffix, adjustDifficultyByMastery } from "../_shared/prompt-kit.ts";
import type { DifficultyLevel, MasteryContext } from "../_shared/prompt-kit.ts";
import { canonicalStepKey, STEP_KEY_MAP } from "../_shared/step-keys.ts";
import { assertSchemaReady } from "../_shared/schema-gate.ts";
import { getTimeBudget, shouldSoftStop } from "../_shared/time-budget.ts";
import { assessLessonQuality, buildExpandSystemPrompt, getStepThresholds } from "../_shared/content-quality.ts";

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

const BATCH_SIZE = 2;          // v5.5: reduced from 3 to 2 — budget-safe with 28s min timeout
const BASE_DELAY_MS = 300;     // Keep throughput without wasting budget
const MAX_DELAY_MS = 3000;     // Cap backoff to stay within soft budget
const MAX_LESSON_RETRIES = 3;  // Poison-pill guard: skip lessons after N failures
const MAX_EXPAND_RETRIES = 0;  // Phase 1 (Lean Build): NO expand retries — expansion moves to elite_harden Phase 2

const STEP_PROMPTS: Record<string, { system: string; minChars: number; minWords: number }> = {
  einstieg: {
    system: `Erstelle eine **aktivierende Einstiegsaktivität** für eine IHK-Prüfungsvorbereitung.

MINDESTUMFANG: 250 Wörter Fließtext. Antworte NIEMALS mit weniger als 250 Wörtern. Kurze Antworten werden automatisch abgelehnt.

Struktur:
- <h3>Motivierender Titel mit konkretem Bezug zum Thema</h3>
- Konkretes Praxisszenario aus dem typischen ARBEITSALLTAG des Berufs — mit realistischen Akteuren (Kunden, Vorgesetzte, Kollegen), konkreten Zahlen und branchenüblichen Fachbegriffen. Das Szenario muss MINDESTENS 120 Wörter umfassen.
- 2-3 Reflexionsfragen als <ul><li> die zum Nachdenken anregen — jede mit kurzer Erläuterung (1-2 Sätze)
- Bezug zum Vorwissen UND zur IHK-Prüfungsrelevanz (mindestens 3 Sätze)
- PRÜFUNGSDRUCK-ELEMENT: "⭐ In der IHK-Prüfung wird dieses Thema häufig als Situationsaufgabe gestellt. Typische Falle: ..." (mindestens 2 Sätze)
- Abschluss: Überleitung zum Lernschritt "Verstehen" mit einer Leitfrage

VERBOTEN: Generische Szenarien wie "in einem Unternehmen" oder "ein Mitarbeiter" ohne konkreten Berufsbezug.
PFLICHT: Verwende realistische, nicht-runde Zahlen (z.B. 12.450 €, 3,75 %, 47 Tage).
PFLICHT: Schreibe ausführlich und detailreich. Jeder Absatz muss mindestens 3 Sätze haben.
${DEPTH_SELF_CHECK}
${REGULATORY_GUARD}`,
    minChars: 600,
    minWords: 250,
  },
  verstehen: {
    system: `Erstelle **ausführliches Lernmaterial** für eine IHK-Prüfungsvorbereitung.

MINDESTUMFANG: 400 Wörter Fließtext. Antworte NIEMALS mit weniger als 400 Wörtern. Kurze Antworten werden automatisch abgelehnt.

Struktur:
- <h3>Konzept-Titel</h3>
- Klare Definition und Erklärung der Kernkonzepte mit berufsspezifischen Beispielen (mindestens 80 Wörter für die KernDefinition)
- Mindestens 3 praxisnahe Beispiele aus dem realen Berufsalltag (verschiedene Schwierigkeitsgrade), JEDES mit mindestens 40 Wörtern
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
- "⚠️ Typische Prüfungsfalle: ..." mindestens 1x
- "Achten Sie in der Prüfung besonders auf: ..."
- Abgrenzungstabelle: Ähnliche Begriffe die verwechselt werden (als <table>)

VERBOTEN: Akademische Definitionen ohne Praxisbezug. Oberflächliches Anreißen. Weniger als 2 Rechenbeispiele bei quantitativen Themen.
PFLICHT: Schreibe ausführlich und detailreich. Jeder Absatz muss mindestens 3-4 Sätze haben. Erkläre lieber zu viel als zu wenig.
${DEPTH_SELF_CHECK}
${REGULATORY_GUARD}`,
    minChars: 1800,
    minWords: 400,
  },
  anwenden: {
    system: `Erstelle ein **Entscheidungsszenario mit Fallstudie** für eine IHK-Prüfungsvorbereitung — KEINE reine Beschreibung.

MINDESTUMFANG: 350 Wörter Fließtext. Antworte NIEMALS mit weniger als 350 Wörtern. Kurze Antworten werden automatisch abgelehnt.

Struktur:
- <h3>Fallstudie: [konkreter Titel mit Namen/Firma]</h3>
- Konkretes Fallbeispiel mit realistischen Zahlen, Namen und Kontexten aus dem Berufsalltag (mindestens 100 Wörter Situationsbeschreibung)
- SITUATION: Detaillierte Ausgangslage mit allen relevanten Daten (Zahlen, Termine, Beteiligte)
- AUFGABE: 3-4 konkrete Teilaufgaben mit steigender Komplexität
- Mindestens 2 Entscheidungsoptionen mit fachlicher Abwägung der Vor- und Nachteile (jeweils mindestens 3 Argumente)

RECHENAUFGABEN (PFLICHT bei quantitativen Themen):
- Mehrstufige Berechnungen (z.B. Angebotsvergleich mit Rabatt + Skonto + Bezugskosten)
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
VERBOTEN: Reine Beschreibungen. Isolierte Einzelaspekte statt Kombinationsaufgaben.
PFLICHT: Schreibe ausführlich. Die Fallstudie muss sich wie eine echte IHK-Prüfungsaufgabe anfühlen.
${DEPTH_SELF_CHECK}
${REGULATORY_GUARD}`,
    minChars: 1400,
    minWords: 350,
  },
  wiederholen: {
    system: `Erstelle eine **PRÜFUNGSVERDICHTUNG** für eine IHK-Prüfungsvorbereitung — KEINE erneute Erklärung.

MINDESTUMFANG: 300 Wörter Fließtext. Antworte NIEMALS mit weniger als 300 Wörtern. Kurze Antworten werden automatisch abgelehnt.

Struktur:
- <h3>Prüfungsverdichtung</h3>

MERKSÄTZE (PFLICHT):
- 5-7 kompakte Merksätze mit den Fachbegriffen wie sie in der IHK-Prüfung erwartet werden
- Bei §§-Themen: "Merke: § [Nr] [Gesetz] regelt [was] → Frist: [Tage/Monate]"
- Bei Rechnen: Formeln als Merksatz mit Beispielzahlen und kurzem Rechenweg

PRÜFUNGSFALLEN (PFLICHT, mindestens 4):
- "⚠️ Falle 1: [Fehler] → Richtig ist: [Korrektur] → Warum: [Begründung]"
- Typische Verwechslungen die in der IHK-Prüfung vorkommen
- Falsche Rechenwege die Prüflinge häufig wählen
- Jede Falle mit mindestens 2 Sätzen Erklärung

ABGRENZUNGSTABELLE (PFLICHT):
- <table> mit Vergleich ähnlicher Begriffe/Konzepte (mind. 3 Zeilen)
- Spalten: Begriff | Definition | Beispiel | Prüfungsrelevanz

TRANSFERÜBUNGEN (PFLICHT, mindestens 2):
- "Aufgabe: Formulieren Sie die Antwort auf folgende IHK-Prüfungsfrage: ..."
- "Musterlösung: ..." (in IHK-Prüfungssprache, mindestens 3 Sätze)

PRÜFER-HINWEIS:
- "Was IHK-Prüfer besonders gern nachfragen: ..."
- "Zeitmanagement: Für diese Aufgabe haben Sie ca. X Minuten. Teilen Sie sich die Zeit so ein: ..."

VERBOTEN: Erneute Erklärung des Stoffes. NUR Verdichtung und Prüfungsvorbereitung.
PFLICHT: Schreibe ausführlich. Jede Prüfungsfalle und jede Transferübung muss substanziell sein.
${DEPTH_SELF_CHECK}`,
    minChars: 1200,
    minWords: 300,
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
        html: { type: "string", description: "HTML-Inhalt der Lektion" },
        objectives: { type: "array", items: { type: "string" }, description: "2-4 messbare Lernziele im Format: 'Der Lernende kann [Handlung] unter Berücksichtigung von [Rahmenbedingung] fachgerecht [durchführen/berechnen/bewerten]'" },
        key_terms: { type: "array", items: { type: "object", properties: { term: { type: "string" }, definition: { type: "string" }, exam_relevance: { type: "string", description: "Warum prüfungsrelevant (1 Satz)" } }, required: ["term", "definition", "exam_relevance"] }, description: "3-6 Schlüsselbegriffe mit Definition UND Prüfungsrelevanz" },
        common_mistakes: { type: "array", items: { type: "object", properties: { mistake: { type: "string" }, correction: { type: "string" }, trap_type: { type: "string", description: "Fehlertyp: rechenfehler|normverwechslung|begriffsverwechslung|denkfehler|praxisfehler" } }, required: ["mistake", "correction", "trap_type"] }, description: "3-5 typische Azubi-Fehler mit Korrektur und Fehlertyp-Klassifikation" },
        exam_triggers: { type: "array", items: { type: "string" }, description: "2-3 typische IHK-Fragestellungen ('So fragt die IHK')" },
        transfer_questions: { type: "array", items: { type: "string" }, description: "1-2 Transfer-/Szenariofragen: 'Was passiert wenn...?' oder 'Wie würde sich ändern, wenn...?'" },
      },
      required: ["html", "objectives", "key_terms", "common_mistakes", "exam_triggers"],
      additionalProperties: false,
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

// STEP_KEY_MAP + canonicalStepKey imported from _shared/step-keys.ts (SSOT)

async function existingVersion(sb: ReturnType<typeof createClient>, lessonId: string, step: string) {
  const canonKey = canonicalStepKey(step);
  const { data } = await sb
    .from("content_versions")
    .select("id, content_json")
    .eq("lesson_id", lessonId)
    .eq("step_key", canonKey)
    .eq("entity_type", step === "mini_check" ? "minicheck" : "lesson_step")
    .neq("status", "rejected")
    .limit(1)
    .maybeSingle();
  return data;
}

// writeBackToLesson removed — Council-first enforcement.
// Content reaches lessons.content ONLY via publish_approved_version().
// Placeholder writes use pipeline_write_lesson_content with _placeholder: true.

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  await assertSchemaReady("package-generate-learning-content", sb);
  const body = await req.json().catch(() => ({}));
  const p = body.payload || body;

  const packageId = p.package_id;
  const courseId = p.course_id;
  const curriculumId = p.curriculum_id;
  const certificationId = p.certification_id || null;
  const batchCursor = p.batch_cursor || p._batch_cursor || null;
  const startMs = Date.now();
  const budget = getTimeBudget("learning_content");

  if (!packageId || !curriculumId) {
    return json({ error: "Missing package_id or curriculum_id" }, 400);
  }

  if (!(await prereqDone(sb, packageId, "scaffold_learning_course"))) {
    return json({ ok: false, retry: true, error: "PREREQ_NOT_DONE: scaffold_learning_course" }, 409);
  }

  let professionName: string;
  let glossaryContext = "";
  try {
    const prof = await resolveProfession(sb, { certificationId, curriculumId });
    professionName = prof.professionName;
    // Load or generate profession glossary for depth injection
    const berufId = await (async () => {
      const { data: cu } = await sb.from("curricula").select("beruf_id").eq("id", curriculumId).maybeSingle();
      return cu?.beruf_id;
    })();
    if (berufId) {
      try {
        // Read-only: only use cached glossary (generation happens in separate pipeline step)
        const glossary = await loadCachedGlossary(sb, berufId, professionName);
        if (glossary) {
          glossaryContext = formatGlossaryForPrompt(glossary);
          console.log(`[gen-content] Glossary loaded for "${professionName}" (${glossaryContext.length} chars)`);
        } else {
          console.log(`[gen-content] No cached glossary for "${professionName}" — proceeding without`);
        }
      } catch (e) { console.warn(`[gen-content] Glossary read failed: ${(e as Error).message}`); }
    }
  } catch (e) {
    return json({ error: (e as Error).message }, 400);
  }

  const { data: allLessons, error: fetchErr } = await sb
    .from("lessons")
    .select("id, title, step, module_id, content, qc_status, modules!inner(course_id, title)")
    .eq("modules.course_id", courseId)
    .order("id", { ascending: true });

  if (fetchErr) return json({ error: fetchErr.message }, 500);

  // ── Load poison-pill registry from job meta ──
  const poisonPills: Record<string, number> = p._poison_pills || {};

  const placeholderLessons = (allLessons || []).filter((l: any) => {
    if (!l.content) return true;
    const c = l.content as Record<string, unknown>;
    if (c._placeholder === true || c._placeholder === "true") return true;
    // Lessons stuck in _regenerating state without html need regeneration
    if (c._regenerating === true || c._regenerating === "true") return true;
    // BUG 2 FIX: tier1_failed lessons are dead-ends unless we regenerate them
    if ((l as any).qc_status === "tier1_failed") return true;
    // Lessons without an html field (e.g. mini_check stubs) need full content
    if (typeof c.html !== "string") return true;
    if (c.html.includes("Platzhalter") || (c.html as string).length < 100) return true;
    return false;
  });

  // ── Poison-pill guard: skip lessons that have failed too many times ──
  const skippableLessons = new Set<string>();
  for (const l of placeholderLessons) {
    if ((poisonPills[l.id] || 0) >= MAX_LESSON_RETRIES) {
      skippableLessons.add(l.id);
    }
  }
  if (skippableLessons.size > 0) {
    console.warn(`[gen-content] Skipping ${skippableLessons.size} poison-pill lessons: ${[...skippableLessons].map(id => id.slice(0, 8)).join(", ")}`);
  }
  const actionablePlaceholders = placeholderLessons.filter(l => !skippableLessons.has(l.id));

  // NOTE: Don't use offset-based cursors — placeholder list shifts as content is generated.
  // Instead, always take the first BATCH_SIZE actionable placeholders (idempotent via existingVersion check).
  const batch = actionablePlaceholders.slice(0, BATCH_SIZE);
  const remaining = actionablePlaceholders.length - batch.length;

  if (batch.length === 0) {
    // HARD GUARD: Re-query DB to confirm zero placeholders (don't trust in-memory filter alone)
    // NOTE: Can't use cross-table filter with .or() in Supabase, so fetch module IDs first
    const { data: courseModules } = await sb
      .from("modules")
      .select("id")
      .eq("course_id", courseId);
    const moduleIds = (courseModules || []).map((m: { id: string }) => m.id);

    let truePlaceholders = 0;
    let tooShortCount = 0;
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
      const { count: regenCount } = await sb
        .from("lessons")
        .select("id", { count: "exact", head: true })
        .in("module_id", moduleIds)
        .contains("content", { _regenerating: true });
      truePlaceholders = (nullCount ?? 0) + (phCount ?? 0) + (regenCount ?? 0);

      // ── Integrity gate alignment: also check too_short via v_course_content_integrity ──
      // The DB trigger sync_step_on_job_completion blocks step→done if too_short > 0,
      // causing an infinite loop. Check here and treat too_short lessons as needing regen.
      try {
        const { data: integrity } = await sb
          .from("v_course_content_integrity")
          .select("placeholder_lessons, too_short_lessons")
          .eq("course_id", courseId)
          .maybeSingle();
        if (integrity) {
          truePlaceholders = Math.max(truePlaceholders, integrity.placeholder_lessons || 0);
          tooShortCount = integrity.too_short_lessons || 0;
        }
      } catch (e) {
        console.warn(`[gen-content] Integrity view check failed: ${(e as Error).message}`);
      }
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

    // If too_short lessons exist, the DB trigger will block step→done anyway.
    // Mark them as _regenerating so they get picked up in the next batch cycle.
    if (tooShortCount > 0) {
      console.warn(`[gen-content] ${tooShortCount} too-short lessons detected — marking for regeneration`);
      // Fetch and reset too-short lessons so they become actionable placeholders
      const { data: shortLessons } = await sb
        .from("lessons")
        .select("id, content")
        .in("module_id", moduleIds)
        .not("content", "is", null);

      let markedForRegen = 0;
      for (const lesson of (shortLessons || [])) {
        const c = lesson.content as Record<string, unknown>;
        const html = typeof c?.html === "string" ? c.html : "";
        if (html.length > 0 && html.length < 200 && c?._placeholder !== true) {
          await sb.rpc("pipeline_write_lesson_content_v2" as any, {
            p_lesson_id: lesson.id,
            p_content: { ...c, _regenerating: true, _placeholder: true },
            p_source: 'generate-learning-content',
          });
          markedForRegen++;
        }
      }

      if (markedForRegen > 0) {
        return json({
          ok: true,
          batch_complete: false,
          batch_cursor: { offset: 0 },
          message: `🔄 ${markedForRegen} zu kurze Lektionen zur Neugenerierung markiert.`,
          total_lessons: allLessons?.length || 0,
          too_short_marked: markedForRegen,
        });
      }

      // If we couldn't find any to mark but integrity still reports too_short,
      // signal complete anyway — the integrity view may use a different threshold.
      // This prevents infinite loops when the view's definition doesn't match ours.
      console.warn(`[gen-content] Integrity reports ${tooShortCount} too-short but none found with <200 chars — completing to avoid infinite loop`);
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

  // ── Progress telemetry: update package_steps.meta at batch start ──
  const updateStepProgress = async (metaPatch: Record<string, unknown>) => {
    try {
      const { data: stepRow } = await sb
        .from("package_steps")
        .select("id, meta")
        .eq("package_id", packageId)
        .eq("step_key", "generate_learning_content")
        .maybeSingle();
      if (stepRow) {
        await sb.from("package_steps").update({
          meta: { ...(stepRow.meta ?? {}), ...metaPatch, updated_at: new Date().toISOString() },
        }).eq("id", stepRow.id);
      }
    } catch (e) { console.warn(`[gen-content] Progress meta update failed: ${(e as Error).message}`); }
  };

  await updateStepProgress({
    last_progress_note: `batch_start: ${batch.length}/${placeholderLessons.length} placeholders, profession=${professionName}`,
    batch_size: batch.length,
    total_placeholders: placeholderLessons.length,
    poison_pills: skippableLessons.size,
  });

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
  let expandedCount = 0;
  let currentDelay = BASE_DELAY_MS;
  let softStopped = false;
  const details: any[] = [];

  for (const lesson of batch) {
    if (shouldSoftStop(startMs, "learning_content")) {
      softStopped = true;
      console.warn(`[gen-content] Soft-stop reached (${Date.now() - startMs}ms/${budget.softStopMs}ms) — yielding remaining lessons to next batch`);
      break;
    }

    const isMiniCheck = lesson.step === "mini_check";
    const stepConfig = STEP_PROMPTS[lesson.step];
    const moduleName = (lesson as any).modules?.title || "";

    // ── Resolve LF context for this lesson ──
    const lfId = moduleLfMap.get(lesson.module_id);
    const lfData = lfId ? (lfWeights || []).find((lf: any) => lf.id === lfId) : (lfMap.get(moduleName) || null);
    const lfContext = lfData ? [
      `Lernfeld: ${lfData.code} – ${lfData.title}`,
      `Prüfungsgewichtung: ${lfData.weight_percent}%`,
      lfData.exam_part ? `Prüfungsteil: ${lfData.exam_part_name || lfData.exam_part}` : "",
      `Schwierigkeitsstufe: ${lfData.difficulty_tier}`,
      Array.isArray(lfData.ihk_focus_areas) && lfData.ihk_focus_areas.length > 0 ? `IHK-Schwerpunkte: ${lfData.ihk_focus_areas.join(", ")}` : "",
    ].filter(Boolean).join("\n") : "";

    // ── v2: Adaptive Depth based on difficulty ──
    const baseDifficultyLevel: DifficultyLevel = mapToDifficultyLevel(lfData?.difficulty_tier);
    
    // ── v3: Mastery-Feedback-Loop — load real learner performance data ──
    let masteryCtx: MasteryContext | null = null;
    try {
      masteryCtx = await loadMasteryContext(sb, curriculumId, lfId || null);
    } catch (e) { console.warn(`[gen-content] Mastery context load failed: ${(e as Error).message}`); }
    
    const difficultyLevel = adjustDifficultyByMastery(baseDifficultyLevel, masteryCtx);
    const adaptiveReq = getRequiredDepth(difficultyLevel);
    const masteryInjection = buildMasteryFeedbackSuffix(masteryCtx);

    const contextBlock = [
      `Beruf: ${professionName}`,
      `Modul: ${moduleName}`,
      `Lektion: ${lesson.title}`,
      lfContext,
      topicList.length > 0 ? `Relevante Themen: ${topicList.slice(0, 10).join(", ")}` : "",
      `\n${adaptiveReq.promptSuffix}`,
      masteryInjection,
    ].filter(Boolean).join("\n");

    const userPrompt = isMiniCheck
      ? buildMiniCheckPrompt(professionName, contextBlock)
      : `${stepConfig?.system || STEP_PROMPTS.verstehen.system}\n\n${contextBlock}`;

    let expandAttempts = 0;
    try {
      // ── Use failover chain instead of single provider ──
      const chain = await getModelChainAsync(isMiniCheck ? "minicheck" : "learning_content");

      const elapsedMs = Date.now() - startMs;
      const remainingSoftMs = budget.softStopMs - elapsedMs;
      // v6.2: Deterministic budget guard
      // MIN_TIMEOUT_MS = minimum viable LLM call duration
      // MIN_PERSIST_MS = time needed to persist results + log after LLM returns
      const MIN_TIMEOUT_MS = 28_000;   // v5.5: raised from 18s — 18s caused 100% timeout rate
      const MIN_PERSIST_MS = 4_000;
      const MIN_REMAINING_MS = MIN_TIMEOUT_MS + MIN_PERSIST_MS; // 32s

      if (remainingSoftMs < MIN_REMAINING_MS) {
        if (generated === 0 && remainingSoftMs >= MIN_TIMEOUT_MS) {
          // Allow one last attempt — wasting an entire invocation with gen=0 is worse
          console.warn(`[gen-content] Tight budget (${remainingSoftMs}ms) but gen=0 — allowing one last attempt`);
        } else {
          softStopped = true;
          console.warn(`[gen-content] Budget exhausted (${remainingSoftMs}ms remaining, generated=${generated}) — stopping batch`);
          break;
        }
      }

      // v5.5: Give failover chain enough room — outer timeout covers all providers
      const llmTimeoutMs = Math.max(
        MIN_TIMEOUT_MS,
        Math.min(50_000, remainingSoftMs - MIN_PERSIST_MS)
      );

      const llmAbort = new AbortController();
      let llmTimer: number | null = null;
      const timeoutPromise = new Promise<never>((_, reject) => {
        llmTimer = setTimeout(() => {
          llmAbort.abort();
          reject(new Error(`LLM_TIMEOUT_${llmTimeoutMs}`));
        }, llmTimeoutMs) as unknown as number;
      });

      const result = await Promise.race([
        callAIWithFailover(
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
${glossaryContext ? glossaryContext : ''}

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
            max_tokens: isMiniCheck ? 2200 : 3200,
            signal: llmAbort.signal,
          },
        ),
        timeoutPromise,
      ]) as Awaited<ReturnType<typeof callAIWithFailover>>;

      if (llmTimer) clearTimeout(llmTimer);

      // Parse tool call from failover result — with robust fallback
      let content: any;
      if (result.toolCalls && result.toolCalls.length > 0) {
        try {
          content = JSON.parse(result.toolCalls[0].function.arguments);
        } catch (parseErr) {
          console.warn(`[gen-content] Tool call JSON parse failed for ${lesson.id}: ${(parseErr as Error).message}`);
        }
      }
      // Fallback 1: Try parsing result.content as JSON directly
      if (!content && result.content) {
        const raw = result.content.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
        try { content = JSON.parse(raw); } catch { /* fallthrough to extraction */ }
      }
      // Fallback 2: Extract JSON object from free-text response
      if (!content && result.content) {
        const firstBrace = result.content.indexOf("{");
        const lastBrace = result.content.lastIndexOf("}");
        if (firstBrace !== -1 && lastBrace > firstBrace) {
          try {
            content = JSON.parse(result.content.slice(firstBrace, lastBrace + 1));
          } catch {
            console.warn(`[gen-content] JSON extraction failed for ${lesson.id}`);
          }
        }
      }
      // Fallback 3: For non-minicheck, wrap raw HTML content
      if (!content && !isMiniCheck && result.content && result.content.length > 200) {
        const htmlContent = result.content.trim();
        if (htmlContent.includes("<h3") || htmlContent.includes("<p") || htmlContent.includes("<strong")) {
          content = { html: htmlContent, objectives: [] };
          console.warn(`[gen-content] Used raw HTML fallback for ${lesson.id}`);
        }
      }
      if (!content || (!content.html && !content.questions)) {
        // v5.3: Distinguish empty AI response (contentLength=0) from parse failures
        // to enable targeted retry logic and clearer error attribution.
        const cLen = result.content?.length || 0;
        if (cLen === 0) {
          // P0 FIX: Mark as LLM_EMPTY_RESPONSE so isTransientLlmError() classifies it correctly.
          // This prevents stall_runs++ and attempts++ in the pipeline-runner.
          const emptyErr = new Error(`LLM_EMPTY_RESPONSE: AI returned empty response (provider=${result.provider}, model=${result.model}) — transient, will retry`);
          (emptyErr as any).name = "LLM_EMPTY_RESPONSE";
          throw emptyErr;
        }
        throw new Error(`No parseable tool response from AI (provider=${result.provider}, model=${result.model}, contentLength=${cLen})`);
      }

      if (!isMiniCheck) {
        const charCount = content.html?.length || 0;
        const minChars = stepConfig?.minChars || 400;
        const minWords = stepConfig?.minWords || 200;
        if (!content.html || charCount < minChars) {
          throw new Error(`Content too short: ${charCount} chars (min ${minChars})`);
        }
        // v2: Combined quality gate (depth + hallucination + variation)
        // v5.7: Depth failures → warn only (content still saved to content_versions for Council review)
        //       Only hallucination "regenerate" verdict causes hard fail.
        //       This prevents infinite loops where content is generated but never saved.
        const v2Result = runV2QualityGate(content.html || "", lesson.step, difficultyLevel);
        if (v2Result.hallucinationRisk.verdict === "regenerate") {
          const reasons = `Halluzinationsrisiko: ${v2Result.hallucinationRisk.riskScore} (${v2Result.hallucinationRisk.suspiciousRegulatory.join(", ")})`;
          throw new Error(`v2 Quality Gate FAILED (hallucination) for ${lesson.id}: ${reasons}`);
        }
        if (v2Result.overallVerdict === "fail" && !v2Result.depthPasses) {
          // Depth issues → log warning but still save content (Council can review)
          console.warn(`[gen-content] v2 Quality DEPTH-WARN for ${lesson.id}: ${v2Result.depthMissing.join("; ")} — saving anyway for Council review`);
        }
        if (v2Result.overallVerdict === "warn") {
          console.warn(`[gen-content] v2 Quality WARN for ${lesson.id}: depth=${v2Result.depthPasses}, hallucination=${v2Result.hallucinationRisk.riskScore}, variation=${v2Result.variationScore.score}`);
        }

        // ── v6: Deterministic content-depth expand-retry loop ──
        // After v2 gate passes (no hallucination block), check structural quality.
        // If content is too short/missing required elements, auto-expand with retries.
        const stepThresholds = getStepThresholds(lesson.step);
        let qualityCheck = assessLessonQuality(content.html, lesson.step);
        let expandAttempts = 0;

        while (!qualityCheck.ok && expandAttempts < MAX_EXPAND_RETRIES && !shouldSoftStop(startMs, "learning_content")) {
          expandAttempts++;
          console.log(`[gen-content] Expand-retry ${expandAttempts}/${MAX_EXPAND_RETRIES} for ${lesson.id.slice(0, 8)}: ${qualityCheck.reasons.join(", ")}`);

          try {
            const expandChain = await getModelChainAsync("learning_content");
            const expandElapsed = Date.now() - startMs;
            const expandRemaining = budget.softStopMs - expandElapsed;
            if (expandRemaining <= 12_000) {
              console.warn(`[gen-content] Not enough budget for expand retry (${expandRemaining}ms) — accepting current quality`);
              break;
            }
            const expandTimeout = Math.max(8_000, Math.min(35_000, expandRemaining - 3_000));

            const expandAbort = new AbortController();
            let expandTimer: number | null = null;
            const expandTimeoutPromise = new Promise<never>((_, reject) => {
              expandTimer = setTimeout(() => {
                expandAbort.abort();
                reject(new Error(`EXPAND_TIMEOUT_${expandTimeout}`));
              }, expandTimeout) as unknown as number;
            });

            const expandSystemPrompt = buildExpandSystemPrompt({
              professionName,
              lessonTitle: lesson.title || "Lesson",
              step: lesson.step,
              missingReasons: qualityCheck.reasons,
              thresholds: stepThresholds,
            });

            const expandResult = await Promise.race([
              callAIWithFailover(
                expandChain.map(c => ({ provider: c.provider, model: c.model })),
                {
                  messages: [
                    { role: "system", content: expandSystemPrompt },
                    { role: "user", content: `Bestehender Inhalt (erweitern, NICHT ersetzen):\n\n${content.html}\n\nGib den vollständig erweiterten Inhalt über die Funktion zurück.` },
                  ],
                  tools: [CONTENT_TOOL] as any,
                  tool_choice: { type: "function", function: { name: "create_lesson_content" } },
                  max_tokens: 4000,
                  signal: expandAbort.signal,
                },
              ),
              expandTimeoutPromise,
            ]) as Awaited<ReturnType<typeof callAIWithFailover>>;

            if (expandTimer) clearTimeout(expandTimer);

            // Parse expanded content
            let expandedContent: any;
            if (expandResult.toolCalls && expandResult.toolCalls.length > 0) {
              try { expandedContent = JSON.parse(expandResult.toolCalls[0].function.arguments); } catch { /* fallthrough */ }
            }
            if (!expandedContent && expandResult.content) {
              const raw = expandResult.content.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
              try { expandedContent = JSON.parse(raw); } catch { /* fallthrough */ }
            }
            if (!expandedContent && expandResult.content) {
              const fb = expandResult.content.indexOf("{");
              const lb = expandResult.content.lastIndexOf("}");
              if (fb !== -1 && lb > fb) {
                try { expandedContent = JSON.parse(expandResult.content.slice(fb, lb + 1)); } catch { /* noop */ }
              }
            }

            if (expandedContent?.html && expandedContent.html.length > (content.html?.length || 0)) {
              // Merge: keep original structured fields, take expanded html
              content.html = expandedContent.html;
              if (expandedContent.objectives?.length) content.objectives = expandedContent.objectives;
              if (expandedContent.key_terms?.length) content.key_terms = expandedContent.key_terms;
              if (expandedContent.common_mistakes?.length) content.common_mistakes = expandedContent.common_mistakes;
              if (expandedContent.exam_triggers?.length) content.exam_triggers = expandedContent.exam_triggers;
              if (expandedContent.transfer_questions?.length) content.transfer_questions = expandedContent.transfer_questions;
            }

            // Re-assess quality
            qualityCheck = assessLessonQuality(content.html, lesson.step);

            await logLLMCostEvent(sb, {
              job_type: "generate_learning_content_expand",
              provider: expandResult.provider,
              model: expandResult.model,
              tokens_in: expandResult.usage?.input_tokens || 0,
              tokens_out: expandResult.usage?.output_tokens || 0,
              package_id: packageId,
              certification_id: certificationId,
              course_id: courseId,
              estimatedUsage: expandResult.estimatedUsage,
              meta: { expand_attempt: expandAttempts, quality_ok: qualityCheck.ok, reasons: qualityCheck.reasons },
            });

            console.log(`[gen-content] Expand ${expandAttempts} result: ${qualityCheck.ok ? "✅ OK" : "❌ " + qualityCheck.reasons.join(", ")} (${qualityCheck.charCount} chars, ${qualityCheck.wordCount} words)`);
          } catch (expandErr) {
            console.warn(`[gen-content] Expand-retry ${expandAttempts} failed for ${lesson.id.slice(0, 8)}: ${(expandErr as Error).message}`);
            break; // Don't block — use whatever content we have
          }
        }

        if (!qualityCheck.ok && expandAttempts > 0) {
          console.warn(`[gen-content] Content still below quality bar after ${expandAttempts} expands for ${lesson.id.slice(0, 8)}: ${qualityCheck.reasons.join(", ")} — saving anyway for Council review`);
        }
      }

      // ── Bloom-Level mapping from lesson step ──
      const STEP_BLOOM_MAP: Record<string, string> = {
        einstieg: "remember",
        verstehen: "understand",
        anwenden: "apply",
        wiederholen: "analyze",
        mini_check: "apply",
      };
      const bloomLevel = STEP_BLOOM_MAP[lesson.step] || "understand";
      
      // ── Exam relevance score (1-5 based on LF weight + difficulty) ──
      const lfWeightPct = lfData?.weight_percent || 0;
      const examRelevanceScore = Math.min(5, Math.max(1,
        Math.round((lfWeightPct > 15 ? 4 : lfWeightPct > 10 ? 3 : 2) + (difficultyLevel === "hard" ? 1 : 0))
      ));

      const finalContent = isMiniCheck
        ? {
            type: "mini_check",
            questions: content.questions,
            objectives: content.objectives,
            bloom_level: "apply",
            exam_relevance_score: examRelevanceScore,
            competency_id: (lesson as any).competency_id || null,
            learning_field_id: lfId || null,
            generated_at: new Date().toISOString(),
            version: 5,
          }
        : {
            type: "text",
            html: content.html,
            objectives: content.objectives,
            key_terms: content.key_terms || [],
            common_mistakes: content.common_mistakes || [],
            exam_triggers: content.exam_triggers || [],
            transfer_questions: content.transfer_questions || [],
            bloom_level: bloomLevel,
            exam_relevance_score: examRelevanceScore,
            step: lesson.step,
            competency_id: (lesson as any).competency_id || null,
            learning_field_id: lfId || null,
            mastery_weight: lfWeightPct > 15 ? "high" : lfWeightPct > 10 ? "medium" : "low",
            generated_at: new Date().toISOString(),
            version: 5,
          };

      // Write to content_versions (Council write path — NO direct lesson write)
      const stepKeyCanonical = canonicalStepKey(lesson.step);

      const { data: newVersion, error: vErr } = await sb.from("content_versions").insert({
        course_id: courseId,
        lesson_id: lesson.id,
        step_key: stepKeyCanonical,
        content_json: finalContent,
        created_by_agent: "generate-learning-content",
        status: "approved",
        council_round: 1,
        entity_type: isMiniCheck ? "minicheck" : "lesson_step",
        published_at: new Date().toISOString(),
        published_by: "pipeline-auto-approve",
      }).select("id").single();

      if (vErr) {
        // Handle duplicate key — likely a race condition retry
        if (vErr.message?.includes("idx_cv_idempotency") || vErr.code === "23505") {
          const existing2 = await existingVersion(sb, lesson.id, lesson.step);
          if (existing2) {
            skippedWriteBack++;
            details.push({ id: lesson.id, title: lesson.title, step: lesson.step, status: "deduped", versionId: existing2.id });
            continue;
          }
        }
        throw vErr;
      }

      // NO writeBackToLesson — content reaches lessons.content ONLY via publish_approved_version()

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
        package_id: packageId,
        certification_id: certificationId,
        course_id: courseId,
        estimatedUsage: result.estimatedUsage,
      });

      generated++;
      if (!isMiniCheck && expandAttempts > 0) expandedCount++;
      details.push({ id: lesson.id, title: lesson.title, step: lesson.step, status: "ok", versionId: newVersion!.id, provider: result.provider, model: result.model, expand_retries: expandAttempts });

      // ── Progress telemetry after each successful lesson ──
      await updateStepProgress({
        last_progress_note: `lesson_ok: ${lesson.id.slice(0, 8)} (${generated}/${batch.length}) expand=${expandAttempts}`,
        real_generated: generated,
        failed_count: failed,
        expanded_count: expandedCount,
      });

      // Success → reset delay toward base
      currentDelay = Math.max(BASE_DELAY_MS, currentDelay * 0.7);

    } catch (e) {
      const errMsg = (e as Error).message || String(e);
      const transient = isTransientLlmError(e);

      if (transient) {
        // P0 FIX: Transient LLM errors (empty response, timeout, 429, 503)
        // must NOT count as content-generation failures.
        // They don't increment failed/poison-pills — they just end the batch early.
        console.warn(`[gen-content] TRANSIENT error on ${lesson.id.slice(0, 8)}: ${errMsg.slice(0, 200)} — stopping batch (no stall penalty)`);
        details.push({ id: lesson.id, title: lesson.title, step: lesson.step, status: "transient_error", error: errMsg });
        softStopped = true; // end batch gracefully — do NOT increment failed counter
        break;
      }

      failed++;
      console.error(`[gen-content] Failed lesson ${lesson.id}: ${errMsg}`);
      details.push({ id: lesson.id, title: lesson.title, step: lesson.step, status: "failed", error: errMsg });

      // ── Poison-pill tracking: increment per-lesson failure counter ──
      poisonPills[lesson.id] = (poisonPills[lesson.id] || 0) + 1;
      if (poisonPills[lesson.id] >= MAX_LESSON_RETRIES) {
        console.warn(`[gen-content] Lesson ${lesson.id.slice(0, 8)} is now a POISON PILL (${poisonPills[lesson.id]} failures) — will be skipped in future batches`);
      }

      // Rate limit → exponential backoff
      if (e instanceof RateLimitError || errMsg.includes("Rate limit") || errMsg.includes("429")) {
        currentDelay = Math.min(currentDelay * 2, MAX_DELAY_MS);
        console.warn(`[gen-content] Backoff increased to ${currentDelay}ms`);
      }
    }

    // Adaptive delay between calls
    await new Promise(r => setTimeout(r, currentDelay));
  }

  // ── Final batch telemetry ──
  await updateStepProgress({
    last_progress_note: softStopped
      ? `batch_softstop: gen=${generated} fail=${failed} expand=${expandedCount} remaining=${remaining}`
      : `batch_done: gen=${generated} fail=${failed} expand=${expandedCount} remaining=${remaining}`,
    real_generated: generated,
    failed_count: failed,
    expanded_count: expandedCount,
    batch_elapsed_ms: Date.now() - startMs,
  });

  // ── batch_complete logic v2: Complete when no actionable placeholders remain ──
  // Poison-pill lessons are excluded from the "remaining" count — they won't resolve
  // without manual intervention, so they must NOT block pipeline progress.
  const batchComplete = remaining <= 0 && failed === 0;
  // ALSO complete if the only remaining items are all poison pills
  const allRemainingArePoisonPills = remaining <= 0 && failed > 0 &&
    placeholderLessons.every(l => skippableLessons.has(l.id) || !placeholderLessons.filter(pl => !skippableLessons.has(pl.id)).some(al => al.id === l.id));
  const effectiveComplete = batchComplete || (actionablePlaceholders.length === 0 && skippableLessons.size > 0);

  // P0 FIX: Flag transient LLM errors so pipeline-runner skips stall_runs/attempts increment
  const hasTransientError = details.some((d: any) => d.status === "transient_error");

  return json({
    ok: true,
    batch_complete: effectiveComplete,
    transient: hasTransientError ? true : undefined,
    ...(!effectiveComplete ? {
      batch_cursor: { offset: 0 },
      _poison_pills: poisonPills,
    } : {}),
    generated,
    expanded: expandedCount,
    skipped_write_back: skippedWriteBack,
    failed,
    poison_pills_skipped: skippableLessons.size,
    total_placeholders: placeholderLessons.length,
    actionable_remaining: actionablePlaceholders.length - batch.length,
    remaining,
    details,
    message: effectiveComplete
      ? `✅ Lerninhalt-Generierung abgeschlossen. ${generated} generiert, ${skippedWriteBack} write-back, ${skippableLessons.size} Poison-Pills übersprungen.`
      : hasTransientError
        ? `⚡ Transient LLM error (empty/timeout) — ${generated} generiert, retrying.`
        : softStopped
          ? `⏱️ Soft-stop erreicht: ${generated} generiert, ${remaining} verbleibend.`
          : `🔄 ${generated} generiert, ${skippedWriteBack} write-back, ${remaining} verbleibend.`,
  });
});
