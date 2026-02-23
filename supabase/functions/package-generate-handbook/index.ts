import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { callAIWithFailover, logLLMCostEvent } from "../_shared/ai-client.ts";
import { getModelChain } from "../_shared/model-routing.ts";
import { resolveProfession } from "../_shared/profession-resolver.ts";

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
 * Load curriculum_topics depth for a learning field.
 */
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
  } catch {
    return [];
  }
}

/**
 * Generate real handbook section content via LLM with failover chain.
 * Returns { content, provider, model } or empty content on total failure.
 */
async function generateSectionContent(
  sb: ReturnType<typeof createClient>,
  professionName: string,
  fieldCode: string,
  fieldTitle: string,
  fieldDescription: string,
  subtopics: string[],
  wordTarget: number,
  packageId: string | null,
): Promise<{ content: string; provider: string; model: string }> {
  const chain = getModelChain("handbook");
  const topicContext = subtopics.length > 0
    ? `\nKernthemen aus dem Rahmenplan:\n${subtopics.map(t => `- ${t}`).join("\n")}`
    : "";

  const minWords = Math.round(wordTarget * 0.8);
  const maxWords = Math.round(wordTarget * 1.2);
  // Hard minimum: each section must reach this char count to pass QC
  const MIN_SECTION_CHARS = 2000;

  const prompt = `Du bist ein IHK-Fachexperte und Prüfungscoach für "${professionName}". 
Erstelle einen ausführlichen, prüfungsstrategischen Handbuch-Abschnitt für "${fieldCode}: ${fieldTitle}".

${fieldDescription ? `Beschreibung: ${fieldDescription}` : ""}
${topicContext}

ANFORDERUNGEN:
1. Fachlich korrekt, prüfungsrelevant für IHK-Abschlussprüfung
2. Konkrete Definitionen, Formeln, Merksätze — AUSFÜHRLICH erklären
3. Mindestens 3 praxisnahe Beispiele mit konkreten Zahlen/Szenarien
4. Typische Prüfungsfallen mit Erklärung, warum sie Fallen sind
5. Markdown mit ## und ### Überschriften
6. WICHTIG: Mindestumfang ${minWords} Wörter, Zielumfang ${maxWords} Wörter. Schreibe NICHT kürzer!
7. KEINE Platzhalter, KEINE Verweise auf externe Quellen
8. Jedes Unterthema braucht mindestens 2-3 Absätze Erklärung

PRÜFUNGSSTRATEGISCHE PFLICHT-SEKTIONEN:
### 🎯 So denkt der Prüfer
- Was erwartet der IHK-Prüfer bei diesem Thema? Welche Formulierungen bewertet er positiv?
- Welche typischen Fehler führen zu Punktabzug?
- Worauf achtet der Prüfer bei der Bewertung besonders?

### ⚠️ Typische Prüfungsfallen (mindestens 3)
- Für jede Falle: Was ist der Fehler? → Warum machen Prüflinge ihn? → Was ist die korrekte Antwort?
- Konkrete Beispiele mit Zahlen/§§ wo relevant

### 📋 Merkschemata & Checklisten
- Prüfungstaugliche Merksätze und Eselsbrücken
- Schritt-für-Schritt-Checklisten für typische Aufgabentypen
- Formelsammlungen mit Erklärung (bei quantitativen Themen)

### 📝 Musteraufgabe mit Musterlösung
- 1 realistische IHK-Prüfungsaufgabe (Fallstudie/Berechnung) mit vollständiger Musterlösung
- Bewertungshinweise: Was bringt volle Punktzahl? Was führt zu Abzug?
- Lösungsstrategie: In welcher Reihenfolge sollte man vorgehen?

### 🔄 Transferübungen
- 2 Variationsaufgaben: "Was ändert sich, wenn...?"
- Verbindung zu anderen Lernfeldern aufzeigen

Antworte NUR mit Markdown.`;

  const maxTokens = Math.max(3200, Math.round(wordTarget * 4));

  try {
    const result = await callAIWithFailover(chain, {
      messages: [
        { role: "system", content: "Du schreibst ausführliche, prüfungsstrategische IHK-Handbuch-Inhalte auf Experten-Niveau. Antworte nur mit Markdown. Schreibe umfassend und detailliert — NICHT kurz oder stichwortartig. Jeder Abschnitt muss Fallbeispiele, Prüfungsfallen und Merkschemata enthalten. Denke wie ein erfahrener IHK-Prüfer, der sein Wissen an Prüflinge weitergibt." },
        { role: "user", content: prompt },
      ],
      max_tokens: Math.min(4096, maxTokens),
    });

    // Log cost
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
    if (content.startsWith("{") || content.startsWith('"')) {
      try {
        const parsed = JSON.parse(content);
        content = typeof parsed === "string" ? parsed : parsed.content || parsed.markdown || JSON.stringify(parsed);
      } catch { /* use as-is */ }
    }
    content = content.replace(/^```(?:markdown)?\n?/g, "").replace(/\n?```$/g, "").trim();

    // ── LENGTH ENFORCER: If content too short, do one expand retry ──
    if (content.length > 200 && content.length < MIN_SECTION_CHARS) {
      console.log(`[generate-handbook] Section ${fieldCode} too short (${content.length} chars < ${MIN_SECTION_CHARS}). Attempting expand...`);
      try {
        const expandResult = await callAIWithFailover(chain, {
          messages: [
            { role: "system", content: "Du erweiterst IHK-Handbuch-Inhalte. Antworte nur mit dem vollständigen, erweiterten Markdown-Text." },
            { role: "user", content: `Der folgende Handbuch-Abschnitt für "${fieldCode}: ${fieldTitle}" ist zu kurz. Erweitere ihn auf mindestens ${minWords} Wörter. Füge mehr Erklärungen, Beispiele, Definitionen und Prüfungstipps hinzu. Behalte die bestehende Struktur bei und ergänze sie.\n\n${content}` },
          ],
          max_tokens: Math.min(4096, maxTokens),
        });
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
        if (expanded.length > content.length) {
          console.log(`[generate-handbook] Expand OK: ${content.length} → ${expanded.length} chars`);
          content = expanded;
        }
      } catch (expandErr) {
        console.warn(`[generate-handbook] Expand failed for ${fieldCode}: ${(expandErr as Error).message}`);
      }
    }

    const hasRealContent = content.length >= MIN_SECTION_CHARS;
    if (content.length > 0 && !hasRealContent) {
      console.warn(`[generate-handbook] Below min for ${fieldCode} via ${result.provider}/${result.model}: ${content.length}/${MIN_SECTION_CHARS} chars`);
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
  const curriculumId = p.curriculum_id as string;
  const certificationId = p.certification_id || null;

  if (!(await prereqDone(sb, packageId, "build_ai_tutor_index"))) {
    return json({ ok: false, retry: true, error: "PREREQ_NOT_DONE: build_ai_tutor_index" }, 409);
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

  // Load exam blueprint weights
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

  const BASE_WORDS = 400;
  const MAX_WORDS = 800;
  const totalWeight = Array.from(weightByLf.values()).reduce((s, v) => s + v, 0) || fields.length;

  const lfWordTargets = new Map<string, number>();
  for (const lf of fields) {
    const w = weightByLf.get(lf.id) || (100 / fields.length);
    const normalizedWeight = w / totalWeight;
    const wordTarget = Math.round(BASE_WORDS + (MAX_WORDS - BASE_WORDS) * Math.min(1, normalizedWeight * fields.length));
    lfWordTargets.set(lf.id, Math.max(BASE_WORDS, Math.min(MAX_WORDS, wordTarget)));
  }

  // Load competencies per LF
  const lfIds = fields.map((f: any) => f.id);
  const { data: allComps } = await sb
    .from("competencies")
    .select("id, learning_field_id")
    .in("learning_field_id", lfIds)
    .limit(500);

  const primaryCompByLf = new Map<string, string>();
  if (allComps?.length) {
    for (const comp of allComps) {
      const lfId = (comp as any).learning_field_id;
      if (!primaryCompByLf.has(lfId)) primaryCompByLf.set(lfId, comp.id);
    }
  }

  console.log(`[generate-handbook] Generating for ${professionName}: ${fields.length} LFs, weighted word targets (pkg ${packageId.slice(0, 8)})`);

  // 2) Delete existing handbook (idempotent rebuild) — only on first batch
  const batchCursor = p.batch_cursor ?? 0;

  if (batchCursor === 0) {
    const { data: existingChapters } = await sb
      .from("handbook_chapters").select("id").eq("curriculum_id", curriculumId);

    if (existingChapters?.length) {
      const chapterIds = existingChapters.map((x: { id: string }) => x.id);
      try { await sb.from("handbook_sections").delete().in("chapter_id", chapterIds); } catch (_) { /* ignore */ }
      try { await sb.from("handbook_chapters").delete().eq("curriculum_id", curriculumId); } catch (_) { /* ignore */ }
    }
  }

  // 3) Create chapters (target 5) — only on first batch
  let chapters: Array<{ id: string; sort_order: number }>;
  const TARGET_CHAPTERS = 5;

  if (batchCursor === 0) {
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
  } else {
    // Resume: load existing chapters
    const { data: existingCh } = await sb
      .from("handbook_chapters")
      .select("id, sort_order")
      .eq("curriculum_id", curriculumId)
      .order("sort_order", { ascending: true });
    chapters = existingCh || [];
    if (!chapters.length) throw new Error("No chapters found for resume batch");
  }

  // Build field→chapter mapping
  const chapterSize = Math.max(1, Math.floor(fields.length / TARGET_CHAPTERS)) || 1;
  const rawChunks: typeof fields[] = [];
  for (let i = 0; i < fields.length; i += chapterSize) rawChunks.push(fields.slice(i, i + chapterSize));
  while (rawChunks.length > TARGET_CHAPTERS && rawChunks.length > 1) {
    const last = rawChunks.pop()!;
    rawChunks[rawChunks.length - 1] = [...rawChunks[rawChunks.length - 1], ...last];
  }

  const fieldToChapter: number[] = [];
  for (let ci = 0; ci < rawChunks.length; ci++) {
    for (let fi = 0; fi < rawChunks[ci].length; fi++) fieldToChapter.push(ci + 1);
  }

  // 4) Generate sections ONE AT A TIME
  const BATCH_SIZE = 1;
  const sectionRows: Array<Record<string, unknown>> = [];
  let sectionOrder = batchCursor + 1;
  let llmSuccessCount = 0;
  let llmFailCount = 0;

  if (batchCursor > 0) {
    const { data: existingSections } = await sb
      .from("handbook_sections")
      .select("id")
      .in("chapter_id", chapters.map((c: any) => c.id));
    sectionOrder = (existingSections?.length || 0) + 1;
  }

  const batchEnd = Math.min(batchCursor + BATCH_SIZE, fields.length);
  const batchFields = fields.slice(batchCursor, batchEnd);

  for (let i = 0; i < batchFields.length; i++) {
    const lf = batchFields[i] as any;
    const globalIdx = batchCursor + i;
    const chapterSortOrder = fieldToChapter[globalIdx] || 1;
    const chapter = chapters.find((c: any) => c.sort_order === chapterSortOrder);
    if (!chapter) continue;

    const subtopics = await loadFieldTopicDepth(sb, curriculumId, lf.title);
    const wordTarget = lfWordTargets.get(lf.id) || BASE_WORDS;

    const generated = await generateSectionContent(
      sb,
      professionName,
      lf.code,
      lf.title,
      lf.description || "",
      subtopics,
      wordTarget,
      packageId,
    );

    const MIN_ACCEPT_CHARS = 2000;
    const hasRealContent = generated.content.length >= MIN_ACCEPT_CHARS;
    if (hasRealContent) llmSuccessCount++;
    else llmFailCount++;

    const contentMarkdown = hasRealContent
      ? generated.content
      : buildFallbackContent(lf, subtopics);

    sectionRows.push({
      chapter_id: chapter.id,
      section_key: `lf-${String(lf.code).toLowerCase().replace(/\s+/g, '-')}-${curriculumId.slice(0, 8)}`,
      title: `${lf.code}: ${lf.title}`,
      content_markdown: contentMarkdown,
      content_type: "text",
      sort_order: sectionOrder++,
      learning_field_id: lf.id,
      competency_id: primaryCompByLf.get(lf.id) || null,
      metadata: {
        depth_enriched: subtopics.length > 0,
        llm_generated: hasRealContent,
        llm_provider: generated.provider,
        llm_model: generated.model,
        word_target: wordTarget,
        exam_weight_pct: weightByLf.get(lf.id) || null,
      },
    });
  }

  if (sectionRows.length > 0) {
    // Use upsert to handle retries/re-runs without duplicate key errors
    const { error: secErr } = await sb.from("handbook_sections").upsert(sectionRows, {
      onConflict: "chapter_id,section_key",
      ignoreDuplicates: false,
    });
    if (secErr) throw new Error(`Section upsert: ${secErr.message}`);
  }

  const isComplete = batchEnd >= fields.length;
  const progress = Math.round((batchEnd / fields.length) * 100);

  console.log(`[generate-handbook] Batch ${batchCursor}-${batchEnd}/${fields.length}: ${sectionRows.length} sections, ${llmSuccessCount} LLM, ${llmFailCount} fallback${isComplete ? ' — COMPLETE' : ''}`);

  if (!isComplete) {
    return json({
      ok: true,
      batch_complete: false,
      batch_cursor: batchEnd,
      progress,
      sections_this_batch: sectionRows.length,
    });
  }

  try { await sb.from("course_packages").update({ build_progress: 90 }).eq("id", packageId); } catch (_) { /* ignore */ }
  return json({
    ok: true,
    batch_complete: true,
    chapters: chapters.length,
    sections: sectionOrder - 1,
    llm_generated: llmSuccessCount,
    llm_fallback: llmFailCount,
  });
});

function buildFallbackContent(lf: any, subtopics: string[]): string {
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

  parts.push(
    "### Prüfungsrelevanz",
    `Dieses Lernfeld ist ein fester Bestandteil der IHK-Abschlussprüfung. Die Inhalte werden regelmäßig in schriftlichen und mündlichen Prüfungsteilen abgefragt.`,
    "",
    "### Lernhinweise",
    "- Fachbegriffe und Definitionen sicher beherrschen",
    "- Zusammenhänge zwischen Theorie und Praxis herstellen",
    "- Typische Rechenaufgaben und Fallstudien üben",
  );

  return parts.join("\n");
}
