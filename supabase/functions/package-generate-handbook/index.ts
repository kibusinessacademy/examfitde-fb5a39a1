import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { callAIWithFailover, logLLMCostEvent } from "../_shared/ai-client.ts";
import { shouldSoftStop, getTimeBudget } from "../_shared/time-budget.ts";
import { getModelChain } from "../_shared/model-routing.ts";
import { resolveProfession } from "../_shared/profession-resolver.ts";

/**
 * package-generate-handbook — Elite Handbook Generator v3
 *
 * Generates a comprehensive IHK exam preparation handbook per learning field.
 * Each section targets 1500–2500 words of didactic-depth prose.
 *
 * Architecture:
 *   - BATCH_SIZE = 1 (each LF gets full time budget)
 *   - Uses batch_cursor for multi-invocation progress
 *   - Loads competencies + misconceptions for context enrichment
 *   - Two-pass generation: initial + depth-expand if under threshold
 */

const BATCH_SIZE = 1;
const TARGET_CHAPTERS = 5;
const MIN_SECTION_CHARS = 4000;   // ~1000+ words minimum per section
const IDEAL_SECTION_CHARS = 8000; // ~2000 words ideal
const MIN_WORD_TARGET = 1200;
const MAX_WORD_TARGET = 2500;

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

// ── Context Loaders ──────────────────────────────────────────

async function loadFieldCompetencies(
  sb: ReturnType<typeof createClient>,
  fieldId: string,
): Promise<{ name: string; bloom: string; misconceptions: string[] }[]> {
  try {
    const { data } = await sb
      .from("competencies")
      .select("competency_name, bloom_level, typical_misconceptions")
      .eq("learning_field_id", fieldId)
      .limit(30);
    return (data || []).map((c: any) => ({
      name: c.competency_name || "",
      bloom: c.bloom_level || "understand",
      misconceptions: Array.isArray(c.typical_misconceptions) ? c.typical_misconceptions : [],
    }));
  } catch { return []; }
}

async function loadFieldTopicDepth(
  sb: ReturnType<typeof createClient>,
  curriculumId: string,
  fieldTitle: string,
): Promise<string[]> {
  try {
    const { data: parentTopics } = await sb
      .from("curriculum_topics")
      .select("id, topic_name")
      .eq("certification_id", curriculumId)
      .is("parent_topic_id", null)
      .ilike("topic_name", `%${fieldTitle.slice(0, 30)}%`)
      .limit(3);

    let parentIds: string[] = [];
    if (parentTopics?.length) {
      parentIds = parentTopics.map((t: any) => t.id);
    } else {
      const { data: allParents } = await sb
        .from("curriculum_topics")
        .select("id, topic_name")
        .eq("certification_id", curriculumId)
        .is("parent_topic_id", null)
        .limit(50);
      if (!allParents?.length) return [];
      parentIds = allParents.map((p: any) => p.id);
    }

    const { data: subtopics } = await sb
      .from("curriculum_topics")
      .select("topic_name, difficulty_level")
      .in("parent_topic_id", parentIds)
      .limit(50);

    return subtopics?.map((s: any) => s.topic_name) || [];
  } catch { return []; }
}

async function loadExamQuestionSample(
  sb: ReturnType<typeof createClient>,
  curriculumId: string,
  fieldId: string,
): Promise<string[]> {
  try {
    const { data } = await sb
      .from("exam_questions")
      .select("question_text")
      .eq("curriculum_id", curriculumId)
      .eq("learning_field_id", fieldId)
      .in("status", ["approved"])
      .limit(5);
    return (data || []).map((q: any) => q.question_text || "").filter(Boolean);
  } catch { return []; }
}

// ── Elite Prompt Builder ─────────────────────────────────────

function buildElitePrompt(
  professionName: string,
  fieldCode: string,
  fieldTitle: string,
  fieldDescription: string,
  subtopics: string[],
  competencies: { name: string; bloom: string; misconceptions: string[] }[],
  sampleQuestions: string[],
  wordTarget: number,
): string {
  const minWords = Math.round(wordTarget * 0.9);
  
  const topicContext = subtopics.length > 0
    ? `\n**Kernthemen aus dem Rahmenplan:**\n${subtopics.map(t => `- ${t}`).join("\n")}`
    : "";

  const compContext = competencies.length > 0
    ? `\n**Kompetenzen (mit Bloom-Niveau):**\n${competencies.slice(0, 15).map(c => 
        `- ${c.name} [${c.bloom}]${c.misconceptions.length > 0 ? ` — Typische Fehler: ${c.misconceptions.slice(0, 2).join("; ")}` : ""}`
      ).join("\n")}`
    : "";

  const questionContext = sampleQuestions.length > 0
    ? `\n**Beispiel-Prüfungsfragen aus dem Pool (zum Einbetten als Übungsaufgaben):**\n${sampleQuestions.slice(0, 3).map((q, i) => `${i + 1}. ${q.slice(0, 200)}`).join("\n")}`
    : "";

  return `Du bist ein erfahrener IHK-Prüfungscoach und Fachexperte für "${professionName}".
Erstelle einen UMFASSENDEN, TIEFGEHENDEN Handbuch-Abschnitt für das Lernfeld "${fieldCode}: ${fieldTitle}".

${fieldDescription ? `**Lernfeld-Beschreibung:** ${fieldDescription}` : ""}
${topicContext}
${compContext}
${questionContext}

## QUALITÄTSANFORDERUNGEN (ELITE-STANDARD):

### 1. UMFANG & TIEFE
- Mindestumfang: **${minWords} Wörter** — schreibe AUSFÜHRLICH, nicht stichwortartig!
- Jedes Unterthema braucht 3–5 Absätze mit konkreten Erklärungen
- Verwende Fachbegriffe UND erkläre sie verständlich
- KEINE Platzhalter, KEINE "wird ergänzt", KEINE leeren Abschnitte

### 2. PFLICHT-STRUKTUR (alle Abschnitte MÜSSEN vorhanden sein):

#### 📚 Fachliche Grundlagen
- Systematische Erklärung aller Kernthemen des Lernfelds
- Definitionen mit Kontext (nicht nur Lexikon-Einträge)
- Zusammenhänge zwischen den Themen aufzeigen
- Rechtliche Grundlagen und Vorschriften (Paragraphen, Verordnungen)

#### 🔢 Formeln, Berechnungen & Methoden
- Alle relevanten Formeln mit AUSFÜHRLICHER Herleitung
- Mindestens 2 durchgerechnete Beispiele pro Formel
- Schritt-für-Schritt-Rechenweg zeigen
- Einheiten und typische Wertebereiche nennen

#### 🎯 Prüfungsstrategische Analyse
- "So denkt der IHK-Prüfer" — was wird erwartet?
- Welche Formulierungen bringen Punkte? Welche kosten Punkte?
- Typische Aufgabenformate in der schriftlichen Prüfung
- Zeitmanagement-Tipps für dieses Themengebiet

#### ⚠️ Prüfungsfallen & Typische Fehler (mindestens 5)
Für JEDE Falle detailliert:
| Falle | Warum passiert das? | Korrekte Antwort |
Format: Tabelle oder ausführliche Aufzählung mit konkreten Zahlen/Paragraphen

#### 📋 Merkschemata & Checklisten
- Mindestens 2 Merkregeln/Eselsbrücken
- Checklisten für typische Aufgabentypen (Schritt 1 → Schritt 2 → ...)
- Vergleichstabellen bei ähnlichen Konzepten
- "Wenn X, dann Y" — Entscheidungsbäume

#### 📝 Musteraufgaben mit Musterlösung (mindestens 2)
- 1× Berechnungsaufgabe (falls quantitatives Thema)
- 1× Fallstudie / Situationsaufgabe
- Jeweils: vollständiger Lösungsweg + Bewertungshinweise + häufige Fehler

#### 🔄 Transfer & Vertiefung
- "Was ändert sich, wenn...?" — 2–3 Variationsaufgaben
- Verbindungen zu anderen Lernfeldern
- Praxisbezug: Wie begegnet man diesem Thema im Berufsalltag?

#### 💡 Zusammenfassung & Schnell-Wiederholung
- Die 10 wichtigsten Fakten als nummerierte Liste
- "Das MUSS sitzen" — absolute Kernpunkte für die Prüfung

### 3. FORMATIERUNG
- Markdown mit ## und ### Überschriften
- Tabellen für Vergleiche und Übersichten
- Aufzählungen mit Spiegelstrichen für Strukturierung
- **Fettdruck** für Schlüsselbegriffe
- Formeln klar abgesetzt

Antworte NUR mit dem Markdown-Inhalt. Keine Meta-Kommentare.`;
}

// ── Section Generator ────────────────────────────────────────

async function generateSectionContent(
  sb: ReturnType<typeof createClient>,
  professionName: string,
  fieldCode: string,
  fieldTitle: string,
  fieldDescription: string,
  subtopics: string[],
  competencies: { name: string; bloom: string; misconceptions: string[] }[],
  sampleQuestions: string[],
  wordTarget: number,
  packageId: string | null,
  startMs: number,
  chain: Array<{ provider: string; model: string }>,
): Promise<{ content: string; provider: string; model: string }> {
  if (shouldSoftStop(startMs, "handbook")) {
    console.warn(`[generate-handbook] Soft-stop reached before LLM call for ${fieldCode}`);
    return { content: "", provider: "soft-stop", model: "none" };
  }

  // chain is passed as parameter now (v6: single-provider per invocation)
  const prompt = buildElitePrompt(professionName, fieldCode, fieldTitle, fieldDescription, subtopics, competencies, sampleQuestions, wordTarget);
  
  // Higher token budget for elite content
  // v6: capped at 4096 — higher values trigger 90s fetchTimeout in ai-client (line 128-131)
  const maxTokens = Math.min(4096, Math.max(3072, Math.round(wordTarget * 3)));

  try {
    const budget = getTimeBudget("handbook");
    const remainingSoftMs = budget.softStopMs - (Date.now() - startMs);
    if (remainingSoftMs <= 9_500) {
      return { content: "", provider: "soft-stop", model: "none" };
    }

    const llmTimeoutMs = Math.max(10_000, Math.min(25_000, remainingSoftMs - 2_000)); // v6: capped at 25s (was 40s)
    const llmAbort = new AbortController();
    const llmTimer = setTimeout(() => llmAbort.abort(), llmTimeoutMs);
    
    const result = await callAIWithFailover(chain, {
      messages: [
        { role: "system", content: `Du bist ein IHK-Prüfungscoach mit 20 Jahren Erfahrung als Prüfer und Dozent für "${professionName}". Du schreibst das umfassendste und tiefgehendste Prüfungsvorbereitungs-Handbuch, das je für diesen Beruf erstellt wurde. Jeder Abschnitt muss so detailliert sein, dass ein Prüfling NUR mit diesem Handbuch die Prüfung bestehen könnte. Schreibe IMMER lang und ausführlich — niemals stichwortartig. Mindestens ${wordTarget} Wörter pro Abschnitt.` },
        { role: "user", content: prompt },
      ],
      max_tokens: maxTokens, // v6: already capped at 4096
      signal: llmAbort.signal,
    }).finally(() => clearTimeout(llmTimer));

    try {
      await logLLMCostEvent(sb, {
        job_type: "generate_handbook",
        provider: result.provider,
        model: result.model,
        tokens_in: result.usage?.input_tokens || 0,
        tokens_out: result.usage?.output_tokens || 0,
        package_id: packageId,
        estimatedUsage: result.estimatedUsage,
      });
    } catch { /* non-blocking */ }

    let content = result.content || "";
    content = content.replace(/^```(?:markdown)?\n?/g, "").replace(/\n?```$/g, "").trim();
    if (content.startsWith("{") || content.startsWith('"')) {
      try {
        const parsed = JSON.parse(content);
        content = typeof parsed === "string" ? parsed : parsed.content || parsed.markdown || JSON.stringify(parsed);
      } catch { /* use as-is */ }
    }

    // ── Depth Expansion Pass: if content below threshold, request expansion ──
    // v6: budget-aware — with 42s total, expansion is only viable if >12s remain after soft-stop check
    const expandBudget = getTimeBudget("handbook");
    const expandRemainingMs = expandBudget.softStopMs - (Date.now() - startMs);
    if (content.length > 500 && content.length < IDEAL_SECTION_CHARS && expandRemainingMs > 12_000) {
      console.log(`[generate-handbook] Section ${fieldCode} below ideal (${content.length}/${IDEAL_SECTION_CHARS} chars). Expanding... (${Math.round(expandRemainingMs/1000)}s remaining)`);
      try {
        const remainingMs = expandRemainingMs;
        const expandAbort = new AbortController();
        const expandTimeoutMs = Math.max(10_000, Math.min(25_000, remainingMs - 2_000));
        const expandTimer = setTimeout(() => expandAbort.abort(), expandTimeoutMs);
        
        const expandResult = await callAIWithFailover(chain, {
          messages: [
            { role: "system", content: "Du erweiterst IHK-Handbuch-Inhalte auf Elite-Niveau. Antworte NUR mit dem vollständigen, erweiterten Markdown-Text. Füge KEINE Meta-Kommentare hinzu." },
            { role: "user", content: `Der folgende Handbuch-Abschnitt für "${fieldCode}: ${fieldTitle}" muss DRINGEND erweitert werden.

AKTUELLE SCHWÄCHEN:
- Zu wenig Praxisbeispiele und Berechnungen
- Prüfungsfallen fehlen oder sind zu oberflächlich
- Keine konkreten Musteraufgaben mit Lösungsweg

ERWEITERE den Text auf mindestens ${MIN_WORD_TARGET} Wörter. Füge hinzu:
1. Mindestens 3 weitere durchgerechnete Beispiele
2. Mindestens 3 weitere Prüfungsfallen mit Erklärung
3. Eine zusätzliche Musteraufgabe mit vollständigem Lösungsweg
4. Mehr "So denkt der Prüfer"-Hinweise
5. Detailliertere Erklärungen der Fachbegriffe

BESTEHENDER TEXT:\n\n${content}` },
          ],
          max_tokens: Math.min(4096, maxTokens), // v6: capped same as primary call
          signal: expandAbort.signal,
        }).finally(() => clearTimeout(expandTimer));

        try {
          await logLLMCostEvent(sb, {
            job_type: "generate_handbook_expand",
            provider: expandResult.provider,
            model: expandResult.model,
            tokens_in: expandResult.usage?.input_tokens || 0,
            tokens_out: expandResult.usage?.output_tokens || 0,
            package_id: packageId,
            estimatedUsage: expandResult.estimatedUsage,
          });
        } catch { /* non-blocking */ }

        let expanded = expandResult.content || "";
        expanded = expanded.replace(/^```(?:markdown)?\n?/g, "").replace(/\n?```$/g, "").trim();
        if (expanded.length > content.length * 1.2) {
          console.log(`[generate-handbook] Expand OK: ${content.length} → ${expanded.length} chars`);
          content = expanded;
        }
      } catch (expandErr) {
        console.warn(`[generate-handbook] Expand failed: ${(expandErr as Error).message}`);
      }
    }

    const hasRealContent = content.length >= MIN_SECTION_CHARS;
    if (content.length > 0 && !hasRealContent) {
      console.warn(`[generate-handbook] Below min for ${fieldCode}: ${content.length}/${MIN_SECTION_CHARS} chars`);
    }
    return { content, provider: result.provider, model: result.model };
  } catch (e) {
    const msg = (e as Error).message || String(e);
    console.error(`[generate-handbook] ALL PROVIDERS FAILED for ${fieldCode}: ${msg}`);
    try {
      await logLLMCostEvent(sb, {
        job_type: "generate_handbook",
        provider: "unknown",
        model: "unknown",
        tokens_in: 0,
        tokens_out: 0,
        package_id: packageId,
        status: "fail",
        error_message: msg.slice(0, 500),
      });
    } catch { /* non-blocking */ }
    return { content: "", provider: "none", model: "none" };
  }
}

// ── Fallback Builder ─────────────────────────────────────────

function buildFallbackContent(lf: any, subtopics: string[], competencies: any[]): string {
  const parts: string[] = [
    `## ${lf.code}: ${lf.title}`,
    "",
    lf.description || `Dieses Lernfeld behandelt zentrale Aspekte von ${lf.title}.`,
    "",
  ];

  if (subtopics.length > 0) {
    parts.push("### Kernthemen aus dem Rahmenplan");
    for (const t of subtopics) parts.push(`- ${t}`);
    parts.push("");
  }

  if (competencies.length > 0) {
    parts.push("### Kompetenzen");
    for (const c of competencies.slice(0, 10)) {
      parts.push(`- **${c.name}** [${c.bloom}]`);
      if (c.misconceptions.length > 0) {
        parts.push(`  - Typischer Fehler: ${c.misconceptions[0]}`);
      }
    }
    parts.push("");
  }

  parts.push(
    "### Prüfungsrelevanz",
    `Dieses Lernfeld ist fester Bestandteil der IHK-Abschlussprüfung.`,
    "",
    "### Lernhinweise",
    "- Fachbegriffe und Definitionen sicher beherrschen",
    "- Zusammenhänge zwischen Theorie und Praxis herstellen",
    "- Typische Rechenaufgaben und Fallstudien üben",
    "",
    "_Dieser Abschnitt wird durch die nächste Generierungs-Iteration mit Tiefeninhalt angereichert._",
  );

  return parts.join("\n");
}

// ── Main Handler ─────────────────────────────────────────────

Deno.serve(async (req) => {
  const startMs = Date.now();
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
  const curriculumId = p.curriculum_id as string;
  const certificationId = p.certification_id || null;
  const forceRebuild = Boolean(p?.force_rebuild);
  const attemptIndex = typeof p?.attempt_index === "number" ? p.attempt_index : 0;

  // v6: single-provider per invocation — 4-provider cascade is impossible in 42s budget
  // Rotate provider based on attempt_index (content-runner passes this on retries)
  const fullChain = getModelChain("handbook");
  const _handbookChain = [fullChain[attemptIndex % fullChain.length]];

  // ⚠️ Force rebuild: explicit admin action to hard-reset handbook for this curriculum.
  // Deletes all sections + chapters, then falls through to normal idempotent generation.
  if (forceRebuild) {
    console.log(`[generate-handbook] force_rebuild=true for curriculum=${curriculumId}`);

    const { data: existingChapters, error: chErr } = await sb
      .from("handbook_chapters")
      .select("id")
      .eq("curriculum_id", curriculumId);

    if (chErr) throw new Error(`handbook_chapters select: ${chErr.message}`);

    if (existingChapters?.length) {
      const chapterIds = existingChapters.map((x: any) => x.id);

      // Delete sections first (FK safety)
      const { error: secDelErr } = await sb
        .from("handbook_sections")
        .delete()
        .in("chapter_id", chapterIds);
      if (secDelErr) throw new Error(`handbook_sections delete: ${secDelErr.message}`);

      const { error: chDelErr } = await sb
        .from("handbook_chapters")
        .delete()
        .eq("curriculum_id", curriculumId);
      if (chDelErr) throw new Error(`handbook_chapters delete: ${chDelErr.message}`);

      console.log(`[generate-handbook] force_rebuild: deleted ${existingChapters.length} chapters + sections`);
    }
  }

  if (!(await prereqDone(sb, packageId, "validate_learning_content"))) {
    return json({ ok: false, retry: true, error: "PREREQ_NOT_DONE: validate_learning_content" }, 409);
  }

  let professionName = "Ausbildungsberuf";
  try {
    const prof = await resolveProfession(sb, { certificationId, curriculumId });
    professionName = prof.professionName;
  } catch { /* fallback */ }

  // 1) Load learning fields
  const { data: fields, error: lfErr } = await sb
    .from("learning_fields")
    .select("id, code, title, description, sort_order")
    .eq("curriculum_id", curriculumId)
    .order("sort_order", { ascending: true });

  if (lfErr) throw new Error(`LF query: ${lfErr.message}`);
  if (!fields || fields.length === 0) throw new Error(`No learning_fields for curriculum ${curriculumId}`);

  // Load exam blueprint weights for word target calibration
  const { data: blueprintWeights } = await sb
    .from("exam_blueprints")
    .select("learning_field_id, weight_pct")
    .eq("curriculum_id", curriculumId);

  const weightByLf = new Map<string, number>();
  if (blueprintWeights?.length) {
    for (const bw of blueprintWeights) {
      const lfId = (bw as any).learning_field_id;
      if (lfId) weightByLf.set(lfId, (bw as any).weight_pct || 0);
    }
  }

  const totalWeight = Array.from(weightByLf.values()).reduce((s, v) => s + v, 0) || fields.length;
  const lfWordTargets = new Map<string, number>();
  for (const lf of fields) {
    const w = weightByLf.get(lf.id) || (100 / fields.length);
    const normalizedWeight = w / totalWeight;
    const wordTarget = Math.round(MIN_WORD_TARGET + (MAX_WORD_TARGET - MIN_WORD_TARGET) * Math.min(1, normalizedWeight * fields.length));
    lfWordTargets.set(lf.id, Math.max(MIN_WORD_TARGET, Math.min(MAX_WORD_TARGET, wordTarget)));
  }

  console.log(`[generate-handbook] Elite v3 for ${professionName}: ${fields.length} LFs (pkg ${packageId.slice(0, 8)})`);

  // 2) Handle chapters — IDEMPOTENT: never delete existing sections.
  //    Check which learning fields already have sections and only generate missing ones.
  //    This fixes the infinite loop where batch_cursor=0 deleted all progress.
  let chapters: Array<{ id: string; sort_order: number }>;

  // Load existing chapters
  const { data: existingCh } = await sb
    .from("handbook_chapters")
    .select("id, sort_order")
    .eq("curriculum_id", curriculumId)
    .order("sort_order", { ascending: true });

  if (existingCh && existingCh.length >= TARGET_CHAPTERS) {
    // Chapters exist — reuse them
    chapters = existingCh;
  } else {
    // No chapters yet (or too few) — create them, but DON'T delete existing sections
    if (existingCh?.length) {
      // Chapters exist but fewer than target — reuse what we have
      chapters = existingCh;
    } else {
      // Create fresh chapters
      const chapterSize = Math.max(1, Math.floor(fields.length / TARGET_CHAPTERS)) || 1;
      const rawChunks: typeof fields[] = [];
      for (let i = 0; i < fields.length; i += chapterSize) rawChunks.push(fields.slice(i, i + chapterSize));
      while (rawChunks.length > TARGET_CHAPTERS && rawChunks.length > 1) {
        const last = rawChunks.pop()!;
        rawChunks[rawChunks.length - 1] = [...rawChunks[rawChunks.length - 1], ...last];
      }
      while (rawChunks.length < TARGET_CHAPTERS) rawChunks.push([]);

      const chaptersToCreate = rawChunks.map((chunk, idx) => {
        const chapterNum = idx + 1;
        const firstCode = chunk.length ? (chunk[0] as any).code : `X${chapterNum}`;
        const lastCode = chunk.length ? (chunk[chunk.length - 1] as any).code : `X${chapterNum}`;
        const titleSuffix = chunk.length ? `${firstCode}–${lastCode} Prüfungsrelevante Themen` : "Ergänzende Prüfungsthemen";
        return {
          curriculum_id: curriculumId,
          chapter_key: `handbuch-${curriculumId.slice(0, 8)}-kap${chapterNum}`,
          title: `Kapitel ${chapterNum}: ${titleSuffix}`,
          sort_order: chapterNum,
        };
      });

      const { data: newChapters, error: chErr } = await sb
        .from("handbook_chapters").insert(chaptersToCreate).select("id, sort_order");
      if (chErr) throw new Error(`Chapter insert: ${chErr.message}`);
      if (!newChapters?.length) throw new Error("handbook_chapters: 0 rows inserted");
      chapters = newChapters;
    }
  }

  // ── Load existing sections to determine which LFs still need generation ──
  const chapterIds = chapters.map((c: any) => c.id);
  const { data: existingSections } = await sb
    .from("handbook_sections")
    .select("id, learning_field_id, content_markdown, chapter_id")
    .in("chapter_id", chapterIds);

  const populatedLfIds = new Set<string>();
  for (const sec of (existingSections || [])) {
    // Only count as populated if content is substantial (not fallback/placeholder)
    const md = sec.content_markdown || "";
    if (md.length >= MIN_SECTION_CHARS && sec.learning_field_id) {
      populatedLfIds.add(sec.learning_field_id);
    }
  }

  // Filter fields to only those that still need generation
  const fieldsNeedingGeneration = fields.filter((lf: any) => !populatedLfIds.has(lf.id));
  console.log(`[generate-handbook] ${populatedLfIds.size}/${fields.length} LFs already have sections. ${fieldsNeedingGeneration.length} remaining.`);

  if (fieldsNeedingGeneration.length === 0) {
    // All sections already generated — report complete
    return json({
      ok: true,
      batch_complete: true,
      chapters: chapters.length,
      sections: existingSections?.length || 0,
      already_populated: populatedLfIds.size,
      version: "elite_v3",
    });
  }

  // Build field→chapter mapping (maps field index in ALL fields to chapter sort_order)
  const chapterSizeFull = Math.max(1, Math.floor(fields.length / TARGET_CHAPTERS)) || 1;
  const rawChunksFull: typeof fields[] = [];
  for (let i = 0; i < fields.length; i += chapterSizeFull) rawChunksFull.push(fields.slice(i, i + chapterSizeFull));
  while (rawChunksFull.length > TARGET_CHAPTERS && rawChunksFull.length > 1) {
    const last = rawChunksFull.pop()!;
    rawChunksFull[rawChunksFull.length - 1] = [...rawChunksFull[rawChunksFull.length - 1], ...last];
  }

  const fieldIdToChapterSort = new Map<string, number>();
  for (let ci = 0; ci < rawChunksFull.length; ci++) {
    for (const f of rawChunksFull[ci]) {
      fieldIdToChapterSort.set((f as any).id, ci + 1);
    }
  }

  // 3) Generate sections for MISSING LFs only (batch of BATCH_SIZE per invocation)
  const sectionRows: Array<Record<string, unknown>> = [];
  let sectionOrder = (existingSections?.length || 0) + 1;
  let llmSuccessCount = 0;
  let llmFailCount = 0;

  // Take at most BATCH_SIZE from the fields that still need generation
  const batchFields = fieldsNeedingGeneration.slice(0, BATCH_SIZE);

  for (let i = 0; i < batchFields.length; i++) {
    const lf = batchFields[i] as any;
    const chapterSortOrder = fieldIdToChapterSort.get(lf.id) || 1;
    const chapter = chapters.find((c: any) => c.sort_order === chapterSortOrder);
    if (!chapter) continue;

    // Load rich context for this LF
    const [subtopics, competencies, sampleQuestions] = await Promise.all([
      loadFieldTopicDepth(sb, curriculumId, lf.title),
      loadFieldCompetencies(sb, lf.id),
      loadExamQuestionSample(sb, curriculumId, lf.id),
    ]);

    const wordTarget = lfWordTargets.get(lf.id) || MIN_WORD_TARGET;

    const generated = await generateSectionContent(
      sb,
      professionName,
      lf.code,
      lf.title,
      lf.description || "",
      subtopics,
      competencies,
      sampleQuestions,
      wordTarget,
      packageId,
      startMs,
      _handbookChain,
    );

    const hasRealContent = generated.content.length >= MIN_SECTION_CHARS;
    if (hasRealContent) llmSuccessCount++;
    else llmFailCount++;

    const contentMarkdown = hasRealContent
      ? generated.content
      : buildFallbackContent(lf, subtopics, competencies);

    sectionRows.push({
      chapter_id: chapter.id,
      section_key: `lf-${String(lf.code).toLowerCase().replace(/\s+/g, '-')}-${curriculumId.slice(0, 8)}`,
      title: `${lf.code}: ${lf.title}`,
      content_markdown: contentMarkdown,
      content_type: "text",
      sort_order: sectionOrder++,
      learning_field_id: lf.id,
      metadata: {
        depth_enriched: subtopics.length > 0,
        llm_generated: hasRealContent,
        llm_provider: generated.provider,
        llm_model: generated.model,
        word_target: wordTarget,
        actual_chars: generated.content.length,
        exam_weight_pct: weightByLf.get(lf.id) || null,
        competency_count: competencies.length,
        version: "elite_v3",
      },
    });
  }

  if (sectionRows.length > 0) {
    const { error: secErr } = await sb.from("handbook_sections").upsert(sectionRows, {
      onConflict: "chapter_id,section_key",
      ignoreDuplicates: false,
    });
    if (secErr) throw new Error(`Section upsert: ${secErr.message}`);
  }

  // Check remaining after this batch
  const remainingAfterBatch = fieldsNeedingGeneration.length - batchFields.length;
  const totalPopulated = populatedLfIds.size + sectionRows.length;
  const isComplete = remainingAfterBatch <= 0;
  const progress = Math.round((totalPopulated / fields.length) * 100);

  console.log(`[generate-handbook] Batch: ${sectionRows.length} sections generated, ${llmSuccessCount} LLM, ${llmFailCount} fallback. Total: ${totalPopulated}/${fields.length} (${progress}%)${isComplete ? ' — COMPLETE' : ''}`);

  if (!isComplete) {
    return json({
      ok: true,
      batch_complete: false,
      progress,
      sections_this_batch: sectionRows.length,
      total_populated: totalPopulated,
      remaining: remainingAfterBatch,
    });
  }

  return json({
    ok: true,
    batch_complete: true,
    chapters: chapters.length,
    sections: totalPopulated,
    llm_generated: llmSuccessCount,
    llm_fallback: llmFailCount,
    version: "elite_v3",
  });
});
